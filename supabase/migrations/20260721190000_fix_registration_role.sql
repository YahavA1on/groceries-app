begin;

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

revoke all on function public.register_app_user(text, text, text, text, text, text) from public;
grant execute on function public.register_app_user(text, text, text, text, text, text) to anon, authenticated;

commit;
