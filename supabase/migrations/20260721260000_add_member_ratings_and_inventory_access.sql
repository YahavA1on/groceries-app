begin;

create or replace function public.get_family_rating_overview(p_session_token text)
returns jsonb
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

  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'username', u.username,
        'member_role', fm.member_role,
        'joined_at', fm.joined_at
      ) order by u.created_at, fm.joined_at, u.id)
      from public.family_members fm
      join public.users u on u.id = fm.user_id
      where fm.family_id = ctx.family_id and u.deleted_at is null
    ), '[]'::jsonb),
    'ratings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', r.owner_id,
        'food_id', r.food_id,
        'rating', r.rating,
        'updated_at', r.updated_at
      ) order by r.updated_at desc)
      from public.ratings r
      where r.family_id = ctx.family_id
    ), '[]'::jsonb)
  );
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
  if ctx.family_id is null or not exists (
    select 1 from public.family_members
     where family_id = ctx.family_id and user_id = ctx.user_id
  ) then
    raise exception 'User is not assigned to this family' using errcode = '42501';
  end if;
  if p_rating not between 1 and 10 then
    raise exception 'Rating must be between 1 and 10' using errcode = '22023';
  end if;

  insert into public.ratings (owner_id, family_id, food_id, rating, updated_at)
  values (ctx.user_id, ctx.family_id, p_food_id, p_rating, now())
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
  delete from public.ratings
   where family_id = ctx.family_id and food_id = p_food_id and owner_id = ctx.user_id;
  return found;
end;
$$;

create or replace function public.add_family_receipt_inventory_items(
  p_session_token text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  item record;
  added_count integer := 0;
  removed_request_count integer := 0;
  imported_food_ids uuid[] := array[]::uuid[];
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;

  for item in
    select value->>'food_id' as food_id, (value->>'quantity')::numeric as quantity
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if item.food_id is null or coalesce(item.quantity, 0) <= 0 then continue; end if;

    insert into public.inventory (owner_id, family_id, food_id, quantity)
    values (ctx.anchor_owner_id, ctx.family_id, item.food_id::uuid, item.quantity)
    on conflict (owner_id, food_id)
    do update set quantity = public.inventory.quantity + excluded.quantity, family_id = excluded.family_id;

    insert into public.inventory_additions (family_id, food_id, quantity, added_by, source)
    values (ctx.family_id, item.food_id::uuid, item.quantity, ctx.user_id, 'receipt');

    imported_food_ids := array_append(imported_food_ids, item.food_id::uuid);
    added_count := added_count + 1;
  end loop;

  delete from public.shopping_list
   where family_id = ctx.family_id and food_id = any(imported_food_ids);
  get diagnostics removed_request_count = row_count;

  return jsonb_build_object('added_count', added_count, 'removed_request_count', removed_request_count);
end;
$$;

create or replace function public.add_receipt_catalog_food(
  p_session_token text,
  p_external_id text,
  p_name text,
  p_manufacturer text,
  p_category text,
  p_unit_qty text,
  p_picture_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  saved_food public.foods%rowtype;
  clean_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
  requested_identity text := public.product_identity_key(p_name, p_manufacturer, p_unit_qty);
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0
     or char_length(btrim(coalesce(p_manufacturer, ''))) = 0
     or char_length(btrim(coalesce(p_category, ''))) = 0
     or char_length(btrim(coalesce(p_unit_qty, ''))) = 0 then
    raise exception 'Receipt product data is incomplete' using errcode = '22023';
  end if;

  select * into saved_food
    from public.foods
   where (clean_external_id is not null and external_id = clean_external_id)
      or public.product_identity_key(name, manufacturer, unit_qty) = requested_identity
   order by case when external_id = clean_external_id then 0 else 1 end
   limit 1;
  if found then return to_jsonb(saved_food); end if;

  insert into public.foods (
    source, external_id, name, manufacturer, unit_qty, picture_url,
    category, created_by, updated_at
  ) values (
    'receipt',
    coalesce(clean_external_id, 'receipt_' || replace(gen_random_uuid()::text, '-', '')),
    btrim(p_name), btrim(p_manufacturer), btrim(p_unit_qty),
    coalesce(nullif(btrim(coalesce(p_picture_url, '')), ''), '/groceries-app/product-placeholder.svg'),
    btrim(p_category), ctx.user_id, now()
  )
  returning * into saved_food;
  return to_jsonb(saved_food);
end;
$$;

revoke all on function public.get_family_rating_overview(text) from public;
revoke all on function public.save_family_rating(text, uuid, integer) from public;
revoke all on function public.delete_family_rating(text, uuid) from public;
revoke all on function public.add_family_receipt_inventory_items(text, jsonb) from public;
revoke all on function public.add_receipt_catalog_food(text, text, text, text, text, text, text) from public;
grant execute on function public.get_family_rating_overview(text) to anon, authenticated;
grant execute on function public.save_family_rating(text, uuid, integer) to anon, authenticated;
grant execute on function public.delete_family_rating(text, uuid) to anon, authenticated;
grant execute on function public.add_family_receipt_inventory_items(text, jsonb) to anon, authenticated;
grant execute on function public.add_receipt_catalog_food(text, text, text, text, text, text, text) to anon, authenticated;

commit;
