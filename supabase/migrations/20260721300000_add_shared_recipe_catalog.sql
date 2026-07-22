begin;

alter table public.families
  add column if not exists recipes_enabled boolean not null default false;

update public.families
   set recipes_enabled = true
 where lower(btrim(regexp_replace(name, '^הבית של משפחת\s*', '', 'i'))) = 'אלון'
    or upper(btrim(invite_code)) = '1234';

create table if not exists public.recipe_catalog (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  title text not null,
  source_name text not null,
  source_url text not null unique,
  rating numeric not null check (rating >= 4 and rating <= 5),
  reviews integer not null default 0 check (reviews >= 0),
  total_time_minutes integer not null check (total_time_minutes > 0),
  image_url text,
  servings numeric,
  ingredient_lines jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredient_lines) = 'array'),
  search_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipe_catalog_quality_idx
  on public.recipe_catalog (rating desc, reviews desc, updated_at desc);

create table if not exists public.recipe_search_log (
  search_key text primary key,
  last_searched_at timestamptz not null default now(),
  result_count integer not null default 0 check (result_count >= 0)
);

alter table public.recipe_catalog enable row level security;
alter table public.recipe_search_log enable row level security;
revoke all on public.recipe_catalog, public.recipe_search_log from anon, authenticated;

insert into public.recipe_catalog (
  external_key, title, source_name, source_url, rating, reviews,
  total_time_minutes, image_url, servings, ingredient_lines, updated_at
)
select distinct on (suggestion.external_key)
  suggestion.external_key,
  suggestion.title,
  suggestion.source_name,
  suggestion.source_url,
  suggestion.rating,
  suggestion.reviews,
  suggestion.total_time_minutes,
  suggestion.image_url,
  suggestion.servings,
  coalesce((
    select jsonb_agg(
      coalesce(nullif(btrim(item.value->>'required_text'), ''), nullif(btrim(item.value->>'name'), ''))
      order by item.ordinality
    ) filter (where coalesce(nullif(btrim(item.value->>'required_text'), ''), nullif(btrim(item.value->>'name'), '')) is not null)
    from jsonb_array_elements(suggestion.ingredients) with ordinality as item(value, ordinality)
  ), '[]'::jsonb),
  suggestion.updated_at
from public.recipe_suggestions suggestion
join public.families family on family.id = suggestion.family_id
where family.recipes_enabled
  and suggestion.title !~* '(סלט|salad)'
  and position(chr(65533) in suggestion.title) = 0
  and position(chr(65533) in suggestion.ingredients::text) = 0
order by suggestion.external_key, suggestion.updated_at desc
on conflict (external_key) do nothing;

delete from public.recipe_catalog
 where position(chr(65533) in title) > 0
    or position(chr(65533) in ingredient_lines::text) > 0
    or title like '%ï¿½%'
    or ingredient_lines::text like '%ï¿½%';

delete from public.recipe_suggestions suggestion
using public.families family
 where family.id = suggestion.family_id
   and family.recipes_enabled
   and (
     position(chr(65533) in suggestion.title) > 0
     or position(chr(65533) in suggestion.ingredients::text) > 0
     or suggestion.title like '%ï¿½%'
     or suggestion.ingredients::text like '%ï¿½%'
     or exists (
       select 1
         from jsonb_array_elements(suggestion.ingredients) ingredient
        where btrim(coalesce(ingredient->>'name', '')) = ''
           or btrim(coalesce(ingredient->>'required_text', '')) = ''
     )
   );

create or replace function public.get_family_details(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  family_row public.families%rowtype;
begin
  select * into ctx from app_private.session_context(p_session_token);
  select * into family_row from public.families where id = ctx.family_id;
  return jsonb_build_object(
    'id', ctx.family_id,
    'name', ctx.family_name,
    'member_role', ctx.member_role,
    'invite_code', case when ctx.member_role = 'manager' or ctx.is_admin then family_row.invite_code else null end,
    'recipes_enabled', coalesce(family_row.recipes_enabled, false)
  );
end;
$$;

create or replace function public.get_enabled_recipe_inventory_context(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null or not exists (
    select 1 from public.families where id = ctx.family_id and recipes_enabled
  ) then
    raise exception 'Recipe feature is not enabled for this family' using errcode = '42501';
  end if;
  return public.get_recipe_inventory_context(p_session_token);
end;
$$;

create or replace function public.list_shared_recipe_catalog(p_session_token text)
returns setof public.recipe_catalog
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null or not exists (
    select 1 from public.families where id = ctx.family_id and recipes_enabled
  ) then
    raise exception 'Recipe feature is not enabled for this family' using errcode = '42501';
  end if;
  return query
    select catalog.*
      from public.recipe_catalog catalog
     where catalog.title !~* '(סלט|salad)'
       and position(chr(65533) in catalog.title) = 0
       and position(chr(65533) in catalog.ingredient_lines::text) = 0
       and jsonb_array_length(catalog.ingredient_lines) > 0
     order by catalog.rating desc, catalog.reviews desc, catalog.updated_at desc
     limit 20;
end;
$$;

create or replace function public.claim_shared_recipe_search(
  p_session_token text,
  p_search_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  affected integer := 0;
  clean_key text := left(lower(btrim(coalesce(p_search_key, ''))), 300);
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null or not exists (
    select 1 from public.families where id = ctx.family_id and recipes_enabled
  ) then
    raise exception 'Recipe feature is not enabled for this family' using errcode = '42501';
  end if;
  if char_length(clean_key) < 2 then
    raise exception 'Invalid recipe search key' using errcode = '22023';
  end if;

  insert into public.recipe_search_log (search_key, last_searched_at, result_count)
  values (clean_key, now(), 0)
  on conflict (search_key) do update
    set last_searched_at = excluded.last_searched_at,
        result_count = 0
    where recipe_search_log.last_searched_at < now() - interval '30 days';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.cache_shared_recipe_catalog(
  p_session_token text,
  p_search_key text,
  p_recipes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  recipe jsonb;
  saved_count integer := 0;
  clean_key text := left(lower(btrim(coalesce(p_search_key, ''))), 300);
  clean_rating numeric;
  clean_time integer;
  clean_url text;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null or not exists (
    select 1 from public.families where id = ctx.family_id and recipes_enabled
  ) then
    raise exception 'Recipe feature is not enabled for this family' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_recipes, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_recipes, '[]'::jsonb)) > 8 then
    raise exception 'Invalid shared recipe payload' using errcode = '22023';
  end if;

  for recipe in select value from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb))
  loop
    clean_rating := nullif(recipe->>'rating', '')::numeric;
    clean_time := nullif(recipe->>'total_time_minutes', '')::integer;
    clean_url := btrim(coalesce(recipe->>'source_url', ''));
    if char_length(btrim(coalesce(recipe->>'external_key', ''))) = 0
       or char_length(btrim(coalesce(recipe->>'title', ''))) = 0
       or btrim(coalesce(recipe->>'title', '')) ~* '(סלט|salad)'
       or clean_rating < 4 or clean_rating > 5
       or clean_time <= 0
       or clean_url !~ '^https://'
       or jsonb_typeof(coalesce(recipe->'ingredient_lines', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(recipe->'ingredient_lines', '[]'::jsonb)) = 0
       or jsonb_array_length(coalesce(recipe->'ingredient_lines', '[]'::jsonb)) > 40 then
      continue;
    end if;

    insert into public.recipe_catalog (
      external_key, title, source_name, source_url, rating, reviews,
      total_time_minutes, image_url, servings, ingredient_lines, search_key, updated_at
    ) values (
      left(btrim(recipe->>'external_key'), 300),
      left(btrim(recipe->>'title'), 300),
      left(coalesce(nullif(btrim(recipe->>'source_name'), ''), 'מקור המתכון'), 200),
      left(clean_url, 2000),
      clean_rating,
      greatest(0, coalesce(nullif(recipe->>'reviews', '')::integer, 0)),
      clean_time,
      nullif(left(btrim(coalesce(recipe->>'image_url', '')), 2000), ''),
      nullif(recipe->>'servings', '')::numeric,
      recipe->'ingredient_lines',
      nullif(clean_key, ''),
      now()
    )
    on conflict (external_key) do update set
      title = excluded.title,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      rating = excluded.rating,
      reviews = excluded.reviews,
      total_time_minutes = excluded.total_time_minutes,
      image_url = excluded.image_url,
      servings = excluded.servings,
      ingredient_lines = excluded.ingredient_lines,
      search_key = coalesce(excluded.search_key, recipe_catalog.search_key),
      updated_at = now();
    saved_count := saved_count + 1;
  end loop;

  update public.recipe_search_log
     set result_count = saved_count
   where search_key = clean_key;
  return saved_count;
end;
$$;

create or replace function public.cache_enabled_family_recipe_suggestions(
  p_session_token text,
  p_recipes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null or not exists (
    select 1 from public.families where id = ctx.family_id and recipes_enabled
  ) then
    raise exception 'Recipe feature is not enabled for this family' using errcode = '42501';
  end if;
  return public.cache_family_recipe_suggestions(p_session_token, p_recipes);
end;
$$;

create or replace function public.list_enabled_family_recipe_suggestions(p_session_token text)
returns setof public.recipe_suggestions
language plpgsql
security definer
set search_path = public, app_private
as $$
declare ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null or not exists (
    select 1 from public.families where id = ctx.family_id and recipes_enabled
  ) then
    raise exception 'Recipe feature is not enabled for this family' using errcode = '42501';
  end if;
  return query
    select suggestion.*
     from public.list_family_recipe_suggestions(p_session_token) suggestion
     where suggestion.title !~* '(סלט|salad)'
       and position(chr(65533) in suggestion.title) = 0
       and position(chr(65533) in suggestion.ingredients::text) = 0
       and not exists (
         select 1
           from jsonb_array_elements(suggestion.ingredients) ingredient
          where btrim(coalesce(ingredient->>'name', '')) = ''
             or btrim(coalesce(ingredient->>'required_text', '')) = ''
       );
end;
$$;

create or replace function public.choose_enabled_family_recipe(
  p_session_token text,
  p_recipe_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null or not exists (
    select 1 from public.families where id = ctx.family_id and recipes_enabled
  ) then
    raise exception 'Recipe feature is not enabled for this family' using errcode = '42501';
  end if;
  return public.choose_family_recipe(p_session_token, p_recipe_id);
end;
$$;

revoke all on function public.get_recipe_inventory_context(text) from anon, authenticated;
revoke all on function public.cache_family_recipe_suggestions(text, jsonb) from anon, authenticated;
revoke all on function public.list_family_recipe_suggestions(text) from anon, authenticated;
revoke all on function public.choose_family_recipe(text, uuid) from anon, authenticated;

revoke all on function public.get_enabled_recipe_inventory_context(text) from public;
revoke all on function public.list_shared_recipe_catalog(text) from public;
revoke all on function public.claim_shared_recipe_search(text, text) from public;
revoke all on function public.cache_shared_recipe_catalog(text, text, jsonb) from public;
revoke all on function public.cache_enabled_family_recipe_suggestions(text, jsonb) from public;
revoke all on function public.list_enabled_family_recipe_suggestions(text) from public;
revoke all on function public.choose_enabled_family_recipe(text, uuid) from public;

grant execute on function public.get_enabled_recipe_inventory_context(text) to service_role;
grant execute on function public.list_shared_recipe_catalog(text) to service_role;
grant execute on function public.claim_shared_recipe_search(text, text) to service_role;
grant execute on function public.cache_shared_recipe_catalog(text, text, jsonb) to service_role;
grant execute on function public.cache_enabled_family_recipe_suggestions(text, jsonb) to service_role;
grant execute on function public.list_enabled_family_recipe_suggestions(text) to anon, authenticated;
grant execute on function public.choose_enabled_family_recipe(text, uuid) to anon, authenticated;

commit;
