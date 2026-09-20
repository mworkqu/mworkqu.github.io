-- ═══════════════════════════════════════════════════════════
-- 0003 — atomic operations
--
-- One function per write in assets/js/data/store.js, same names.
-- Each runs in a single transaction, so a caller either gets the
-- whole movement or none of it.
--
-- Every function is SECURITY INVOKER (the default). That is the
-- important part: it means the policies in 0002 still apply inside
-- the function body. A SECURITY DEFINER function here would run as
-- the owner and quietly bypass RLS, turning "deduct my stock" into
-- "deduct anyone's stock" — the exact bug the policies exist to
-- prevent. Do not change it without adding explicit tenant checks.
-- ═══════════════════════════════════════════════════════════

-- ── deduct_inventory ───────────────────────────────────────
-- The whole concurrency story is the WHERE clause. Two callers
-- racing for the last unit both run this UPDATE; Postgres
-- serialises them on the row lock, the second one re-evaluates
-- `qty >= p_qty` against the already-decremented value, matches no
-- row, and is told there is no stock. Neither over-draws, and no
-- advisory lock or retry loop is needed.

create or replace function public.deduct_inventory(p_key text, p_qty integer)
returns table (ok boolean, remaining integer, err text)
language plpgsql
as $$
declare
  v_remaining integer;
begin
  if p_qty is null or p_qty <= 0 then
    return query select false, 0, 'invalid_quantity';
    return;
  end if;

  update public.inventory i
     set qty = i.qty - p_qty,
         updated_at = now()
   where (i.sku = p_key or (i.sku is null and i.name = p_key))
     and i.tenant_id = public.auth_tenant()
     and i.qty >= p_qty
  returning i.qty into v_remaining;

  if not found then
    -- Distinguish "no such row" from "not enough of it", because
    -- the UI says different things for each.
    select i.qty into v_remaining
      from public.inventory i
     where (i.sku = p_key or (i.sku is null and i.name = p_key))
       and i.tenant_id = public.auth_tenant();

    if v_remaining is null then
      return query select false, 0, 'not_found';
    else
      return query select false, v_remaining, 'insufficient_stock';
    end if;
    return;
  end if;

  -- An emptied line is removed rather than left at zero, so the
  -- shelf lists only what is actually on it.
  delete from public.inventory i
   where i.qty = 0
     and (i.sku = p_key or (i.sku is null and i.name = p_key))
     and i.tenant_id = public.auth_tenant();

  return query select true, v_remaining, null::text;
end;
$$;

-- ── restore_inventory ──────────────────────────────────────
-- Upsert on the unique (tenant, sku) / (tenant, name) indexes from
-- 0001, so a concurrent restore of the same part tops up one row
-- instead of racing to create two.

create or replace function public.restore_inventory(
  p_sku text, p_name text, p_qty integer, p_unit_price numeric default 0
)
returns table (ok boolean, remaining integer, err text)
language plpgsql
as $$
declare
  v_remaining integer;
begin
  if p_qty is null or p_qty <= 0 then
    return query select false, 0, 'invalid_quantity';
    return;
  end if;

  update public.inventory i
     set qty = i.qty + p_qty, updated_at = now()
   where i.tenant_id = public.auth_tenant()
     and (   (p_sku is not null and i.sku = p_sku)
          or (p_sku is null and i.sku is null and i.name = p_name))
  returning i.qty into v_remaining;

  if not found then
    insert into public.inventory (tenant_id, sku, name, qty, unit_price)
    values (public.auth_tenant(), p_sku, p_name, p_qty, coalesce(p_unit_price, 0))
    returning qty into v_remaining;
  end if;

  return query select true, v_remaining, null::text;
end;
$$;

-- ── add_to_project ─────────────────────────────────────────
-- The split rule, in one transaction: what is on the shelf comes
-- off now, the remainder becomes a project-tagged cart line. If the
-- deduction fails the whole call rolls back, so a part can never
-- land on the project without having left the shelf.

create or replace function public.add_to_project(
  p_project_id text, p_sku text, p_name text,
  p_qty integer, p_unit_price numeric default 0
)
returns table (ok boolean, taken integer, shortfall integer, remaining integer, err text)
language plpgsql
as $$
declare
  v_key       text := coalesce(p_sku, p_name);
  v_have      integer := 0;
  v_taken     integer := 0;
  v_short     integer := 0;
  v_remaining integer := 0;
  v_deduct    record;
  v_line      uuid;
begin
  if p_qty is null or p_qty <= 0 then
    return query select false, 0, 0, 0, 'invalid_quantity';
    return;
  end if;

  -- RLS makes this see only the caller's projects, so a bad id and
  -- another tenant's id are indistinguishable from here. Good.
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    return query select false, 0, 0, 0, 'project_not_found';
    return;
  end if;

  select i.qty into v_have
    from public.inventory i
   where i.tenant_id = public.auth_tenant()
     and (i.sku = v_key or (i.sku is null and i.name = v_key));

  v_have  := coalesce(v_have, 0);
  v_taken := least(p_qty, v_have);
  v_short := p_qty - v_taken;

  if v_taken > 0 then
    select * into v_deduct from public.deduct_inventory(v_key, v_taken);
    if not v_deduct.ok then
      -- Lost the race for the stock between the read and the
      -- deduction. Abandon the whole call; the client retries with
      -- a figure that is now correct.
      return query select false, 0, 0, v_deduct.remaining, v_deduct.err;
      return;
    end if;
    v_remaining := v_deduct.remaining;

    insert into public.project_items
      (tenant_id, project_id, sku, name, qty, source, unit_price, paid)
    values
      (public.auth_tenant(), p_project_id, p_sku, p_name, v_taken,
       'inventory', coalesce(p_unit_price, 0), true);
  end if;

  if v_short > 0 then
    insert into public.project_items
      (tenant_id, project_id, sku, name, qty, source, unit_price, paid)
    values
      (public.auth_tenant(), p_project_id, p_sku, p_name, v_short,
       'cart', coalesce(p_unit_price, 0), false)
    returning line_id into v_line;

    -- Same line_id on both sides, so checkout can match the cart
    -- line to the project row it is paying for.
    insert into public.cart_lines
      (line_id, tenant_id, project_id, sku, name, qty, unit_price)
    values
      (v_line, public.auth_tenant(), p_project_id, p_sku, p_name,
       v_short, coalesce(p_unit_price, 0));
  end if;

  return query select true, v_taken, v_short, v_remaining, null::text;
end;
$$;

-- ── remove_from_project ────────────────────────────────────
-- Returns the quantity to the shelf, unless it never left it. A
-- 'cart' line was never deducted, so removing it drops the cart
-- line instead; a 'supplied' line was never the studio's to hold.

create or replace function public.remove_from_project(
  p_project_id text, p_line_id uuid
)
returns table (ok boolean, restored integer, remaining integer, err text)
language plpgsql
as $$
declare
  v_item      public.project_items%rowtype;
  v_restore   record;
  v_restored  integer := 0;
  v_remaining integer := 0;
begin
  delete from public.project_items pi
   where pi.line_id = p_line_id and pi.project_id = p_project_id
  returning * into v_item;

  if not found then
    return query select false, 0, 0, 'line_not_found';
    return;
  end if;

  if v_item.source = 'cart' then
    delete from public.cart_lines cl where cl.line_id = p_line_id;
  elsif v_item.source <> 'supplied' then
    select * into v_restore from public.restore_inventory(
      v_item.sku, v_item.name, v_item.qty, v_item.unit_price);
    v_restored  := v_item.qty;
    v_remaining := v_restore.remaining;
  end if;

  return query select true, v_restored, v_remaining, null::text;
end;
$$;

-- ── add_to_cart ────────────────────────────────────────────
-- An untagged line: bought for the shelf, not for a project.

create or replace function public.add_to_cart(
  p_sku text, p_name text, p_qty integer, p_unit_price numeric default 0
)
returns table (ok boolean, line_id uuid, qty integer, err text)
language plpgsql
as $$
declare
  v_line uuid;
  v_qty  integer;
begin
  if p_qty is null or p_qty <= 0 then
    return query select false, null::uuid, 0, 'invalid_quantity';
    return;
  end if;

  update public.cart_lines cl
     set qty = cl.qty + p_qty
   where cl.tenant_id = public.auth_tenant()
     and cl.project_id is null
     and cl.sku is not distinct from p_sku
  returning cl.line_id, cl.qty into v_line, v_qty;

  if not found then
    insert into public.cart_lines (tenant_id, project_id, sku, name, qty, unit_price)
    values (public.auth_tenant(), null, p_sku, p_name, p_qty, coalesce(p_unit_price, 0))
    returning line_id, qty into v_line, v_qty;
  end if;

  return query select true, v_line, v_qty, null::text;
end;
$$;

-- ── grants ─────────────────────────────────────────────────
-- RLS still applies inside every one of these.

grant execute on function public.deduct_inventory(text, integer)                        to authenticated;
grant execute on function public.restore_inventory(text, text, integer, numeric)        to authenticated;
grant execute on function public.add_to_project(text, text, text, integer, numeric)     to authenticated;
grant execute on function public.remove_from_project(text, uuid)                        to authenticated;
grant execute on function public.add_to_cart(text, text, integer, numeric)              to authenticated;
