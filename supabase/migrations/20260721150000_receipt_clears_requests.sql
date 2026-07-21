begin;

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
  if ctx.member_role <> 'manager' and not ctx.is_admin then
    raise exception 'Only household managers can import receipts' using errcode = '42501';
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

    insert into public.inventory_additions (family_id, food_id, quantity, added_by, source)
    values (ctx.family_id, item.food_id::uuid, item.quantity, ctx.user_id, 'receipt');

    imported_food_ids := array_append(imported_food_ids, item.food_id::uuid);
    added_count := added_count + 1;
  end loop;

  delete from public.shopping_list
   where family_id = ctx.family_id
     and food_id = any(imported_food_ids);
  get diagnostics removed_request_count = row_count;

  return jsonb_build_object(
    'added_count', added_count,
    'removed_request_count', removed_request_count
  );
end;
$$;

revoke all on function public.add_family_receipt_inventory_items(text, jsonb) from public;
grant execute on function public.add_family_receipt_inventory_items(text, jsonb) to anon, authenticated;

commit;
