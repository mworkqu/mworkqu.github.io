-- ═══════════════════════════════════════════════════════════
-- 0007 — the on-device model experiment (Stage 5)
--
-- A model running in the visitor's own browser sends nothing and
-- spends nothing. Two consequences the schema has to carry:
--
--   1. its calls must not count against a spend cap, and
--   2. the consent record for "may my brief be sent to an AI
--      service" does not apply to it, because nothing is sent.
--
-- Both are small columns. Getting the first one wrong is not small:
-- a local model gated on a spend cap is disabled exactly when the
-- paid providers have run out, which is the one moment it is most
-- useful.
-- ═══════════════════════════════════════════════════════════

-- ── usage rows say whether they cost anything ──────────────
-- Default true, so a call that forgets to declare itself is counted.
-- The failure that matters is undercounting what a free tier was
-- actually charged; over-counting a local call is merely wrong.
alter table public.ai_usage
  add column if not exists billable boolean not null default true;

comment on column public.ai_usage.billable is
  'False for a provider that ran on the client device. Such a row is '
  'logged — it is still a call that happened — but excluded from every '
  'cap and credit count.';

-- Every cap query filters on this, so it belongs in the index that
-- serves them rather than forcing a recheck per row.
create index if not exists ai_usage_billable_day_idx
  on public.ai_usage (tenant_id, created_at desc)
  where billable = true;

-- ── the opt-in ─────────────────────────────────────────────
-- Recorded against a device, not a tenant: what is being agreed to
-- is a ~25 MB download onto this machine. The same person on another
-- browser has not agreed to it and should not find it running.
--
-- No tenant_id, therefore no tenant policy — a row belongs to the
-- user who created it, and that is the whole of the rule.

create table if not exists public.ai_device_settings (
  user_id         uuid not null references auth.users (id) on delete cascade,
  device_id       text not null,

  local_model     boolean not null default false,
  -- Which model was agreed to. "I said yes to a 25 MB embedding
  -- model" is not consent to whatever replaces it later.
  model_id        text,
  agreed_at       timestamptz,

  created_at      timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.ai_device_settings enable row level security;
alter table public.ai_device_settings force row level security;

create policy ai_device_select on public.ai_device_settings
  for select using (user_id = auth.uid());

create policy ai_device_insert on public.ai_device_settings
  for insert with check (user_id = auth.uid());

create policy ai_device_update on public.ai_device_settings
  for update using      (user_id = auth.uid())
              with check (user_id = auth.uid());

-- Delete is allowed here, unlike the logs: this is a preference, not
-- a record of what someone was told. Forgetting a device is a
-- reasonable thing to want.
create policy ai_device_delete on public.ai_device_settings
  for delete using (user_id = auth.uid());
