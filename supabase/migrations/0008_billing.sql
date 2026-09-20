-- ═══════════════════════════════════════════════════════════
-- 0008 — usage metering and credits (Stage 6)
--
-- This prepares a subscription. It does not start one: nothing here
-- charges anybody, and the browser's `billing.enforce` ships off.
--
-- The one thing that has to be right from the first row is WHO
-- decides the price. In the browser, assets/js/services/billing.js
-- reads data/ai-plans.json and posts a `credits` figure with each
-- usage row — which is fine while nothing is billed and unacceptable
-- the moment something is. A client that can post its own price is
-- not metered.
--
-- So here the price is a row, the cost is computed by a trigger from
-- that row, and whatever the client sent is overwritten. When
-- `billing.authority` in ai-config.js is flipped from 'client' to
-- 'server', this is what it is pointing at.
-- ═══════════════════════════════════════════════════════════

-- ── the price list ─────────────────────────────────────────
-- data/ai-plans.json, as rows. Readable by everyone signed in (a
-- client is entitled to know what their allowance buys), writable by
-- nobody through the API — pricing changes are a service-role
-- operation, like moving a user between tenants.

create table if not exists public.ai_feature_prices (
  feature       text primary key,
  credits       integer not null check (credits >= 0),
  est_tokens_in  integer not null default 0,
  est_tokens_out integer not null default 0,
  note          text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.ai_provider_multipliers (
  provider      text primary key,
  multiplier    numeric(6,3) not null check (multiplier >= 0),
  note          text
);

-- Zero is a real price, not a missing one: the rules, the cache and
-- an on-device model cost nothing to run, so they cost nothing to
-- use. Charging for them would push a client on a small plan towards
-- the expensive answer to save their allowance, which is backwards.
insert into public.ai_provider_multipliers (provider, multiplier, note) values
  ('rules',      0, 'Local, free, instant.'),
  ('cache',      0, 'An answer already paid for once.'),
  ('local',      0, 'Runs on the client device. Costs us nothing.'),
  ('gemini',     1, 'Free tier.'),
  ('groq',       1, 'Free tier.'),
  ('openrouter', 1, 'Free tier.'),
  ('paid',       4, 'The only one that can produce an invoice.')
on conflict (provider) do nothing;

insert into public.ai_feature_prices (feature, credits, est_tokens_in, est_tokens_out, note) values
  ('classifyProject',   1,  420,  120, 'Implemented.'),
  ('generateImage',     8,  200,    0, 'Not implemented. Priced now so the meter is not redesigned later.'),
  ('generateSchematic', 15, 1200, 2000, 'Not implemented.'),
  ('generateModel',     25, 1500, 3000, 'Not implemented. The most expensive thing on the roadmap.')
on conflict (feature) do nothing;

-- ── plans ──────────────────────────────────────────────────

create table if not exists public.ai_plans (
  key             text primary key,
  label_en        text not null,
  label_ar        text not null,
  monthly_credits integer not null check (monthly_credits >= 0),
  providers       text[] not null default '{}',
  -- 'block' stops at the allowance; 'notify' continues and marks it.
  -- There is deliberately no 'charge': metering that bills is a
  -- different kind of system, with refunds and disputes in it.
  overage         text not null default 'block'
                    check (overage in ('block', 'notify')),
  note            text
);

insert into public.ai_plans (key, label_en, label_ar, monthly_credits, providers, overage, note) values
  ('free',     'Free',     'مجاني',   50,
   '{rules,cache,local,gemini,groq,openrouter}', 'block',
   'No paid provider, so this plan cannot generate a bill.'),
  ('studio',   'Studio',   'استوديو', 500,
   '{rules,cache,local,gemini,groq,openrouter,paid}', 'block',
   'Blocks at the allowance. A surprise invoice is worse than a feature that stops.'),
  ('workshop', 'Workshop', 'ورشة',    2500,
   '{rules,cache,local,gemini,groq,openrouter,paid}', 'notify',
   'Keeps working past the allowance and flags it.')
on conflict (key) do nothing;

-- A tenant is on exactly one plan, and cannot move itself.
alter table public.tenants
  add column if not exists plan text not null default 'free'
    references public.ai_plans (key);

-- ── the metered columns ────────────────────────────────────

alter table public.ai_usage
  add column if not exists credits integer not null default 0,
  add column if not exists tokens_estimated boolean not null default false;

comment on column public.ai_usage.tokens_estimated is
  'True when the provider reported no token count and one was estimated. '
  'Kept separate from measured counts: adding an estimate to a measurement '
  'as though they were the same number is how a meter becomes indefensible.';

-- ── the price is not the client''s to set ───────────────────
-- Whatever `credits` arrived with the insert is discarded and
-- recomputed from the price rows. This is the difference between a
-- meter and a display.

create or replace function public.ai_usage_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base integer;
  mult numeric;
begin
  -- An unbillable row (a model on the client's own device) is free,
  -- whatever anyone claims.
  if new.billable = false then
    new.credits := 0;
    return new;
  end if;

  select credits into base
    from public.ai_feature_prices where feature = new.feature;
  select multiplier into mult
    from public.ai_provider_multipliers where provider = new.provider;

  -- Unpriced is counted as free and logged as a problem. Guessing a
  -- price for something nobody priced is how a meter invents charges.
  if base is null or mult is null then
    raise warning 'ai_usage: no price for feature=% provider=%', new.feature, new.provider;
    new.credits := 0;
    return new;
  end if;

  new.credits := ceil(base * mult);
  return new;
end;
$$;

drop trigger if exists ai_usage_price_trg on public.ai_usage;
create trigger ai_usage_price_trg
  before insert on public.ai_usage
  for each row execute function public.ai_usage_price();

-- ── reading the meter ──────────────────────────────────────
-- Per tenant, per calendar month, because that is what a
-- subscription line reads as and what a client will check against.

create or replace view public.ai_monthly_usage as
  select tenant_id,
         date_trunc('month', created_at) as period,
         count(*)                        as calls,
         sum(credits)                    as credits,
         sum(tokens_in)                  as tokens_in,
         sum(tokens_out)                 as tokens_out,
         count(*) filter (where tokens_estimated) as estimated_rows
    from public.ai_usage
   where billable = true
   group by tenant_id, date_trunc('month', created_at);

-- The view inherits ai_usage's policies, so a tenant sees its own
-- month and staff see everyone's. Nothing extra is needed, and
-- security_invoker makes sure of it rather than assuming it.
alter view public.ai_monthly_usage set (security_invoker = true);

-- ── the price list is public to those signed in ────────────

alter table public.ai_feature_prices        enable row level security;
alter table public.ai_provider_multipliers  enable row level security;
alter table public.ai_plans                 enable row level security;

create policy ai_prices_select on public.ai_feature_prices
  for select using (auth.uid() is not null);

create policy ai_multipliers_select on public.ai_provider_multipliers
  for select using (auth.uid() is not null);

create policy ai_plans_select on public.ai_plans
  for select using (auth.uid() is not null);

-- No insert, update or delete policy on any of the three. Prices and
-- plans change through a migration or the service role, where the
-- change is reviewable — not through the API, and never by the party
-- being charged.
