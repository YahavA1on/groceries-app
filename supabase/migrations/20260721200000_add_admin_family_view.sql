begin;

alter table public.users
  add column if not exists is_system_admin boolean not null default false;
alter table public.sessions
  add column if not exists admin_family_id uuid references public.families(id) on delete set null;

update public.users
   set is_admin = true,
       is_system_admin = true
 where lower(btrim(username)) = 'admin';

create index if not exists sessions_admin_family_idx
  on public.sessions (admin_family_id)
  where admin_family_id is not null;

create or replace function app_private.session_context(p_session_token text)
returns table (
  user_id uuid,
  username text,
  app_role text,
  is_admin boolean,
  family_id uuid,
  family_name text,
  member_role text,
  anchor_owner_id uuid,
  expires_at timestamptz,
  needs_password_setup boolean
)
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  resolved_user_id uuid;
begin
  select s.user_id into resolved_user_id
    from public.sessions s
   where s.token::text = p_session_token
     and s.expires_at > now()
   limit 1;

  if resolved_user_id is null then
    raise exception 'Invalid or expired session' using errcode = '42501';
  end if;

  perform set_config('app.actor_user_id', resolved_user_id::text, true);

  return query
  select
    u.id,
    u.username::text,
    u.role::text,
    u.is_admin,
    selected_family.id,
    selected_family.name::text,
    case
      when u.is_system_admin and s.admin_family_id is not null then 'manager'::text
      else fm.member_role::text
    end,
    selected_family.created_by,
    s.expires_at,
    (u.password_hash is null)
  from public.sessions s
  join public.users u on u.id = s.user_id
  left join public.family_members fm on fm.user_id = u.id
  left join public.families selected_family on selected_family.id = case
    when u.is_system_admin and s.admin_family_id is not null then s.admin_family_id
    else fm.family_id
  end
  where s.token::text = p_session_token
    and s.user_id = resolved_user_id
    and s.expires_at > now()
  limit 1;
end;
$$;

revoke all on function app_private.session_context(text) from public, anon, authenticated;

create or replace function public.get_app_session(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  ctx record;
  system_admin boolean;
begin
  select * into ctx from app_private.session_context(p_session_token);
  select u.is_system_admin into system_admin from public.users u where u.id = ctx.user_id;
  return jsonb_build_object(
    'token', p_session_token,
    'expires_at', ctx.expires_at,
    'user_id', ctx.user_id,
    'username', ctx.username,
    'role', ctx.app_role,
    'is_admin', ctx.is_admin,
    'is_system_admin', coalesce(system_admin, false),
    'family_id', ctx.family_id,
    'family_name', ctx.family_name,
    'member_role', ctx.member_role,
    'owner_id', ctx.anchor_owner_id,
    'needs_password_setup', ctx.needs_password_setup
  );
exception when sqlstate '42501' then
  return jsonb_build_object('error', 'SESSION_EXPIRED');
end;
$$;

create or replace function public.admin_select_family_context(
  p_session_token text,
  p_family_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if not exists (
    select 1 from public.users u
     where u.id = ctx.user_id and u.is_admin and u.is_system_admin
  ) then
    raise exception 'System administrator access required' using errcode = '42501';
  end if;
  if p_family_id is not null and not exists (select 1 from public.families f where f.id = p_family_id) then
    raise exception 'Family not found' using errcode = 'P0002';
  end if;

  update public.sessions
     set admin_family_id = p_family_id
   where token::text = p_session_token and user_id = ctx.user_id;

  return public.get_app_session(p_session_token);
end;
$$;

revoke all on function public.admin_select_family_context(text, uuid) from public;
grant execute on function public.admin_select_family_context(text, uuid) to anon, authenticated;

commit;
