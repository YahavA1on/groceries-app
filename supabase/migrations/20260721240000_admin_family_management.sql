begin;

create or replace function public.admin_update_app_user(
  p_session_token text,
  p_user_id uuid,
  p_username text,
  p_email text,
  p_app_role text,
  p_family_id uuid default null,
  p_new_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
declare
  ctx record;
  target_user public.users%rowtype;
  clean_username text := btrim(coalesce(p_username, ''));
  clean_email text := lower(btrim(coalesce(p_email, '')));
  clean_role text := lower(btrim(coalesce(p_app_role, '')));
  old_family_id uuid;
  old_family_name text;
  new_family_owner_id uuid;
  successor_id uuid;
  member_count integer;
  actor_is_system_admin boolean;
begin
  select * into ctx from app_private.session_context(p_session_token);
  select is_system_admin into actor_is_system_admin from public.users where id = ctx.user_id;
  if not coalesce(actor_is_system_admin, false) then
    raise exception 'System administrator access required' using errcode = '42501';
  end if;

  select * into target_user
    from public.users
   where id = p_user_id and deleted_at is null
   for update;
  if not found then return jsonb_build_object('error', 'USER_NOT_FOUND'); end if;

  select fm.family_id, f.name into old_family_id, old_family_name
    from public.family_members fm
    join public.families f on f.id = fm.family_id
   where fm.user_id = p_user_id;

  if char_length(clean_username) not between 2 and 40 then
    return jsonb_build_object('error', 'INVALID_USERNAME');
  end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('error', 'INVALID_EMAIL');
  end if;
  if clean_role not in ('owner', 'shopper') then
    return jsonb_build_object('error', 'INVALID_ROLE');
  end if;
  if p_new_password is not null and char_length(p_new_password) < 8 then
    return jsonb_build_object('error', 'WEAK_PASSWORD');
  end if;
  if exists (
    select 1 from public.users
     where lower(btrim(username)) = lower(clean_username)
       and id <> p_user_id
  ) then return jsonb_build_object('error', 'USERNAME_TAKEN'); end if;
  if exists (
    select 1 from public.users
     where lower(btrim(email)) = clean_email
       and id <> p_user_id
  ) then return jsonb_build_object('error', 'EMAIL_TAKEN'); end if;

  if p_family_id is not null then
    select created_by into new_family_owner_id
      from public.families where id = p_family_id;
    if not found then return jsonb_build_object('error', 'FAMILY_NOT_FOUND'); end if;
  end if;

  if target_user.is_system_admin
     and (p_family_id is distinct from old_family_id or clean_role <> target_user.role::text) then
    return jsonb_build_object('error', 'PROTECTED_ADMIN_MEMBERSHIP');
  end if;

  if old_family_id is not null
     and p_family_id = old_family_id
     and clean_role = 'shopper'
     and exists (select 1 from public.families where id = old_family_id and created_by = p_user_id) then
    select fm.user_id into successor_id
      from public.family_members fm
      join public.users u on u.id = fm.user_id and u.deleted_at is null
     where fm.family_id = old_family_id and fm.user_id <> p_user_id
     order by (fm.member_role = 'manager') desc, fm.joined_at, fm.user_id
     limit 1;
    if successor_id is null then
      return jsonb_build_object('error', 'LAST_FAMILY_MANAGER');
    end if;

    update public.families
       set created_by = successor_id, legacy_owner_id = successor_id
     where id = old_family_id;
    update public.family_members set member_role = 'manager'
     where family_id = old_family_id and user_id = successor_id;
    update public.users set role = 'owner'::public.user_role, shops_for_user_id = null
     where id = successor_id;
    update public.users set shops_for_user_id = successor_id
     where id in (
       select user_id from public.family_members
        where family_id = old_family_id and user_id <> successor_id and user_id <> p_user_id
     );
    update public.inventory set owner_id = successor_id where family_id = old_family_id;
    update public.purchases set owner_id = successor_id where family_id = old_family_id;
    update public.ratings set owner_id = successor_id where family_id = old_family_id;
    update public.shopping_list set owner_id = successor_id where family_id = old_family_id;
    update public.shopping_notes set owner_id = successor_id where family_id = old_family_id;
    new_family_owner_id := successor_id;
  end if;

  if old_family_id is not null and p_family_id is distinct from old_family_id then
    select count(*) into member_count
      from public.family_members where family_id = old_family_id;
    if member_count <= 1 then
      return jsonb_build_object('error', 'LAST_FAMILY_MEMBER');
    end if;

    if exists (select 1 from public.families where id = old_family_id and created_by = p_user_id) then
      select fm.user_id into successor_id
        from public.family_members fm
        join public.users u on u.id = fm.user_id and u.deleted_at is null
       where fm.family_id = old_family_id and fm.user_id <> p_user_id
       order by (fm.member_role = 'manager') desc, fm.joined_at, fm.user_id
       limit 1;

      update public.families
         set created_by = successor_id, legacy_owner_id = successor_id
       where id = old_family_id;
      update public.family_members set member_role = 'manager'
       where family_id = old_family_id and user_id = successor_id;
      update public.users set role = 'owner'::public.user_role, shops_for_user_id = null
       where id = successor_id;
      update public.users set shops_for_user_id = successor_id
       where id in (
         select user_id from public.family_members
          where family_id = old_family_id and user_id <> successor_id and user_id <> p_user_id
       );
      update public.inventory set owner_id = successor_id where family_id = old_family_id;
      update public.purchases set owner_id = successor_id where family_id = old_family_id;
      update public.ratings set owner_id = successor_id where family_id = old_family_id;
      update public.shopping_list set owner_id = successor_id where family_id = old_family_id;
      update public.shopping_notes set owner_id = successor_id where family_id = old_family_id;
    end if;

    delete from public.family_members where user_id = p_user_id;
  end if;

  if p_family_id is not null then
    insert into public.family_members (family_id, user_id, member_role)
    values (p_family_id, p_user_id, case when clean_role = 'owner' then 'manager' else 'shopper' end)
    on conflict (user_id) do update
      set family_id = excluded.family_id, member_role = excluded.member_role;
  elsif old_family_id is not null then
    delete from public.family_members where user_id = p_user_id;
  end if;

  if p_family_id is distinct from old_family_id then
    if p_family_id is null then
      delete from public.push_subscriptions where user_id = p_user_id;
    else
      update public.push_subscriptions set family_id = p_family_id, updated_at = now()
       where user_id = p_user_id;
    end if;
  end if;

  update public.users
     set username = clean_username,
         email = clean_email,
         role = clean_role::public.user_role,
         shops_for_user_id = case when clean_role = 'shopper' and p_family_id is not null
           then new_family_owner_id else null end,
         password_hash = case when p_new_password is null then password_hash
           else crypt(p_new_password, gen_salt('bf', 12)) end,
         failed_login_attempts = 0,
         locked_until = null
   where id = p_user_id;

  if p_new_password is not null then
    delete from public.sessions where user_id = p_user_id and user_id <> ctx.user_id;
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, previous_data
  ) values (
    ctx.user_id, 'update_user', 'users', p_user_id::text,
    jsonb_build_object(
      'username', target_user.username,
      'email', target_user.email,
      'role', target_user.role,
      'family_id', old_family_id,
      'family_name', old_family_name
    )
  );

  return jsonb_build_object('success', true);
exception when unique_violation then
  return jsonb_build_object('error', 'ACCOUNT_EXISTS');
end;
$$;

create or replace function public.admin_delete_family(
  p_session_token text,
  p_family_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  target_family public.families%rowtype;
  removed_members integer;
  actor_is_system_admin boolean;
begin
  select * into ctx from app_private.session_context(p_session_token);
  select is_system_admin into actor_is_system_admin from public.users where id = ctx.user_id;
  if not coalesce(actor_is_system_admin, false) then
    raise exception 'System administrator access required' using errcode = '42501';
  end if;

  select * into target_family from public.families where id = p_family_id for update;
  if not found then return jsonb_build_object('error', 'FAMILY_NOT_FOUND'); end if;
  if exists (
    select 1 from public.family_members fm
    join public.users u on u.id = fm.user_id
    where fm.family_id = p_family_id and u.is_system_admin and u.deleted_at is null
  ) then return jsonb_build_object('error', 'PROTECTED_ADMIN_FAMILY'); end if;

  select count(*) into removed_members from public.family_members where family_id = p_family_id;

  insert into public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, previous_data
  ) values (
    ctx.user_id, 'delete_family', 'families', p_family_id::text,
    jsonb_build_object('name', target_family.name, 'invite_code', target_family.invite_code, 'members', removed_members)
  );

  update public.users set shops_for_user_id = null
   where id in (select user_id from public.family_members where family_id = p_family_id);
  delete from public.push_subscriptions where family_id = p_family_id;
  delete from public.inventory_additions where family_id = p_family_id;
  delete from public.imported_receipts where family_id = p_family_id;
  delete from public.purchases where family_id = p_family_id;
  delete from public.ratings where family_id = p_family_id;
  delete from public.shopping_list where family_id = p_family_id;
  delete from public.shopping_notes where family_id = p_family_id;
  delete from public.inventory where family_id = p_family_id;
  delete from public.family_members where family_id = p_family_id;
  delete from public.families where id = p_family_id;

  return jsonb_build_object('deleted', true, 'removed_members', removed_members);
end;
$$;

revoke all on function public.admin_update_app_user(text, uuid, text, text, text, uuid, text) from public;
revoke all on function public.admin_delete_family(text, uuid) from public;
grant execute on function public.admin_update_app_user(text, uuid, text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.admin_delete_family(text, uuid) to anon, authenticated;

commit;
