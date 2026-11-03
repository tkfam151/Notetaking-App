-- Inkwell cloud schema for Supabase.
-- Run once: Supabase dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to re-run: it drops and recreates Inkwell's functions and policies (not your data).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email      text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  title            text not null default 'Untitled document',
  content          jsonb not null default '{}'::jsonb,
  page_setup       jsonb,
  comments         jsonb not null default '[]'::jsonb,
  preview          text not null default '',
  word_count       integer not null default 0,
  -- 'none' = only invited people; 'view' / 'edit' = anyone signed in who has the link
  link_access      text not null default 'none' check (link_access in ('none', 'view', 'edit')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_email text
);

create table if not exists public.document_shares (
  document_id uuid not null references public.documents (id) on delete cascade,
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  role        text not null check (role in ('view', 'edit')),
  created_at  timestamptz not null default now(),
  primary key (document_id, email)
);

create index if not exists documents_owner_idx on public.documents (owner);
create index if not exists document_shares_email_idx on public.document_shares (email);

alter table public.documents enable row level security;
alter table public.document_shares enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies don't recurse into each other)
-- ---------------------------------------------------------------------------

create or replace function public.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_doc_owner(doc_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from documents d where d.id = doc_id and d.owner = auth.uid())
$$;

create or replace function public.is_shared_with_me(doc_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from document_shares s where s.document_id = doc_id and s.email = public.my_email())
$$;

-- The current user's role on a document: 'owner', 'edit', 'view' or null (no access).
-- Invitations and the share link both count; the stronger one wins.
create or replace function public.doc_role(doc_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when d.owner = auth.uid() then 'owner'
    when s.role = 'edit' or d.link_access = 'edit' then 'edit'
    when s.role = 'view' or d.link_access = 'view' then 'view'
    else null
  end
  from documents d
  left join document_shares s on s.document_id = d.id and s.email = public.my_email()
  where d.id = doc_id and auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- Link-shared documents are NOT readable through the table (so nobody can list them);
-- they are only reachable through open_document() with the exact id from the link.
-- ---------------------------------------------------------------------------

drop policy if exists documents_select on public.documents;
drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;

create policy documents_select on public.documents for select to authenticated
  using (owner = auth.uid() or public.is_shared_with_me(id));
create policy documents_insert on public.documents for insert to authenticated
  with check (owner = auth.uid());
-- Owners can change everything (title, link access…). Editors save through save_document().
create policy documents_update on public.documents for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy documents_delete on public.documents for delete to authenticated
  using (owner = auth.uid());

drop policy if exists shares_select on public.document_shares;
drop policy if exists shares_insert on public.document_shares;
drop policy if exists shares_update on public.document_shares;
drop policy if exists shares_delete on public.document_shares;

create policy shares_select on public.document_shares for select to authenticated
  using (email = public.my_email() or public.is_doc_owner(document_id));
create policy shares_insert on public.document_shares for insert to authenticated
  with check (public.is_doc_owner(document_id));
create policy shares_update on public.document_shares for update to authenticated
  using (public.is_doc_owner(document_id)) with check (public.is_doc_owner(document_id));
-- Owners can remove anyone; people can also remove themselves ("Remove from my list").
create policy shares_delete on public.document_shares for delete to authenticated
  using (public.is_doc_owner(document_id) or email = public.my_email());

-- Keep owner_email accurate and stop owners being changed.
create or replace function public.documents_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner := auth.uid();
    new.owner_email := public.my_email();
  else
    new.owner := old.owner;
    new.owner_email := old.owner_email;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists documents_guard on public.documents;
create trigger documents_guard before insert or update on public.documents
  for each row execute function public.documents_guard();

-- ---------------------------------------------------------------------------
-- RPCs used by the app
-- ---------------------------------------------------------------------------

-- Open a document by id (works for owners, invitees, and anyone with the link).
create or replace function public.open_document(doc_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r text := public.doc_role(doc_id);
  result jsonb;
begin
  if r is null then
    return null;
  end if;
  select to_jsonb(d) - 'owner' || jsonb_build_object('role', r) into result from documents d where d.id = doc_id;
  return result;
end $$;

-- Save content (owners and editors, including "anyone with the link can edit").
create or replace function public.save_document(doc_id uuid, doc jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  r text := public.doc_role(doc_id);
  ts timestamptz := now();
begin
  if r is null or r = 'view' then
    raise exception 'You do not have permission to edit this document' using errcode = '42501';
  end if;
  update documents set
    title            = coalesce(doc ->> 'title', title),
    content          = coalesce(doc -> 'content', content),
    page_setup       = coalesce(doc -> 'page_setup', page_setup),
    comments         = coalesce(doc -> 'comments', comments),
    preview          = coalesce(doc ->> 'preview', preview),
    word_count       = coalesce((doc ->> 'word_count')::int, word_count),
    updated_at       = ts,
    updated_by_email = public.my_email()
  where id = doc_id;
  return ts;
end $$;

-- Lightweight check used to pull changes made by other people and notice access changes.
-- Returns null when the current user has no access.
drop function if exists public.document_updated_at(uuid);
create or replace function public.document_status(doc_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('updated_at', d.updated_at, 'role', public.doc_role(doc_id))
  from documents d where d.id = doc_id and public.doc_role(doc_id) is not null
$$;

revoke all on function public.open_document(uuid) from public, anon;
revoke all on function public.save_document(uuid, jsonb) from public, anon;
revoke all on function public.document_status(uuid) from public, anon;
grant execute on function public.open_document(uuid) to authenticated;
grant execute on function public.save_document(uuid, jsonb) to authenticated;
grant execute on function public.document_status(uuid) to authenticated;

grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_shares to authenticated;
revoke all on public.documents from anon;
revoke all on public.document_shares from anon;
