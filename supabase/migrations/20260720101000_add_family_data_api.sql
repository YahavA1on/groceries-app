begin;

create or replace function public.list_family_inventory(p_session_token text)
returns setof public.inventory
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;
  return query select * from public.inventory where family_id = ctx.family_id;
end;
$$;

create or replace function public.get_family_inventory_quantities(
  p_session_token text,
  p_food_ids uuid[]
)
returns table (food_id uuid, quantity numeric)
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  return query
    select inv.food_id, inv.quantity::numeric
      from public.inventory inv
     where inv.family_id = ctx.family_id
       and inv.food_id = any(coalesce(p_food_ids, array[]::uuid[]));
end;
$$;

create or replace function public.set_family_inventory_quantity(
  p_session_token text,
  p_food_id uuid,
  p_quantity numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  clean_quantity numeric := greatest(0, coalesce(p_quantity, 0));
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;

  if clean_quantity = 0 then
    delete from public.inventory
     where family_id = ctx.family_id and food_id = p_food_id;
  else
    insert into public.inventory (owner_id, family_id, food_id, quantity)
    values (ctx.anchor_owner_id, ctx.family_id, p_food_id, clean_quantity)
    on conflict (owner_id, food_id)
    do update set quantity = excluded.quantity, family_id = excluded.family_id;
  end if;
  return clean_quantity;
end;
$$;

create or replace function public.add_family_inventory_items(
  p_session_token text,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  item record;
  added_count integer := 0;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;

  for item in
    select value->>'food_id' as food_id, (value->>'quantity')::numeric as quantity
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if item.food_id is null or coalesce(item.quantity, 0) <= 0 then
      continue;
    end if;
    insert into public.inventory (owner_id, family_id, food_id, quantity)
    values (ctx.anchor_owner_id, ctx.family_id, item.food_id::uuid, item.quantity)
    on conflict (owner_id, food_id)
    do update set
      quantity = public.inventory.quantity + excluded.quantity,
      family_id = excluded.family_id;
    added_count := added_count + 1;
  end loop;
  return added_count;
end;
$$;

create or replace function public.list_family_ratings(p_session_token text)
returns setof public.ratings
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  return query select * from public.ratings where family_id = ctx.family_id;
end;
$$;

create or replace function public.save_family_rating(
  p_session_token text,
  p_food_id uuid,
  p_rating integer
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.member_role <> 'manager' and not ctx.is_admin then
    raise exception 'Only household managers can rate products' using errcode = '42501';
  end if;
  if p_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10' using errcode = '22023';
  end if;

  insert into public.ratings (owner_id, family_id, food_id, rating, updated_at)
  values (ctx.anchor_owner_id, ctx.family_id, p_food_id, p_rating, now())
  on conflict (owner_id, food_id)
  do update set rating = excluded.rating, family_id = excluded.family_id, updated_at = now();
  return p_rating;
end;
$$;

create or replace function public.delete_family_rating(p_session_token text, p_food_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.member_role <> 'manager' and not ctx.is_admin then
    raise exception 'Only household managers can remove ratings' using errcode = '42501';
  end if;
  delete from public.ratings where family_id = ctx.family_id and food_id = p_food_id;
  return found;
end;
$$;

create or replace function public.list_family_shopping(p_session_token text)
returns setof public.shopping_list
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  return query
    select * from public.shopping_list
     where family_id = ctx.family_id
     order by added_at desc;
end;
$$;

create or replace function public.add_family_shopping_items(
  p_session_token text,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  item record;
  saved_count integer := 0;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;

  for item in
    select value->>'food_id' as food_id, (value->>'quantity')::numeric as quantity
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if item.food_id is null or coalesce(item.quantity, 0) <= 0 then
      continue;
    end if;
    insert into public.shopping_list (owner_id, family_id, food_id, quantity, in_cart)
    values (ctx.anchor_owner_id, ctx.family_id, item.food_id::uuid, item.quantity, false)
    on conflict (owner_id, food_id)
    do update set
      quantity = excluded.quantity,
      family_id = excluded.family_id,
      in_cart = false,
      added_at = now();
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;

create or replace function public.set_family_shopping_quantity(
  p_session_token text,
  p_item_id uuid,
  p_quantity numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  clean_quantity numeric := greatest(0, coalesce(p_quantity, 0));
begin
  select * into ctx from app_private.session_context(p_session_token);
  if clean_quantity = 0 then
    delete from public.shopping_list where id = p_item_id and family_id = ctx.family_id;
  else
    update public.shopping_list
       set quantity = clean_quantity
     where id = p_item_id and family_id = ctx.family_id;
  end if;
  return clean_quantity;
end;
$$;

create or replace function public.set_family_shopping_cart(
  p_session_token text,
  p_item_id uuid,
  p_in_cart boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  update public.shopping_list
     set in_cart = coalesce(p_in_cart, false)
   where id = p_item_id and family_id = ctx.family_id;
  return found;
end;
$$;

create or replace function public.delete_family_shopping_item(
  p_session_token text,
  p_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  delete from public.shopping_list where id = p_item_id and family_id = ctx.family_id;
  return found;
end;
$$;

create or replace function public.finish_family_shopping(p_session_token text)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  purchased_count integer := 0;
begin
  select * into ctx from app_private.session_context(p_session_token);

  insert into public.inventory (owner_id, family_id, food_id, quantity)
  select ctx.anchor_owner_id, ctx.family_id, sl.food_id, sl.quantity
    from public.shopping_list sl
   where sl.family_id = ctx.family_id and sl.in_cart
  on conflict (owner_id, food_id)
  do update set
    quantity = public.inventory.quantity + excluded.quantity,
    family_id = excluded.family_id;

  insert into public.purchases (
    owner_id, shopper_id, family_id, food_id, quantity, price_at_purchase, purchased_at
  )
  select
    ctx.anchor_owner_id,
    ctx.user_id,
    ctx.family_id,
    sl.food_id,
    sl.quantity,
    f.price,
    now()
  from public.shopping_list sl
  join public.foods f on f.id = sl.food_id
  where sl.family_id = ctx.family_id and sl.in_cart;

  get diagnostics purchased_count = row_count;
  delete from public.shopping_list where family_id = ctx.family_id and in_cart;
  return purchased_count;
end;
$$;

create or replace function public.list_family_notes(p_session_token text)
returns table (
  id uuid,
  family_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author_name text
)
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  return query
    select n.id, n.family_id, n.author_id, n.body, n.created_at, u.username::text
      from public.shopping_notes n
      join public.users u on u.id = n.author_id
     where n.family_id = ctx.family_id
     order by n.created_at desc;
end;
$$;

create or replace function public.add_family_note(p_session_token text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  new_note_id uuid;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 300 then
    raise exception 'Note must contain 1 to 300 characters' using errcode = '22023';
  end if;
  insert into public.shopping_notes (owner_id, family_id, author_id, body)
  values (ctx.anchor_owner_id, ctx.family_id, ctx.user_id, btrim(p_body))
  returning id into new_note_id;
  return new_note_id;
end;
$$;

create or replace function public.delete_family_note(p_session_token text, p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  delete from public.shopping_notes
   where id = p_note_id and family_id = ctx.family_id and author_id = ctx.user_id;
  return found;
end;
$$;

revoke all on function public.list_family_inventory(text) from public;
revoke all on function public.get_family_inventory_quantities(text, uuid[]) from public;
revoke all on function public.set_family_inventory_quantity(text, uuid, numeric) from public;
revoke all on function public.add_family_inventory_items(text, jsonb) from public;
revoke all on function public.list_family_ratings(text) from public;
revoke all on function public.save_family_rating(text, uuid, integer) from public;
revoke all on function public.delete_family_rating(text, uuid) from public;
revoke all on function public.list_family_shopping(text) from public;
revoke all on function public.add_family_shopping_items(text, jsonb) from public;
revoke all on function public.set_family_shopping_quantity(text, uuid, numeric) from public;
revoke all on function public.set_family_shopping_cart(text, uuid, boolean) from public;
revoke all on function public.delete_family_shopping_item(text, uuid) from public;
revoke all on function public.finish_family_shopping(text) from public;
revoke all on function public.list_family_notes(text) from public;
revoke all on function public.add_family_note(text, text) from public;
revoke all on function public.delete_family_note(text, uuid) from public;

grant execute on function public.list_family_inventory(text) to anon, authenticated;
grant execute on function public.get_family_inventory_quantities(text, uuid[]) to anon, authenticated;
grant execute on function public.set_family_inventory_quantity(text, uuid, numeric) to anon, authenticated;
grant execute on function public.add_family_inventory_items(text, jsonb) to anon, authenticated;
grant execute on function public.list_family_ratings(text) to anon, authenticated;
grant execute on function public.save_family_rating(text, uuid, integer) to anon, authenticated;
grant execute on function public.delete_family_rating(text, uuid) to anon, authenticated;
grant execute on function public.list_family_shopping(text) to anon, authenticated;
grant execute on function public.add_family_shopping_items(text, jsonb) to anon, authenticated;
grant execute on function public.set_family_shopping_quantity(text, uuid, numeric) to anon, authenticated;
grant execute on function public.set_family_shopping_cart(text, uuid, boolean) to anon, authenticated;
grant execute on function public.delete_family_shopping_item(text, uuid) to anon, authenticated;
grant execute on function public.finish_family_shopping(text) to anon, authenticated;
grant execute on function public.list_family_notes(text) to anon, authenticated;
grant execute on function public.add_family_note(text, text) to anon, authenticated;
grant execute on function public.delete_family_note(text, uuid) to anon, authenticated;

update public.inventory as inv
   set family_id = f.id
  from public.families f
 where inv.family_id is null and f.legacy_owner_id = inv.owner_id;
update public.purchases as purchase_row
   set family_id = f.id
  from public.families f
 where purchase_row.family_id is null and f.legacy_owner_id = purchase_row.owner_id;
update public.ratings as rating_row
   set family_id = f.id
  from public.families f
 where rating_row.family_id is null and f.legacy_owner_id = rating_row.owner_id;
update public.shopping_list as list_row
   set family_id = f.id
  from public.families f
 where list_row.family_id is null and f.legacy_owner_id = list_row.owner_id;
update public.shopping_notes as note_row
   set family_id = f.id
  from public.families f
 where note_row.family_id is null and f.legacy_owner_id = note_row.owner_id;
update public.imported_receipts as receipt_row
   set family_id = f.id
  from public.families f
 where receipt_row.family_id is null
   and f.legacy_owner_id = (select id from public.users where username = 'יהב' limit 1);

-- Repair legacy rows that were accidentally anchored to a shopper instead of
-- the household manager. The membership identifies the correct family.
update public.inventory as inv
   set family_id = fm.family_id,
       owner_id = f.created_by
  from public.family_members fm
  join public.families f on f.id = fm.family_id
 where inv.family_id is null
   and fm.user_id = inv.owner_id;

update public.purchases as purchase_row
   set family_id = fm.family_id,
       owner_id = f.created_by
  from public.family_members fm
  join public.families f on f.id = fm.family_id
 where purchase_row.family_id is null
   and fm.user_id = purchase_row.owner_id;

update public.ratings as rating_row
   set family_id = fm.family_id,
       owner_id = f.created_by
  from public.family_members fm
  join public.families f on f.id = fm.family_id
 where rating_row.family_id is null
   and fm.user_id = rating_row.owner_id;

update public.shopping_list as list_row
   set family_id = fm.family_id,
       owner_id = f.created_by
  from public.family_members fm
  join public.families f on f.id = fm.family_id
 where list_row.family_id is null
   and fm.user_id = list_row.owner_id;

update public.shopping_notes as note_row
   set family_id = fm.family_id,
       owner_id = f.created_by
  from public.family_members fm
  join public.families f on f.id = fm.family_id
 where note_row.family_id is null
   and fm.user_id = note_row.owner_id;

alter table public.inventory alter column family_id set not null;
alter table public.purchases alter column family_id set not null;
alter table public.ratings alter column family_id set not null;
alter table public.shopping_list alter column family_id set not null;
alter table public.shopping_notes alter column family_id set not null;
alter table public.imported_receipts alter column family_id set not null;

alter table public.foods enable row level security;
alter table public.imported_receipts enable row level security;
alter table public.inventory enable row level security;
alter table public.purchases enable row level security;
alter table public.ratings enable row level security;
alter table public.sessions enable row level security;
alter table public.shopping_list enable row level security;
alter table public.shopping_notes enable row level security;
alter table public.users enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.imported_receipts, public.inventory, public.purchases, public.ratings,
  public.sessions, public.shopping_list, public.shopping_notes, public.users,
  public.families, public.family_members, public.admin_audit_log from anon, authenticated;
revoke insert, update, delete on public.foods from anon, authenticated;
grant select on public.foods to anon, authenticated;

drop policy if exists foods_public_read on public.foods;
create policy foods_public_read on public.foods for select to anon, authenticated using (true);

do $$
declare
  proc regprocedure;
begin
  for proc in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('finish_shopping', 'list_shopping_notes', 'add_shopping_note', 'delete_shopping_note')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', proc);
  end loop;
end;
$$;

commit;
