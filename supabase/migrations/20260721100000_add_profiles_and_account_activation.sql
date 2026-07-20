begin;

alter table public.users add column if not exists setup_code_hash text;
alter table public.users add column if not exists setup_code_expires_at timestamptz;

create or replace function public.create_legacy_setup_code(
  p_session_token text,
  p_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  ctx record;
  target_user public.users%rowtype;
  setup_code text := upper(encode(gen_random_bytes(6), 'hex'));
  setup_expiry timestamptz := now() + interval '24 hours';
begin
  select * into ctx from app_private.session_context(p_session_token);
  if not ctx.is_admin then
    raise exception 'Only the administrator can create activation codes' using errcode = '42501';
  end if;

  select * into target_user
    from public.users
   where lower(btrim(username)) = lower(btrim(coalesce(p_username, '')))
   for update;
  if not found then
    return jsonb_build_object('error', 'USER_NOT_FOUND');
  end if;
  if target_user.password_hash is not null then
    return jsonb_build_object('error', 'ALREADY_CONFIGURED');
  end if;

  update public.users
     set setup_code_hash = encode(digest(setup_code, 'sha256'), 'hex'),
         setup_code_expires_at = setup_expiry
   where id = target_user.id;

  insert into public.admin_audit_log (actor_user_id, action, entity_type, entity_id)
  values (ctx.user_id, 'create_activation_code', 'user', target_user.id::text);

  return jsonb_build_object(
    'username', target_user.username,
    'code', setup_code,
    'expires_at', setup_expiry
  );
end;
$$;

create or replace function public.activate_legacy_account(
  p_username text,
  p_email text,
  p_password text,
  p_setup_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  target_user public.users%rowtype;
  clean_email text := lower(btrim(coalesce(p_email, '')));
  clean_code_hash text := encode(digest(upper(btrim(coalesce(p_setup_code, ''))), 'sha256'), 'hex');
  new_token uuid := gen_random_uuid();
  new_expiry timestamptz := now() + interval '7 days';
begin
  select * into target_user
    from public.users
   where lower(btrim(username)) = lower(btrim(coalesce(p_username, '')))
   for update;

  if not found
     or target_user.password_hash is not null
     or target_user.setup_code_hash is null
     or target_user.setup_code_expires_at <= now()
     or target_user.setup_code_hash <> clean_code_hash then
    return jsonb_build_object('error', 'INVALID_SETUP_CODE');
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('error', 'INVALID_EMAIL');
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    return jsonb_build_object('error', 'WEAK_PASSWORD');
  end if;
  if exists (select 1 from public.users where lower(email) = clean_email and id <> target_user.id) then
    return jsonb_build_object('error', 'EMAIL_TAKEN');
  end if;

  update public.users
     set email = clean_email,
         password_hash = crypt(p_password, gen_salt('bf', 12)),
         setup_code_hash = null,
         setup_code_expires_at = null,
         failed_login_attempts = 0,
         locked_until = null
   where id = target_user.id;

  delete from public.sessions where user_id = target_user.id;
  insert into public.sessions (token, user_id, expires_at)
  values (new_token, target_user.id, new_expiry);
  return public.get_app_session(new_token::text);
end;
$$;

create or replace function public.update_app_profile(
  p_session_token text,
  p_username text,
  p_family_surname text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  clean_username text := btrim(coalesce(p_username, ''));
  clean_surname text := btrim(coalesce(p_family_surname, ''));
begin
  select * into ctx from app_private.session_context(p_session_token);
  if char_length(clean_username) not between 2 and 40 then
    return jsonb_build_object('error', 'INVALID_USERNAME');
  end if;
  if exists (
    select 1 from public.users
     where lower(btrim(username)) = lower(clean_username)
       and id <> ctx.user_id
  ) then
    return jsonb_build_object('error', 'USERNAME_TAKEN');
  end if;

  if p_family_surname is not null then
    if ctx.member_role <> 'manager' and not ctx.is_admin then
      raise exception 'Only household managers can rename the family' using errcode = '42501';
    end if;
    if char_length(clean_surname) not between 1 and 60 then
      return jsonb_build_object('error', 'INVALID_FAMILY_SURNAME');
    end if;
  end if;

  update public.users set username = clean_username where id = ctx.user_id;

  if p_family_surname is not null then
    update public.families
       set name = 'הבית של משפחת ' || clean_surname
     where id = ctx.family_id;
  end if;

  return public.get_app_session(p_session_token);
end;
$$;

create or replace function public.change_app_password(
  p_session_token text,
  p_current_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  ctx record;
  current_hash text;
begin
  select * into ctx from app_private.session_context(p_session_token);
  select password_hash into current_hash from public.users where id = ctx.user_id for update;

  if current_hash is null or crypt(coalesce(p_current_password, ''), current_hash) <> current_hash then
    return jsonb_build_object('error', 'INVALID_CURRENT_PASSWORD');
  end if;
  if char_length(coalesce(p_new_password, '')) < 8 then
    return jsonb_build_object('error', 'WEAK_PASSWORD');
  end if;

  update public.users
     set password_hash = crypt(p_new_password, gen_salt('bf', 12)),
         failed_login_attempts = 0,
         locked_until = null
   where id = ctx.user_id;
  delete from public.sessions
   where user_id = ctx.user_id and token::text <> p_session_token;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.create_legacy_setup_code(text, text) from public;
revoke all on function public.activate_legacy_account(text, text, text, text) from public;
revoke all on function public.update_app_profile(text, text, text) from public;
revoke all on function public.change_app_password(text, text, text) from public;

grant execute on function public.create_legacy_setup_code(text, text) to anon, authenticated;
grant execute on function public.activate_legacy_account(text, text, text, text) to anon, authenticated;
grant execute on function public.update_app_profile(text, text, text) to anon, authenticated;
grant execute on function public.change_app_password(text, text, text) to anon, authenticated;

commit;
