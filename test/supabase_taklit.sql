-- Yerel test için Supabase'in auth şemasını ve rollerini taklit eder. Supabase'de ÇALIŞTIRMA.
create role anon nologin; create role authenticated nologin;
create schema auth; create schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
grant execute on all functions in schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
