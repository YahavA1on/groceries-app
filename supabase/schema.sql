-- Clean MVP grocery request schema for Supabase.
-- Run this in the Supabase SQL editor after enabling Email auth.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type public.request_status as enum ('pending', 'claimed', 'fulfilled', 'cancelled');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  barcode text,
  name text not null,
  price numeric(10, 2),
  image_url text,
  category text,
  brand text,
  unit_qty text,
  source text not null default 'rami-levy',
  source_payload jsonb not null default '{}'::jsonb,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  fulfiller_id uuid references public.profiles(id) on delete set null,
  status public.request_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  fulfilled_at timestamptz,
  constraint requests_no_self_fulfillment check (fulfiller_id is null or fulfiller_id <> requester_id),
  constraint requests_status_shape check (
    (status in ('pending', 'cancelled') and fulfiller_id is null and claimed_at is null and fulfilled_at is null)
    or (status = 'claimed' and fulfiller_id is not null and claimed_at is not null and fulfilled_at is null)
    or (status = 'fulfilled' and fulfiller_id is not null and claimed_at is not null and fulfilled_at is not null)
  )
);

create table if not exists public.request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  is_found boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, product_id)
);

create index if not exists products_category_idx on public.products(category);
create index if not exists products_name_idx on public.products using gin (to_tsvector('simple', name));
create index if not exists requests_requester_idx on public.requests(requester_id, created_at desc);
create index if not exists requests_fulfiller_idx on public.requests(fulfiller_id, updated_at desc);
create index if not exists requests_open_idx on public.requests(created_at desc) where status = 'pending';
create index if not exists request_items_request_idx on public.request_items(request_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists set_requests_updated_at on public.requests;
create trigger set_requests_updated_at
before update on public.requests
for each row execute function public.set_updated_at();

drop trigger if exists set_request_items_updated_at on public.request_items;
create trigger set_request_items_updated_at
before update on public.request_items
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), 'משתמש')
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(nullif(excluded.display_name, ''), public.profiles.display_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.requests enable row level security;
alter table public.request_items enable row level security;

drop policy if exists "Profiles are visible to authenticated users" on public.profiles;
create policy "Profiles are visible to authenticated users"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Authenticated users can view products" on public.products;
create policy "Authenticated users can view products"
on public.products for select
to authenticated
using (true);

drop policy if exists "Users can view relevant requests" on public.requests;
create policy "Users can view relevant requests"
on public.requests for select
to authenticated
using (
  requester_id = auth.uid()
  or fulfiller_id = auth.uid()
  or (status = 'pending' and requester_id <> auth.uid())
);

drop policy if exists "Users can create their own pending requests" on public.requests;
create policy "Users can create their own pending requests"
on public.requests for insert
to authenticated
with check (
  requester_id = auth.uid()
  and status = 'pending'
  and fulfiller_id is null
);

drop policy if exists "Requesters can update own pending requests" on public.requests;
create policy "Requesters can update own pending requests"
on public.requests for update
to authenticated
using (requester_id = auth.uid() and status = 'pending')
with check (
  requester_id = auth.uid()
  and status in ('pending', 'cancelled')
  and fulfiller_id is null
);

drop policy if exists "Fulfillers can update claimed requests" on public.requests;
create policy "Fulfillers can update claimed requests"
on public.requests for update
to authenticated
using (fulfiller_id = auth.uid() and status = 'claimed')
with check (
  fulfiller_id = auth.uid()
  and status in ('claimed', 'fulfilled')
);

drop policy if exists "Requesters can delete own pending requests" on public.requests;
create policy "Requesters can delete own pending requests"
on public.requests for delete
to authenticated
using (requester_id = auth.uid() and status = 'pending');

drop policy if exists "Users can view items for visible requests" on public.request_items;
create policy "Users can view items for visible requests"
on public.request_items for select
to authenticated
using (
  exists (
    select 1
    from public.requests r
    where r.id = request_items.request_id
      and (
        r.requester_id = auth.uid()
        or r.fulfiller_id = auth.uid()
        or (r.status = 'pending' and r.requester_id <> auth.uid())
      )
  )
);

drop policy if exists "Requesters can add items to own pending requests" on public.request_items;
create policy "Requesters can add items to own pending requests"
on public.request_items for insert
to authenticated
with check (
  exists (
    select 1
    from public.requests r
    where r.id = request_items.request_id
      and r.requester_id = auth.uid()
      and r.status = 'pending'
  )
);

drop policy if exists "Requesters and fulfillers can update allowed request items" on public.request_items;
create policy "Requesters and fulfillers can update allowed request items"
on public.request_items for update
to authenticated
using (
  exists (
    select 1
    from public.requests r
    where r.id = request_items.request_id
      and (
        (r.requester_id = auth.uid() and r.status = 'pending')
        or (r.fulfiller_id = auth.uid() and r.status = 'claimed')
      )
  )
)
with check (
  exists (
    select 1
    from public.requests r
    where r.id = request_items.request_id
      and (
        (r.requester_id = auth.uid() and r.status = 'pending')
        or (r.fulfiller_id = auth.uid() and r.status = 'claimed')
      )
  )
);

drop policy if exists "Requesters can delete items from own pending requests" on public.request_items;
create policy "Requesters can delete items from own pending requests"
on public.request_items for delete
to authenticated
using (
  exists (
    select 1
    from public.requests r
    where r.id = request_items.request_id
      and r.requester_id = auth.uid()
      and r.status = 'pending'
  )
);

create or replace function public.claim_request(p_request_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests;
begin
  update public.requests
  set status = 'claimed',
      fulfiller_id = auth.uid(),
      claimed_at = now(),
      updated_at = now()
  where id = p_request_id
    and status = 'pending'
    and requester_id <> auth.uid()
  returning * into v_request;

  if not found then
    raise exception 'Request is no longer available to claim';
  end if;

  return v_request;
end;
$$;

create or replace function public.fulfill_request(p_request_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.requests;
begin
  update public.requests
  set status = 'fulfilled',
      fulfilled_at = now(),
      updated_at = now()
  where id = p_request_id
    and status = 'claimed'
    and fulfiller_id = auth.uid()
  returning * into v_request;

  if not found then
    raise exception 'Request is not claimable by the current user';
  end if;

  return v_request;
end;
$$;

revoke all on function public.claim_request(uuid) from public;
revoke all on function public.fulfill_request(uuid) from public;
grant execute on function public.claim_request(uuid) to authenticated;
grant execute on function public.fulfill_request(uuid) to authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles, public.products, public.requests, public.request_items to authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.requests, public.request_items to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'requests'
  ) then
    alter publication supabase_realtime add table public.requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'request_items'
  ) then
    alter publication supabase_realtime add table public.request_items;
  end if;
end $$;
