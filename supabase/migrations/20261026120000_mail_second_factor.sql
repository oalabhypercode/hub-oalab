-- Second factor by e-mail code (26.10.2026). Applied to the shared Supabase project through service-oalab
-- (supabase/migrations/202610260001_mail_second_factor.sql, `pnpm db:push` there); kept here, like the shared login
-- before it, so this history matches the schema the Hub code expects. Identical below this header.

-- Zweiter Faktor per E-Mail-Code für Hub und Service (ein Login, Nutzerentscheidung 26.10.2026): Statt der
-- Authenticator-App schickt der Hub einen sechsstelligen Code an die Adresse des Logins, ohne Zusatzkosten.
-- Logins mit app_metadata.second_factor = 'email' (Schalter im User Management des Hubs) kommen erst nach dem Code
-- in den Hub; die Team-Rollen von Service brauchen ihn für jede Sitzung, wie bisher die App.
--
-- Ein bestätigter Code markiert die Supabase-Sitzung in oalab_mail_code_sessions. Der Access-Token-Hook unten stellt
-- jedes Token dieser Sitzung dann mit aal2 aus, das beide Apps und app.current_aal() bereits verlangen. Supabase Auth
-- übernimmt das aal des Hooks unverändert (auth: internal/tokens/service.go). Der Hook hebt nur Sitzungen an, die
-- einen Code bestätigt haben, höchstens 30 Tage lang; alles andere behält die Stufe, die Supabase Auth berechnet.
--
-- Codes liegen nur als SHA-256 von "<Sitzungs-ID>:<Code>" vor, gelten 10 Minuten und erlauben 5 Versuche. Nur die
-- Service-Rolle (der Server des Hubs) stellt sie aus und prüft sie; Browser erreichen keine der beiden Tabellen.
--
-- Nach dem Anwenden: Dashboard → Authentication → Hooks → „Customize Access Token (JWT) Claims“ → Postgres-Funktion
-- public.oalab_access_token_hook. Solange er aus ist, schließt der Hub keinen Code-Login ab (er prüft das neue Token).
begin;

create table public.oalab_mail_codes (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index oalab_mail_codes_user_idx on public.oalab_mail_codes (user_id);

create table public.oalab_mail_code_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now()
);
create index oalab_mail_code_sessions_user_idx on public.oalab_mail_code_sessions (user_id);

alter table public.oalab_mail_codes enable row level security;
alter table public.oalab_mail_codes force row level security;
alter table public.oalab_mail_code_sessions enable row level security;
alter table public.oalab_mail_code_sessions force row level security;
revoke all on public.oalab_mail_codes, public.oalab_mail_code_sessions from public, anon, authenticated;
grant all on public.oalab_mail_codes, public.oalab_mail_code_sessions to service_role;

-- Stellt für die Sitzung einen neuen Code aus; ein älterer Code derselben Sitzung verfällt damit.
create or replace function public.oalab_mail_code_issue(p_user_id uuid, p_session_id uuid, p_code_hash text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_session_id is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid mail code request' using errcode = '22023';
  end if;
  delete from public.oalab_mail_codes c where c.expires_at < now() - interval '1 day';
  insert into public.oalab_mail_codes (session_id, user_id, code_hash, attempts, expires_at)
  values (p_session_id, p_user_id, p_code_hash, 0, now() + interval '10 minutes')
  on conflict (session_id) do update
    set user_id = excluded.user_id, code_hash = excluded.code_hash, attempts = 0,
        expires_at = excluded.expires_at, created_at = now();
end;
$$;

-- Prüft einen Code: 'verified' (Sitzung bestätigt, Code verbraucht), 'wrong', 'locked' (fünf Fehlversuche),
-- 'expired' oder 'missing'. Pro Sitzung serialisiert, damit parallele Versuche das Limit nicht umgehen.
create or replace function public.oalab_mail_code_verify(p_user_id uuid, p_session_id uuid, p_code_hash text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  code public.oalab_mail_codes;
begin
  if p_user_id is null or p_session_id is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid mail code request' using errcode = '22023';
  end if;
  select * into code from public.oalab_mail_codes c
  where c.session_id = p_session_id and c.user_id = p_user_id
  for update;
  if not found then
    return 'missing';
  end if;
  if code.expires_at < now() then
    delete from public.oalab_mail_codes c where c.session_id = p_session_id;
    return 'expired';
  end if;
  if code.attempts >= 5 then
    return 'locked';
  end if;
  if code.code_hash <> p_code_hash then
    update public.oalab_mail_codes c set attempts = c.attempts + 1 where c.session_id = p_session_id;
    return case when code.attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  delete from public.oalab_mail_codes c where c.session_id = p_session_id;
  delete from public.oalab_mail_code_sessions s where s.user_id = p_user_id and s.verified_at < now() - interval '30 days';
  insert into public.oalab_mail_code_sessions (session_id, user_id, verified_at)
  values (p_session_id, p_user_id, now())
  on conflict (session_id) do update set user_id = excluded.user_id, verified_at = excluded.verified_at;
  return 'verified';
end;
$$;

revoke execute on function public.oalab_mail_code_issue(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.oalab_mail_code_verify(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.oalab_mail_code_issue(uuid, uuid, text) to service_role;
grant execute on function public.oalab_mail_code_verify(uuid, uuid, text) to service_role;

-- Access-Token-Hook: Tokens einer Sitzung mit bestätigtem Mail-Code tragen aal2. Läuft als supabase_auth_admin bei
-- jeder Token-Ausgabe (Anmeldung und Refresh); er liest nur die eigene Sitzung und ändert nichts außer aal.
create or replace function public.oalab_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  session_text text := claims ->> 'session_id';
  user_text text := event ->> 'user_id';
  uuid_shape constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if coalesce(claims ->> 'aal', '') <> 'aal2'
     and session_text ~ uuid_shape and user_text ~ uuid_shape
     and exists (
       select 1 from public.oalab_mail_code_sessions s
       where s.session_id = session_text::uuid
         and s.user_id = user_text::uuid
         and s.verified_at > now() - interval '30 days'
     ) then
    claims := jsonb_set(claims, '{aal}', to_jsonb('aal2'::text));
  end if;
  return jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
revoke execute on function public.oalab_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.oalab_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.oalab_mail_code_sessions to supabase_auth_admin;
create policy "Auth liest bestätigte Code-Sitzungen" on public.oalab_mail_code_sessions
  as permissive for select to supabase_auth_admin using (true);

-- Der Hub zählt Code-Anforderungen wie seine anderen Formulare und protokolliert die Code-Mails (nur Art und Ergebnis).
alter table public.hub_auth_rate_events drop constraint hub_auth_rate_events_action_check;
alter table public.hub_auth_rate_events add constraint hub_auth_rate_events_action_check
  check (action in ('login', 'signup', 'password_reset', 'login_code'));

create or replace function public.hub_take_auth_rate(p_action text, p_subject text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if p_action not in ('login', 'signup', 'password_reset', 'login_code') or p_subject !~ '^[0-9a-f]{64}$'
     or p_limit not between 1 and 1000 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit request' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_action || ':' || p_subject, 0));
  delete from public.hub_auth_rate_events e where e.created_at < now() - interval '1 day';
  select count(*) into used
  from public.hub_auth_rate_events e
  where e.action = p_action and e.subject = p_subject and e.created_at > now() - make_interval(secs => p_window_seconds);
  if used >= p_limit then
    return false;
  end if;
  insert into public.hub_auth_rate_events (action, subject) values (p_action, p_subject);
  return true;
end;
$$;
revoke execute on function public.hub_take_auth_rate(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.hub_take_auth_rate(text, text, integer, integer) to service_role;

alter table public.hub_notifications drop constraint hub_notifications_kind_check;
alter table public.hub_notifications add constraint hub_notifications_kind_check check (
  kind in ('registration.confirmation', 'registration.team', 'registration.received', 'registration.approved', 'registration.rejected', 'user.activation', 'user.password', 'user.login_code')
);

commit;
