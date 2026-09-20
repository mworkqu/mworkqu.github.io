-- ═══════════════════════════════════════════════════════════
-- 0002 — row level security
--
-- The actual multi-tenant boundary. The tenant filtering in
-- assets/js/data/store.js is a convenience for rendering; it is
-- trivially bypassed by anyone with a console, and is NOT what
-- keeps tenants apart. These policies are.
--
-- The rule, everywhere: a row is visible and writable only when
-- its tenant_id equals auth_tenant(), which is read from the
-- caller's profile row and therefore from their JWT — never from
-- anything the client sends.
--
-- with check is as important as using: without it a caller could
-- UPDATE a row they legitimately see and set tenant_id to someone
-- else's, or INSERT a row into another tenant.
-- ═══════════════════════════════════════════════════════════

alter table public.tenants       enable row level security;
alter table public.profiles      enable row level security;
alter table public.inventory     enable row level security;
alter table public.projects      enable row level security;
alter table public.project_items enable row level security;
alter table public.cart_lines    enable row level security;
alter table public.processes     enable row level security;
alter table public.materials     enable row level security;

-- Force policies on the table owner too, so a migration or an
-- admin script cannot quietly read across tenants.
alter table public.inventory     force row level security;
alter table public.projects      force row level security;
alter table public.project_items force row level security;
alter table public.cart_lines    force row level security;

-- ── profiles ───────────────────────────────────────────────
-- Readable by its owner. Deliberately no insert/update policy:
-- tenant assignment is an admin operation done with the service
-- role, because a user who can edit their own tenant_id can read
-- every other tenant's stock.

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

-- ── tenants ────────────────────────────────────────────────

create policy tenants_select_own on public.tenants
  for select using (id = public.auth_tenant());

-- ── inventory ──────────────────────────────────────────────

create policy inventory_select on public.inventory
  for select using (tenant_id = public.auth_tenant());

create policy inventory_insert on public.inventory
  for insert with check (tenant_id = public.auth_tenant());

create policy inventory_update on public.inventory
  for update using      (tenant_id = public.auth_tenant())
              with check (tenant_id = public.auth_tenant());

create policy inventory_delete on public.inventory
  for delete using (tenant_id = public.auth_tenant());

-- ── projects ───────────────────────────────────────────────

create policy projects_select on public.projects
  for select using (tenant_id = public.auth_tenant());

create policy projects_insert on public.projects
  for insert with check (tenant_id = public.auth_tenant());

create policy projects_update on public.projects
  for update using      (tenant_id = public.auth_tenant())
              with check (tenant_id = public.auth_tenant());

create policy projects_delete on public.projects
  for delete using (tenant_id = public.auth_tenant());

-- ── project items ──────────────────────────────────────────
-- Both the row's own tenant AND its parent project's tenant must
-- match, so a line cannot be hung off another tenant's project
-- even if the line itself is stamped correctly.

create policy project_items_select on public.project_items
  for select using (tenant_id = public.auth_tenant());

create policy project_items_insert on public.project_items
  for insert with check (
    tenant_id = public.auth_tenant()
    and exists (
      select 1 from public.projects p
       where p.id = project_id and p.tenant_id = public.auth_tenant()
    )
  );

create policy project_items_update on public.project_items
  for update using      (tenant_id = public.auth_tenant())
              with check (tenant_id = public.auth_tenant());

create policy project_items_delete on public.project_items
  for delete using (tenant_id = public.auth_tenant());

-- ── cart ───────────────────────────────────────────────────

create policy cart_select on public.cart_lines
  for select using (tenant_id = public.auth_tenant());

create policy cart_insert on public.cart_lines
  for insert with check (
    tenant_id = public.auth_tenant()
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
         where p.id = project_id and p.tenant_id = public.auth_tenant()
      )
    )
  );

create policy cart_update on public.cart_lines
  for update using      (tenant_id = public.auth_tenant())
              with check (tenant_id = public.auth_tenant());

create policy cart_delete on public.cart_lines
  for delete using (tenant_id = public.auth_tenant());

-- ── reference data ─────────────────────────────────────────
-- Processes and materials are global, not per tenant: everyone
-- reads them, only an admin writes them.

create policy processes_select on public.processes
  for select using (auth.role() = 'authenticated');

create policy materials_select on public.materials
  for select using (auth.role() = 'authenticated');

create policy processes_admin_write on public.processes
  for all using (
    exists (select 1 from public.profiles pr
             where pr.id = auth.uid() and pr.role = 'admin')
  );

create policy materials_admin_write on public.materials
  for all using (
    exists (select 1 from public.profiles pr
             where pr.id = auth.uid() and pr.role = 'admin')
  );
