-- ═══════════════════════════════════════════════════════════
-- 0004 — AI classification log and usage metering
--
-- Matches the shapes written by assets/js/data/store.js
-- (logClassification / logCorrection) field for field, so moving
-- that module onto Postgres is a change of storage, not of shape.
--
-- Two tables, two different questions:
--
--   ai_classifications  what was suggested, what the human chose,
--                       and whether those differed. This is the
--                       training data — every correction a client
--                       makes is a labelled example we own.
--
--   ai_usage            one row per provider call: who, which
--                       provider, how long, did it work. Written
--                       from Stage 3, when there is a metered
--                       provider to write about; read by Stage 4 for
--                       the cap dashboard and Stage 6 for billing.
--
-- Nothing runs this yet. Stage 1 keeps the same rows in localStorage.
-- ═══════════════════════════════════════════════════════════

-- ── classifications ────────────────────────────────────────

create table if not exists public.ai_classifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references public.tenants (id),

  -- SHA-256 of the file's bytes, computed in the browser. The file
  -- itself is never uploaded and never stored; this is only an
  -- identity, so the same drawing is not analysed twice.
  file_hash   text,
  file_ext    text not null default '',
  file_size   bigint not null default 0,

  -- The cache key is (file_hash, question_hash). It hashes the whole
  -- question — the brief, the material class and the tolerance — not
  -- just the description: the same file asked about as "aluminium,
  -- ±0.02" is a different question from the same file asked about
  -- with no hints, and must not reuse the answer.
  question_hash text not null default '',
  description   text,

  -- Extracted geometry — bounding box, volume, flatness and so on.
  -- Populated from Stage 2. jsonb because the feature set will grow
  -- and a migration per new measurement would be absurd.
  features    jsonb not null default '{}'::jsonb,

  suggested_process text references public.processes (key),
  alternatives      jsonb not null default '[]'::jsonb,
  confidence        numeric(4,3) not null default 0
                      check (confidence >= 0 and confidence <= 1),
  -- [{ key, vars }] — i18n keys, not sentences, so a stored reason
  -- can be re-read in either language later.
  reasons     jsonb not null default '[]'::jsonb,
  -- Rule ids that fired as warnings (thin wall, exceeds print volume,
  -- multiple bodies). Kept separate from reasons because a warning
  -- never changed the answer, and Stage 4 counts the two differently.
  warnings    jsonb not null default '[]'::jsonb,
  -- 'rules' | 'cache' | a provider name.
  source      text not null default 'rules',

  -- Filled in when the human decides. Null means the suggestion was
  -- shown but never answered, which is itself worth knowing.
  final_process text references public.processes (key),
  corrected     boolean,

  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index if not exists ai_cls_tenant_idx on public.ai_classifications (tenant_id);
create index if not exists ai_cls_created_idx on public.ai_classifications (tenant_id, created_at desc);

-- The cache lookup ai.js makes before any analysis.
create index if not exists ai_cls_cache_idx
  on public.ai_classifications (tenant_id, file_hash, question_hash)
  where file_hash is not null;

-- Stage 4 counts accuracy off this: only answered rows, and whether
-- the human agreed. A partial index because unanswered rows are the
-- majority of what a busy day produces and none of what it measures.
create index if not exists ai_cls_corrected_idx
  on public.ai_classifications (tenant_id, corrected)
  where decided_at is not null;

-- ── usage ──────────────────────────────────────────────────

create table if not exists public.ai_usage (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references public.tenants (id),

  provider    text not null,
  -- classifyProject | generateModel | generateImage | generateSchematic
  feature     text not null,
  model       text,

  ok          boolean not null default true,
  http_status integer,
  error       text,
  latency_ms  integer,

  -- Estimated, not billed: free tiers do not report usage reliably.
  -- Stage 6 turns these into credits.
  tokens_in   integer not null default 0,
  tokens_out  integer not null default 0,

  classification_id uuid references public.ai_classifications (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists ai_usage_tenant_idx on public.ai_usage (tenant_id, created_at desc);

-- Per-tenant daily counting, for the free-tier caps in Stage 3.
create index if not exists ai_usage_day_idx
  on public.ai_usage (tenant_id, provider, (created_at::date));

-- ── row level security ─────────────────────────────────────
-- Same rule as everywhere else: a row belongs to a tenant, and a
-- caller only ever sees their own. A client's parts, briefs and
-- geometry are commercially sensitive; the classification log holds
-- all three, so it gets the same treatment as inventory.

alter table public.ai_classifications enable row level security;
alter table public.ai_usage           enable row level security;

alter table public.ai_classifications force row level security;
alter table public.ai_usage           force row level security;

create policy ai_cls_select on public.ai_classifications
  for select using (tenant_id = public.auth_tenant());

create policy ai_cls_insert on public.ai_classifications
  for insert with check (tenant_id = public.auth_tenant());

-- Update is how a correction is recorded, so it stays open — but
-- with check as well as using, or a caller could take a row they may
-- legitimately see and reassign it to another tenant.
create policy ai_cls_update on public.ai_classifications
  for update using      (tenant_id = public.auth_tenant())
              with check (tenant_id = public.auth_tenant());

-- Deliberately no delete policy. The log is the training data and an
-- audit trail of what the machine told a client; a tenant deleting
-- the record of a suggestion they disagreed with is exactly what it
-- must not be possible to do. Erasure is a service-role operation.

create policy ai_usage_select on public.ai_usage
  for select using (tenant_id = public.auth_tenant());

create policy ai_usage_insert on public.ai_usage
  for insert with check (tenant_id = public.auth_tenant());

-- Usage rows are immutable: no update policy, no delete policy. A
-- metering row that can be edited by the party being metered is not
-- metering.
