begin;

do $$
declare
  family_row record;
  next_code text;
begin
  for family_row in
    select id from public.families where invite_code !~ '^[A-Z0-9]{4}$'
  loop
    loop
      next_code := upper(substr(md5(family_row.id::text || gen_random_uuid()::text), 1, 4));
      exit when not exists (select 1 from public.families where upper(invite_code) = next_code);
    end loop;
    update public.families set invite_code = next_code where id = family_row.id;
  end loop;
end;
$$;

alter table public.families drop constraint if exists families_invite_code_length_check;
alter table public.families add constraint families_invite_code_length_check
  check (invite_code ~ '^[A-Z0-9]{4}$');

create or replace function public.register_app_user(
  p_username text,
  p_email text,
  p_password text,
  p_role text,
  p_family_name text default null,
  p_invite_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  clean_username text := btrim(coalesce(p_username, ''));
  clean_email text := lower(btrim(coalesce(p_email, '')));
  clean_role text := lower(btrim(coalesce(p_role, '')));
  clean_invite_code text := upper(btrim(coalesce(p_invite_code, '')));
  new_user_id uuid := gen_random_uuid();
  target_family_id uuid;
  target_owner_id uuid;
  new_token uuid := gen_random_uuid();
  new_expiry timestamptz := now() + interval '7 days';
begin
  if char_length(clean_username) not between 2 and 40 then return jsonb_build_object('error', 'INVALID_USERNAME'); end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return jsonb_build_object('error', 'INVALID_EMAIL'); end if;
  if char_length(coalesce(p_password, '')) < 8 then return jsonb_build_object('error', 'WEAK_PASSWORD'); end if;
  if clean_role not in ('owner', 'shopper') then return jsonb_build_object('error', 'INVALID_ROLE'); end if;
  if exists (select 1 from public.users where lower(btrim(username)) = lower(clean_username)) then return jsonb_build_object('error', 'USERNAME_TAKEN'); end if;
  if exists (select 1 from public.users where lower(email) = clean_email) then return jsonb_build_object('error', 'EMAIL_TAKEN'); end if;
  if clean_invite_code !~ '^[A-Z0-9]{4}$' then return jsonb_build_object('error', 'INVALID_FAMILY_CODE'); end if;

  if clean_role = 'owner' then
    if char_length(btrim(coalesce(p_family_name, ''))) not between 1 and 80 then return jsonb_build_object('error', 'FAMILY_NAME_REQUIRED'); end if;
    if exists (select 1 from public.families where upper(invite_code) = clean_invite_code) then return jsonb_build_object('error', 'INVITE_TAKEN'); end if;
  else
    select f.id, f.created_by into target_family_id, target_owner_id
      from public.families f where upper(f.invite_code) = clean_invite_code;
    if not found then return jsonb_build_object('error', 'INVALID_INVITE'); end if;
  end if;

  insert into public.users (id, username, email, password_hash, role, shops_for_user_id, is_admin)
  values (
    new_user_id, clean_username, clean_email, crypt(p_password, gen_salt('bf', 12)),
    clean_role::public.user_role,
    case when clean_role = 'shopper' then target_owner_id else null end,
    false
  );

  if clean_role = 'owner' then
    insert into public.families (name, invite_code, created_by, legacy_owner_id)
    values (btrim(p_family_name), clean_invite_code, new_user_id, new_user_id)
    returning id into target_family_id;
    insert into public.family_members (family_id, user_id, member_role)
    values (target_family_id, new_user_id, 'manager');
  else
    insert into public.family_members (family_id, user_id, member_role)
    values (target_family_id, new_user_id, 'shopper');
  end if;

  insert into public.sessions (token, user_id, expires_at)
  values (new_token, new_user_id, new_expiry);
  return public.get_app_session(new_token::text);
exception when unique_violation then
  return jsonb_build_object('error', 'ACCOUNT_EXISTS');
end;
$$;

create or replace function public.login_app_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  matched_user public.users%rowtype;
  new_token uuid := gen_random_uuid();
  new_expiry timestamptz := now() + interval '7 days';
begin
  select * into matched_user from public.users
   where lower(btrim(username)) = lower(btrim(coalesce(p_username, '')))
     and deleted_at is null
   for update;
  if not found or matched_user.password_hash is null
     or crypt(coalesce(p_password, ''), matched_user.password_hash) <> matched_user.password_hash then
    return jsonb_build_object('error', 'INVALID_CREDENTIALS');
  end if;

  update public.users set failed_login_attempts = 0, locked_until = null where id = matched_user.id;
  delete from public.sessions where user_id = matched_user.id and expires_at <= now();
  insert into public.sessions (token, user_id, expires_at) values (new_token, matched_user.id, new_expiry);
  return public.get_app_session(new_token::text);
end;
$$;

update public.users set failed_login_attempts = 0, locked_until = null;

update public.users
   set is_admin = true, is_system_admin = true
 where username = 'יהב' and deleted_at is null;

create or replace function public.get_app_session(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  ctx record;
  system_admin boolean;
  home_family uuid;
  selected_admin_family uuid;
begin
  select * into ctx from app_private.session_context(p_session_token);
  select u.is_system_admin, fm.family_id, s.admin_family_id
    into system_admin, home_family, selected_admin_family
    from public.users u
    join public.sessions s on s.user_id = u.id and s.token::text = p_session_token
    left join public.family_members fm on fm.user_id = u.id
   where u.id = ctx.user_id;
  return jsonb_build_object(
    'token', p_session_token,
    'expires_at', ctx.expires_at,
    'user_id', ctx.user_id,
    'username', ctx.username,
    'role', ctx.app_role,
    'is_admin', ctx.is_admin,
    'is_system_admin', coalesce(system_admin, false),
    'family_id', ctx.family_id,
    'home_family_id', home_family,
    'admin_family_id', selected_admin_family,
    'family_name', ctx.family_name,
    'member_role', ctx.member_role,
    'owner_id', ctx.anchor_owner_id,
    'needs_password_setup', ctx.needs_password_setup
  );
exception when sqlstate '42501' then
  return jsonb_build_object('error', 'SESSION_EXPIRED');
end;
$$;

do $$
declare
  old_admin_id uuid;
begin
  select id into old_admin_id from public.users
   where lower(btrim(username)) = 'admin' and deleted_at is null limit 1;
  if old_admin_id is not null then
    perform app_private.deactivate_app_user(old_admin_id);
  end if;
end;
$$;

revoke all on function public.register_app_user(text, text, text, text, text, text) from public;
revoke all on function public.login_app_user(text, text) from public;
grant execute on function public.register_app_user(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.login_app_user(text, text) to anon, authenticated;

commit;
