-- ═══════════════════════════════════════════════════════════
-- 0001 — schema
--
-- The tables behind assets/js/data/store.js. Nothing runs this
-- yet: the site is static and state lives in localStorage. These
-- files are the target shape, written now so the JS data layer
-- could be pointed at them without the UI above it changing.
--
-- Apply with:  supabase db push
-- ═══════════════════════════════════════════════════════════

-- ── tenancy ────────────────────────────────────────────────

create table if not exists public.tenants (
  id          text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- One row per signed-in user, naming the tenant they belong to.
-- This is the table auth_tenant() reads, and it is deliberately
-- NOT writable by the user: moving yourself to another tenant
-- would defeat every policy in 0002.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  tenant_id   text not null references public.tenants (id),
  role        text not null default 'client'
                check (role in ('client', 'admin', 'vendor')),
  created_at  timestamptz not null default now()
);

create index if not exists profiles_tenant_idx on public.profiles (tenant_id);

-- The tenant of the caller. STABLE so the planner can hoist it out
-- of a row-by-row policy check instead of re-running it per row.
create or replace function public.auth_tenant()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

-- ── process → material config (data/processes.json) ────────
-- Global reference data, readable by every signed-in user and
-- writable only by an admin. Splitting it into two tables is what
-- makes the material list a query rather than a hardcoded array.

create table if not exists public.processes (
  key        text primary key,
  label_en   text not null,
  label_ar   text not null,
  sort       integer not null default 0,
  active     boolean not null default true
);

create table if not exists public.materials (
  key          text not null,
  process_key  text not null references public.processes (key) on delete cascade,
  label_en     text not null,
  label_ar     text not null,
  sort         integer not null default 0,
  active       boolean not null default true,
  primary key (process_key, key)
);

create index if not exists materials_process_idx on public.materials (process_key);

-- ── client inventory ───────────────────────────────────────

create table if not exists public.inventory (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null references public.tenants (id),
  sku         text,
  name        text not null,
  qty         integer not null check (qty >= 0),   -- the last line of defence
  origin      text not null default 'store'
                check (origin in ('store', 'own')),
  unit_price  numeric(12,2) not null default 0,
  note        text,
  updated_at  timestamptz not null default now()
);

-- One row per SKU per tenant, so "top up the existing line" is an
-- upsert rather than a read-then-decide.
create unique index if not exists inventory_tenant_sku_idx
  on public.inventory (tenant_id, sku) where sku is not null;

create unique index if not exists inventory_tenant_name_idx
  on public.inventory (tenant_id, name) where sku is null;

-- ── projects ───────────────────────────────────────────────

create table if not exists public.projects (
  id           text primary key,
  tenant_id    text not null references public.tenants (id),
  title        text not null,
  brief        text,
  type         text,
  process_key  text references public.processes (key),
  material_key text,
  target_date  date,
  state        text not null default 'NEW'
                 check (state in ('NEW','REVIEW','QUOTED','APPROVED',
                                  'PRODUCTION','READY','CLOSED','CANCELLED')),
  quote        jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists projects_tenant_idx on public.projects (tenant_id);

create table if not exists public.project_items (
  line_id     uuid primary key default gen_random_uuid(),
  tenant_id   text not null references public.tenants (id),
  project_id  text not null references public.projects (id) on delete cascade,
  sku         text,
  name        text not null,
  qty         integer not null check (qty > 0),
  -- inventory: came off the shelf, already the client's
  -- cart:      on the project but not yet bought
  -- ordered:   paid for, not yet delivered
  -- delivered: arrived against this project
  -- supplied:  the client provides it, never touches stock
  source      text not null
                check (source in ('inventory','cart','ordered','delivered','supplied')),
  unit_price  numeric(12,2) not null default 0,
  paid        boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists project_items_project_idx on public.project_items (project_id);
create index if not exists project_items_tenant_idx  on public.project_items (tenant_id);

-- ── cart ───────────────────────────────────────────────────
-- project_id is what routes a line on delivery: tagged lines land
-- on their project, untagged lines land on the client's shelf.

create table if not exists public.cart_lines (
  line_id     uuid primary key default gen_random_uuid(),
  tenant_id   text not null references public.tenants (id),
  project_id  text references public.projects (id) on delete cascade,
  sku         text,
  name        text not null,
  qty         integer not null check (qty > 0),
  unit_price  numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists cart_lines_tenant_idx on public.cart_lines (tenant_id);
