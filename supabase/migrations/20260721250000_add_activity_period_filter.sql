begin;

create or replace function public.admin_list_activity(
  p_session_token text,
  p_family_id uuid default null,
  p_limit integer default 500,
  p_before_id bigint default null,
  p_since timestamptz default null
)
returns table (
  activity_id bigint,
  occurred_at timestamptz,
  actor_user_id uuid,
  actor_name text,
  family_id uuid,
  family_name text,
  action text,
  entity_type text,
  entity_id text,
  details jsonb
)
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if not ctx.is_admin then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.occurred_at,
    a.actor_user_id,
    coalesce(u.username, 'מערכת')::text,
    a.family_id,
    coalesce(f.name, 'כללי')::text,
    a.action,
    a.entity_type,
    a.entity_id,
    a.details || jsonb_strip_nulls(jsonb_build_object(
      'food_name', (
        select food.name from public.foods food
         where food.id::text = a.details->>'food_id'
         limit 1
      )
    ))
  from public.site_activity a
  left join public.users u on u.id = a.actor_user_id
  left join public.families f on f.id = a.family_id
  where (p_family_id is null or a.family_id = p_family_id)
    and (p_before_id is null or a.id < p_before_id)
    and (p_since is null or a.occurred_at >= p_since)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end;
$$;

revoke all on function public.admin_list_activity(text, uuid, integer, bigint, timestamptz) from public;
grant execute on function public.admin_list_activity(text, uuid, integer, bigint, timestamptz) to anon, authenticated;

commit;
