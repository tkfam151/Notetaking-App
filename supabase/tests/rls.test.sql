-- Security tests for schema.sql. Run with:  psql -v ON_ERROR_STOP=1 -f auth-stub.sql -f ../schema.sql -f rls.test.sql
\set QUIET on
\o /dev/null
set client_min_messages = notice;
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com');

create or replace function pg_temp.login(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', case who when 'alice' then '00000000-0000-0000-0000-00000000000a'
                    when 'bob'   then '00000000-0000-0000-0000-00000000000b'
                    else              '00000000-0000-0000-0000-00000000000c' end,
    'email', upper(left(who,1)) || substr(who,2) || '@Example.com',  -- mixed case on purpose
    'role', 'authenticated')::text, false);
end $$;
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok   %', what;
end $$;
-- returns true if the statement raises an error
create or replace function pg_temp.fails(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;

grant execute on all functions in schema pg_temp to authenticated, anon;
create temp table ids (doc uuid);
grant all on ids to authenticated, anon;

-- 1. Alice creates a document
select pg_temp.login('alice');
set role authenticated;
with x as (insert into public.documents (title, content) values ('Plan', '{"type":"doc"}') returning id) insert into ids select id from x;
select pg_temp.check((select owner_email from public.documents) = 'alice@example.com', 'owner and owner_email set from the login');
select pg_temp.check(public.doc_role((select doc from ids)) = 'owner', 'alice is owner');
reset role;

-- 2. Bob has no access yet
select pg_temp.login('bob');
set role authenticated;
select pg_temp.check((select count(*) from public.documents) = 0, 'bob cannot list alice''s private doc');
select pg_temp.check(public.open_document((select doc from ids)) is null, 'bob cannot open it');
select pg_temp.check(pg_temp.fails(format('select public.save_document(%L, ''{"title":"hacked"}'')', (select doc from ids))), 'bob cannot save it');
select pg_temp.check(pg_temp.fails(format('insert into public.document_shares values (%L, ''bob@example.com'', ''edit'')', (select doc from ids))), 'bob cannot share it with himself');
reset role;

-- 3. Alice invites Bob as viewer
select pg_temp.login('alice');
set role authenticated;
insert into public.document_shares (document_id, email, role) select doc, 'bob@example.com', 'view' from ids;
reset role;
select pg_temp.login('bob');
set role authenticated;
select pg_temp.check((select count(*) from public.documents) = 1, 'bob (viewer) can list the shared doc');
select pg_temp.check(public.open_document((select doc from ids)) ->> 'role' = 'view', 'bob opens it as viewer (email match is case-insensitive)');
select pg_temp.check(public.open_document((select doc from ids)) ? 'owner' = false, 'open_document hides the owner''s user id');
select pg_temp.check(pg_temp.fails(format('select public.save_document(%L, ''{"title":"x"}'')', (select doc from ids))), 'viewer cannot save');
update public.documents set link_access = 'edit', title = 'mine';
select pg_temp.check((select title from public.documents) = 'Plan', 'viewer cannot change title or link access directly');
select pg_temp.check(pg_temp.fails(format('update public.document_shares set role = ''edit'' where document_id = %L', (select doc from ids))) or
       (select role from public.document_shares) = 'view', 'viewer cannot upgrade own role');
reset role;

-- 4. Alice makes Bob an editor
select pg_temp.login('alice');
set role authenticated;
update public.document_shares set role = 'edit' where email = 'bob@example.com';
reset role;
select pg_temp.login('bob');
set role authenticated;
select public.save_document((select doc from ids), '{"title":"Plan v2","word_count":3}');
select pg_temp.check((select title from public.documents) = 'Plan v2', 'editor can save content');
select pg_temp.check((select updated_by_email from public.documents) = 'bob@example.com', 'updated_by_email recorded');
select pg_temp.check((select owner_email from public.documents) = 'alice@example.com', 'editor save does not change owner');
reset role;

-- 5. Carol and the share link
select pg_temp.login('carol');
set role authenticated;
select pg_temp.check(public.open_document((select doc from ids)) is null, 'carol has no access while link is off');
select pg_temp.check(public.document_status((select doc from ids)) is null, 'document_status reveals nothing without access');
select pg_temp.check((select count(*) from public.document_shares) = 0, 'carol cannot see who it is shared with');
reset role;
select pg_temp.login('alice');
set role authenticated;
update public.documents set link_access = 'view';
reset role;
select pg_temp.login('carol');
set role authenticated;
select pg_temp.check((select count(*) from public.documents) = 0, 'link-shared doc is NOT listable by others');
select pg_temp.check(public.open_document((select doc from ids)) ->> 'role' = 'view', 'carol opens via link as viewer');
select pg_temp.check(pg_temp.fails(format('select public.save_document(%L, ''{"title":"x"}'')', (select doc from ids))), 'link viewer cannot save');
select pg_temp.check(public.document_status((select doc from ids)) ->> 'role' = 'view', 'document_status reports the link role');
reset role;
select pg_temp.login('alice');
set role authenticated;
update public.documents set link_access = 'edit';
reset role;
select pg_temp.login('carol');
set role authenticated;
select public.save_document((select doc from ids), '{"title":"Plan v3"}');
select pg_temp.check(public.open_document((select doc from ids)) ->> 'title' = 'Plan v3', 'link editor can save');
delete from public.documents;
select pg_temp.check(public.open_document((select doc from ids)) is not null, 'link editor cannot delete the doc');
reset role;

-- 6. Bob removes himself; anonymous users get nothing
select pg_temp.login('bob');
set role authenticated;
delete from public.document_shares where email = 'bob@example.com';
select pg_temp.check((select count(*) from public.documents) = 0, 'bob can remove himself from the share list');
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.check(pg_temp.fails(format('select public.open_document(%L)', (select doc from ids))), 'signed-out users cannot open documents');
select pg_temp.check(pg_temp.fails('select count(*) from public.documents'), 'signed-out users cannot read the table');
reset role;

-- 7. Owner deletes; shares cascade
select pg_temp.login('alice');
set role authenticated;
insert into public.document_shares (document_id, email, role) select doc, 'carol@example.com', 'view' from ids;
delete from public.documents;
reset role;
select pg_temp.check((select count(*) from public.documents) = 0 and (select count(*) from public.document_shares) = 0, 'owner delete removes doc and its shares');
\o
\echo 'ALL RLS TESTS PASSED'
