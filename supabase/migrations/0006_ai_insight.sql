-- ═══════════════════════════════════════════════════════════
-- 0006 — admin insight and the learning loop (Stage 4)
--
-- The admin page needs to read across tenants, which every policy
-- written so far deliberately forbids. This migration adds the one
-- exception, narrowly: staff may SELECT the AI logs, and nothing
-- else about this changes.
--
-- Read that sentence carefully, because the browser's version of
-- this is `DataStore.listClassifications({ scope: 'all' })` — an
-- argument, and therefore no protection whatsoever. Here it is a
-- policy that consults the caller's own profile row, which the
-- caller cannot write. Those two are not the same thing, and only
-- the second one survives a client with a console.
-- ═══════════════════════════════════════════════════════════

-- Staff, decided by the profile row and therefore by the JWT.
-- SECURITY DEFINER because profiles_select_own would otherwise hide
-- the very row this has to read; STABLE so the planner hoists it out
-- of the per-row check instead of running it for every log line.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  );
$$;

-- ── cross-tenant reads for staff ───────────────────────────
-- SELECT only. A staff member may look at what the classifier told
-- a client; they may not rewrite it. The correction log is evidence
-- of what a client was shown, and evidence an operator can edit is
-- not evidence.

create policy ai_cls_select_staff on public.ai_classifications
  for select using (public.is_staff());

create policy ai_usage_select_staff on public.ai_usage
  for select using (public.is_staff());

-- No staff insert, update or delete on either table, on purpose.

-- ── rule proposals ─────────────────────────────────────────
-- A draft rule, assembled from repeated corrections, waiting for a
-- person to agree with it.
--
-- Nothing in the classifier reads this table. The live rules are
-- data/classification-rules.json, edited by hand, and that is the
-- point: a classifier that rewrites its own rules from user
-- corrections learns whatever its users were confused about that
-- week, silently, and the first sign of trouble is a rule nobody
-- wrote and nobody can explain.
--
-- Deliberately not tenant-scoped. A rule applies to everyone, so the
-- evidence for it is drawn from everyone — which is also why only
-- staff can see this table at all.

create table if not exists public.ai_rule_proposals (
  id              text primary key,

  -- Identifies the pattern (the correction plus the features the
  -- corrected parts shared), so re-analysing the same logs updates
  -- one row instead of stacking a duplicate on every visit.
  signature       text not null unique,

  from_process    text references public.processes (key),
  to_process      text references public.processes (key),

  -- How many corrections back this, and how often parts matching the
  -- same features actually went this way. The second number is the
  -- honest one: without counting the parts that did NOT follow the
  -- pattern, agreement is 100% by construction.
  evidence_count  integer not null default 0,
  agreement       numeric(4,3) not null default 0,

  -- The drafted rule, in the exact shape of an entry in
  -- data/classification-rules.json, so approving it is a paste.
  draft           jsonb not null,

  -- Classification ids the draft was built from, capped when it is
  -- written. Enough to audit the draft, not a second copy of the log.
  sample_ids      text[] not null default '{}',

  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'dismissed')),

  -- 'accepted' records that a human agreed. It does not install
  -- anything — see above.
  decided_by      uuid references auth.users (id),
  decided_at      timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ai_rule_prop_status_idx
  on public.ai_rule_proposals (status, updated_at desc);

alter table public.ai_rule_proposals enable row level security;
alter table public.ai_rule_proposals force row level security;

create policy ai_rule_prop_select on public.ai_rule_proposals
  for select using (public.is_staff());

create policy ai_rule_prop_insert on public.ai_rule_proposals
  for insert with check (public.is_staff());

create policy ai_rule_prop_update on public.ai_rule_proposals
  for update using      (public.is_staff())
              with check (public.is_staff());

-- No delete policy. A dismissed proposal is a decision worth
-- keeping: it stops the same pattern being re-proposed every week
-- and it records that someone looked at it and said no.
