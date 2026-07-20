begin;

do $$
declare
  mom_id uuid;
  ohad_id uuid;
  ohad_family_id uuid;
  ohad_family_members integer;
  temporary_mom_password constant text := '__SET_IN_SQL_EDITOR__';
begin
  if temporary_mom_password = '__SET_IN_SQL_EDITOR__' then
    raise exception 'Set temporary_mom_password before running this migration';
  end if;

  select id into mom_id
    from public.users
   where lower(btrim(username)) = lower('אמא')
   limit 1;
  if mom_id is null then
    raise exception 'The account אמא was not found';
  end if;

  update public.users
     set password_hash = extensions.crypt(temporary_mom_password, extensions.gen_salt('bf', 12)),
         setup_code_hash = null,
         setup_code_expires_at = null,
         failed_login_attempts = 0,
         locked_until = null
   where id = mom_id;
  delete from public.sessions where user_id = mom_id;

  select id into ohad_id
    from public.users
   where lower(btrim(username)) = lower('אוהד')
   limit 1;

  if ohad_id is not null then
    if exists (
      select 1 from public.users
       where shops_for_user_id = ohad_id and id <> ohad_id
    ) then
      raise exception 'OHAD_HAS_LINKED_SHOPPERS';
    end if;

    select family_id into ohad_family_id
      from public.family_members
     where user_id = ohad_id;

    if ohad_family_id is not null then
      select count(*) into ohad_family_members
        from public.family_members
       where family_id = ohad_family_id;
      if ohad_family_members > 1 then
        raise exception 'OHAD_FAMILY_HAS_OTHER_MEMBERS';
      end if;
    end if;

    delete from public.shopping_notes
     where family_id = ohad_family_id or owner_id = ohad_id or author_id = ohad_id;
    delete from public.imported_receipts where family_id = ohad_family_id;
    delete from public.purchases
     where family_id = ohad_family_id or owner_id = ohad_id or shopper_id = ohad_id;
    delete from public.ratings where family_id = ohad_family_id or owner_id = ohad_id;
    delete from public.shopping_list where family_id = ohad_family_id or owner_id = ohad_id;
    delete from public.inventory where family_id = ohad_family_id or owner_id = ohad_id;
    delete from public.family_members where user_id = ohad_id or family_id = ohad_family_id;
    delete from public.families where id = ohad_family_id;
    delete from public.admin_audit_log where actor_user_id = ohad_id;
    delete from public.sessions where user_id = ohad_id;
    delete from public.users where id = ohad_id;
  end if;
end;
$$;

drop function if exists public.create_legacy_setup_code(text, text);
drop function if exists public.activate_legacy_account(text, text, text, text);

alter table public.users drop column if exists setup_code_hash;
alter table public.users drop column if exists setup_code_expires_at;

commit;
