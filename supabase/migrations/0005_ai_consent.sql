-- ═══════════════════════════════════════════════════════════
-- 0005 — consent to use a remote AI service
--
-- Consent is stored, not inferred from a checkbox still being on
-- screen. "Did this client agree that their brief and their part's
-- dimensions could leave our servers" is a question that may have to
-- be answered months later, to them or to someone else, and a UI
-- state cannot answer it.
--
-- One row per tenant. Withheld is the absence of a row, so the
-- default is no without anyone having to write it down.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.ai_consent (
  tenant_id   text primary key references public.tenants (id),
  granted     boolean not null default false,

  -- Who clicked it and when. A consent record with no actor is an
  -- assertion, not evidence.
  granted_by  uuid references auth.users (id),
  granted_at  timestamptz,
  revoked_at  timestamptz,

  -- The wording that was on screen when they agreed. Consent is to a
  -- specific statement; if the notice is later reworded, an old row
  -- must still show what was actually agreed to.
  notice_key      text,
  notice_version  integer not null default 1,

  updated_at  timestamptz not null default now()
);

alter table public.ai_consent enable row level security;
alter table public.ai_consent force row level security;

create policy ai_consent_select on public.ai_consent
  for select using (tenant_id = public.auth_tenant());

create policy ai_consent_insert on public.ai_consent
  for insert with check (tenant_id = public.auth_tenant());

create policy ai_consent_update on public.ai_consent
  for update using      (tenant_id = public.auth_tenant())
              with check (tenant_id = public.auth_tenant());

-- No delete policy. Revoking sets revoked_at; it does not erase the
-- fact that consent was once given, because that is the half of the
-- record an audit actually needs.
