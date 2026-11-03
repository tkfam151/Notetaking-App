#!/usr/bin/env bash
# Checks that the Supabase project in .env.production is ready for Inkwell.
# Uses only the PUBLIC key; creates nothing. Run: bash scripts/check-supabase.sh
set -u
URL=$(grep '^VITE_SUPABASE_URL=' .env.production | cut -d= -f2-)
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env.production | cut -d= -f2-)
fail=0
say() { printf '%s %s\n' "$1" "$2"; }

settings=$(curl -s -m 20 -w '\n%{http_code}' "$URL/auth/v1/settings" -H "apikey: $KEY")
code=$(tail -n1 <<<"$settings"); body=$(sed '$d' <<<"$settings")
if [ "$code" = 200 ]; then
  say "✓" "Project reachable and the publishable key is valid"
  if grep -q '"email":true' <<<"$body"; then say "✓" "Email sign-in is enabled"; else say "✗" "Email sign-in is turned OFF (Authentication → Providers → Email)"; fail=1; fi
  if grep -q '"disable_signup":true' <<<"$body"; then say "✗" "New sign-ups are disabled (Authentication → Settings → Allow new users to sign up)"; fail=1; else say "✓" "New sign-ups are allowed"; fi
  if grep -q '"mailer_autoconfirm":true' <<<"$body"; then say "•" "New accounts can sign in immediately (email confirmation is off)"; else say "•" "New accounts must click a confirmation email before signing in"; fi
else
  say "✗" "Could not reach the project or the key is wrong (HTTP $code): $body"; exit 1
fi

check_rpc() {  # name, json body
  local r c b
  r=$(curl -s -m 20 -w '\n%{http_code}' -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" -H 'Content-Type: application/json' -d "$2")
  c=$(tail -n1 <<<"$r"); b=$(sed '$d' <<<"$r")
  if grep -qE 'PGRST202|Could not find the function' <<<"$b"; then say "✗" "Database function $1 is missing → run the schema (see README)"; fail=1
  elif grep -qE '42501|permission denied' <<<"$b" || [ "$c" = 401 ]; then say "✓" "Database function $1 exists and is locked to signed-in users"
  else say "✗" "Unexpected answer from $1 (HTTP $c): $b"; fail=1; fi
}
doc='"00000000-0000-0000-0000-000000000000"'
check_rpc open_document "{\"doc_id\":$doc}"
check_rpc save_document "{\"doc_id\":$doc,\"doc\":{}}"
check_rpc document_status "{\"doc_id\":$doc}"

for t in documents document_shares; do
  r=$(curl -s -m 20 -w '\n%{http_code}' "$URL/rest/v1/$t?select=*&limit=1" -H "apikey: $KEY")
  c=$(tail -n1 <<<"$r"); b=$(sed '$d' <<<"$r")
  if grep -qE 'PGRST205|42P01|does not exist|Could not find the table' <<<"$b"; then say "✗" "Table $t is missing → run the schema (see README)"; fail=1
  elif grep -qE '42501|permission denied' <<<"$b" || [ "$c" = 401 ]; then say "✓" "Table $t exists and signed-out visitors can't read it"
  elif [ "$c" = 200 ] && [ "$b" = "[]" ]; then say "✗" "Table $t is readable without signing in → re-run the schema to restore its security rules"; fail=1
  else say "✗" "Unexpected answer from table $t (HTTP $c): $b"; fail=1; fi
done

if [ $fail = 0 ]; then echo; echo "Supabase is ready for Inkwell."; else echo; echo "Supabase needs attention (see ✗ above)."; fi
exit $fail
