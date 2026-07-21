begin;

alter table public.users add column if not exists created_at timestamptz not null default now();
alter table public.users add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'families_name_format_check' and conrelid = 'public.families'::regclass
  ) then
    alter table public.families add constraint families_name_format_check check (
      name = btrim(name)
      and name !~ '[[:cntrl:]]'
      and name !~ '[0-9]'
      and name !~ '[[:space:]]{2,}'
    ) not valid;
  end if;
end;
$$;

create index if not exists users_active_created_idx
  on public.users (created_at desc) where deleted_at is null;

create or replace function app_private.deactivate_app_user(p_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  target_user public.users%rowtype;
  target_family public.families%rowtype;
  successor_id uuid;
  successor_name text;
begin
  select * into target_user from public.users where id = p_target_user_id for update;
  if not found or target_user.deleted_at is not null then
    return jsonb_build_object('error', 'USER_NOT_FOUND');
  end if;

  select f.* into target_family from public.families f
   where f.created_by = target_user.id limit 1 for update;

  if found then
    select fm.user_id, u.username into successor_id, successor_name
      from public.family_members fm
      join public.users u on u.id = fm.user_id
     where fm.family_id = target_family.id and fm.user_id <> target_user.id
       and u.deleted_at is null
     order by fm.joined_at, fm.user_id limit 1;

    if successor_id is not null then
      update public.families set created_by = successor_id, legacy_owner_id = successor_id
       where id = target_family.id;
      update public.family_members set member_role = case when user_id = successor_id then 'manager' else member_role end
       where family_id = target_family.id;
      update public.users
         set role = case when id = successor_id then 'owner'::public.user_role else role end,
             shops_for_user_id = case when id = successor_id then null else successor_id end
       where id in (select user_id from public.family_members where family_id = target_family.id)
         and id <> target_user.id;
      update public.inventory set owner_id = successor_id where family_id = target_family.id;
      update public.purchases set owner_id = successor_id where family_id = target_family.id;
      update public.ratings set owner_id = successor_id where family_id = target_family.id;
      update public.shopping_list set owner_id = successor_id where family_id = target_family.id;
      update public.shopping_notes set owner_id = successor_id where family_id = target_family.id;
    else
      delete from public.push_subscriptions where family_id = target_family.id;
      delete from public.inventory_additions where family_id = target_family.id;
      delete from public.imported_receipts where family_id = target_family.id;
      delete from public.purchases where family_id = target_family.id;
      delete from public.ratings where family_id = target_family.id;
      delete from public.shopping_list where family_id = target_family.id;
      delete from public.shopping_notes where family_id = target_family.id;
      delete from public.inventory where family_id = target_family.id;
      delete from public.family_members where family_id = target_family.id;
      delete from public.families where id = target_family.id;
    end if;
  end if;

  delete from public.push_subscriptions where user_id = target_user.id;
  delete from public.family_members where user_id = target_user.id;
  delete from public.sessions where user_id = target_user.id;

  update public.users
     set username = 'deleted_' || replace(id::text, '-', ''), email = null,
         password_hash = null, is_admin = false, is_system_admin = false,
         failed_login_attempts = 0, locked_until = null,
         shops_for_user_id = null, deleted_at = now()
   where id = target_user.id;

  return jsonb_build_object('deleted', true, 'family_transferred_to', successor_name);
end;
$$;

revoke all on function app_private.deactivate_app_user(uuid) from public, anon, authenticated;

create or replace function public.delete_own_app_account(p_session_token text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  ctx record;
  current_hash text;
  system_admin boolean;
begin
  select * into ctx from app_private.session_context(p_session_token);
  select password_hash, is_system_admin into current_hash, system_admin
    from public.users where id = ctx.user_id for update;
  if system_admin then return jsonb_build_object('error', 'PROTECTED_ADMIN'); end if;
  if current_hash is null or crypt(coalesce(p_password, ''), current_hash) <> current_hash then
    return jsonb_build_object('error', 'INVALID_CURRENT_PASSWORD');
  end if;
  return app_private.deactivate_app_user(ctx.user_id);
end;
$$;

create or replace function public.admin_delete_app_user(p_session_token text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  target_is_admin boolean;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if not ctx.is_admin then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_user_id = ctx.user_id then return jsonb_build_object('error', 'CANNOT_DELETE_SELF_HERE'); end if;
  select is_admin into target_is_admin from public.users where id = p_user_id and deleted_at is null;
  if not found then return jsonb_build_object('error', 'USER_NOT_FOUND'); end if;
  if target_is_admin then return jsonb_build_object('error', 'PROTECTED_ADMIN'); end if;
  return app_private.deactivate_app_user(p_user_id);
end;
$$;

create or replace function public.admin_list_users(p_session_token text)
returns table (
  user_id uuid, username text, email text, app_role text, member_role text,
  is_admin boolean, is_system_admin boolean, family_id uuid, family_name text,
  created_at timestamptz, last_login_at timestamptz, active_sessions bigint
)
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if not ctx.is_admin then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return query
  select u.id, u.username::text, u.email::text, u.role::text, fm.member_role::text,
         u.is_admin, u.is_system_admin, fm.family_id, f.name::text, u.created_at,
         (select max(a.occurred_at) from public.site_activity a
           where a.actor_user_id = u.id and a.entity_type = 'sessions' and a.action = 'insert'),
         (select count(*) from public.sessions s where s.user_id = u.id and s.expires_at > now())
    from public.users u
    left join public.family_members fm on fm.user_id = u.id
    left join public.families f on f.id = fm.family_id
   where u.deleted_at is null
   order by u.is_system_admin desc, u.is_admin desc, u.created_at desc, u.username;
end;
$$;

create or replace function public.admin_dashboard_summary(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if not ctx.is_admin then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'families', (select count(*) from public.families),
    'users', (select count(*) from public.users where deleted_at is null),
    'products', (select count(*) from public.foods),
    'pending_requests', (select count(*) from public.shopping_list),
    'purchases_7d', (select count(*) from public.purchases where purchased_at >= now() - interval '7 days'),
    'active_users_24h', (
      select count(distinct actor_user_id) from public.site_activity
       where occurred_at >= now() - interval '24 hours' and actor_user_id is not null
    )
  );
end;
$$;

revoke all on function public.delete_own_app_account(text, text) from public;
revoke all on function public.admin_delete_app_user(text, uuid) from public;
revoke all on function public.admin_list_users(text) from public;
grant execute on function public.delete_own_app_account(text, text) to anon, authenticated;
grant execute on function public.admin_delete_app_user(text, uuid) to anon, authenticated;
grant execute on function public.admin_list_users(text) to anon, authenticated;

commit;
