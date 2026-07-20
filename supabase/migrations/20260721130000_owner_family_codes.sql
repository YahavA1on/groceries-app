begin;

create unique index if not exists families_invite_code_upper_uidx
  on public.families (upper(invite_code));

do $$
declare
  admin_family_id uuid;
begin
  select fm.family_id into admin_family_id
    from public.users u
    join public.family_members fm on fm.user_id = u.id
   where u.is_admin
   limit 1;

  if admin_family_id is null then
    raise exception 'The administrator family was not found';
  end if;
  if exists (
    select 1 from public.families
     where upper(invite_code) = '1234' and id <> admin_family_id
  ) then
    raise exception 'Family code 1234 is already in use';
  end if;

  update public.families set invite_code = '1234' where id = admin_family_id;
end;
$$;

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
  if char_length(clean_username) not between 2 and 40 then
    return jsonb_build_object('error', 'INVALID_USERNAME');
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('error', 'INVALID_EMAIL');
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    return jsonb_build_object('error', 'WEAK_PASSWORD');
  end if;
  if clean_role not in ('owner', 'shopper') then
    return jsonb_build_object('error', 'INVALID_ROLE');
  end if;
  if exists (select 1 from public.users where lower(btrim(username)) = lower(clean_username)) then
    return jsonb_build_object('error', 'USERNAME_TAKEN');
  end if;
  if exists (select 1 from public.users where lower(email) = clean_email) then
    return jsonb_build_object('error', 'EMAIL_TAKEN');
  end if;

  if clean_role = 'owner' then
    if char_length(btrim(coalesce(p_family_name, ''))) not between 1 and 80 then
      return jsonb_build_object('error', 'FAMILY_NAME_REQUIRED');
    end if;
    if clean_invite_code !~ '^[A-Z0-9]{4,12}$' then
      return jsonb_build_object('error', 'INVALID_FAMILY_CODE');
    end if;
    if exists (select 1 from public.families where upper(invite_code) = clean_invite_code) then
      return jsonb_build_object('error', 'INVITE_TAKEN');
    end if;
  else
    select f.id, f.created_by
      into target_family_id, target_owner_id
      from public.families f
     where upper(f.invite_code) = clean_invite_code;
    if not found then
      return jsonb_build_object('error', 'INVALID_INVITE');
    end if;
  end if;

  insert into public.users (id, username, email, password_hash, role, shops_for_user_id, is_admin)
  values (
    new_user_id,
    clean_username,
    clean_email,
    crypt(p_password, gen_salt('bf', 12)),
    clean_role,
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

commit;
