begin;

-- Shoppers can view household ratings, but only household members can create them.
delete from public.ratings r
using public.family_members fm
where fm.family_id = r.family_id
  and fm.user_id = r.owner_id
  and fm.member_role = 'shopper';

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
      where fm.family_id = ctx.family_id
        and fm.member_role = 'manager'
        and u.deleted_at is null
    ), '[]'::jsonb),
    'ratings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', r.owner_id,
        'food_id', r.food_id,
        'rating', r.rating,
        'updated_at', r.updated_at
      ) order by r.updated_at desc)
      from public.ratings r
      join public.family_members fm
        on fm.family_id = r.family_id
       and fm.user_id = r.owner_id
       and fm.member_role = 'manager'
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
  if ctx.family_id is null or ctx.member_role <> 'manager' then
    raise exception 'Only household members can rate products' using errcode = '42501';
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
  if ctx.family_id is null or ctx.member_role <> 'manager' then
    raise exception 'Only household members can remove ratings' using errcode = '42501';
  end if;

  delete from public.ratings
   where family_id = ctx.family_id and food_id = p_food_id and owner_id = ctx.user_id;
  return found;
end;
$$;

revoke all on function public.get_family_rating_overview(text) from public;
revoke all on function public.save_family_rating(text, uuid, integer) from public;
revoke all on function public.delete_family_rating(text, uuid) from public;
grant execute on function public.get_family_rating_overview(text) to anon, authenticated;
grant execute on function public.save_family_rating(text, uuid, integer) to anon, authenticated;
grant execute on function public.delete_family_rating(text, uuid) to anon, authenticated;

commit;
