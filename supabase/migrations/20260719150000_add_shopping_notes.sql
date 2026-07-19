create table if not exists public.shopping_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists shopping_notes_owner_created_idx
  on public.shopping_notes (owner_id, created_at desc);

alter table public.shopping_notes enable row level security;

revoke all on public.shopping_notes from anon, authenticated;

create or replace function public.list_shopping_notes(
  p_session_token text,
  p_owner_id uuid
)
returns table (
  id uuid,
  owner_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
begin
  select u.*
    into v_user
    from public.sessions s
    join public.users u on u.id = s.user_id
   where s.token::text = p_session_token
     and s.expires_at > now();

  if not found then
    raise exception 'Invalid or expired session' using errcode = '42501';
  end if;

  if v_user.id <> p_owner_id
     and not (v_user.role::text = 'shopper' and v_user.shops_for_user_id = p_owner_id) then
    raise exception 'Not allowed to view these notes' using errcode = '42501';
  end if;

  return query
    select n.id, n.owner_id, n.author_id, n.body, n.created_at, u.username::text
      from public.shopping_notes n
      join public.users u on u.id = n.author_id
     where n.owner_id = p_owner_id
     order by n.created_at desc;
end;
$$;

create or replace function public.add_shopping_note(
  p_session_token text,
  p_owner_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_note_id uuid;
begin
  select u.*
    into v_user
    from public.sessions s
    join public.users u on u.id = s.user_id
   where s.token::text = p_session_token
     and s.expires_at > now();

  if not found then
    raise exception 'Invalid or expired session' using errcode = '42501';
  end if;

  if v_user.id <> p_owner_id
     and not (v_user.role::text = 'shopper' and v_user.shops_for_user_id = p_owner_id) then
    raise exception 'Not allowed to add a note here' using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 300 then
    raise exception 'Note must contain 1 to 300 characters' using errcode = '22023';
  end if;

  insert into public.shopping_notes (owner_id, author_id, body)
  values (p_owner_id, v_user.id, btrim(p_body))
  returning shopping_notes.id into v_note_id;

  return v_note_id;
end;
$$;

create or replace function public.delete_shopping_note(
  p_session_token text,
  p_note_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select s.user_id
    into v_user_id
    from public.sessions s
   where s.token::text = p_session_token
     and s.expires_at > now();

  if not found then
    raise exception 'Invalid or expired session' using errcode = '42501';
  end if;

  delete from public.shopping_notes
   where shopping_notes.id = p_note_id
     and shopping_notes.author_id = v_user_id;

  return found;
end;
$$;

revoke all on function public.list_shopping_notes(text, uuid) from public;
revoke all on function public.add_shopping_note(text, uuid, text) from public;
revoke all on function public.delete_shopping_note(text, uuid) from public;

grant execute on function public.list_shopping_notes(text, uuid) to anon, authenticated;
grant execute on function public.add_shopping_note(text, uuid, text) to anon, authenticated;
grant execute on function public.delete_shopping_note(text, uuid) to anon, authenticated;
