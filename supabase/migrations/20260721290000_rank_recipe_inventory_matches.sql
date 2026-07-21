begin;

alter table public.recipe_suggestions
  add column if not exists inventory_match_percent integer not null default 0
  check (inventory_match_percent between 0 and 100);

create or replace function public.cache_family_recipe_suggestions(
  p_session_token text,
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
  clean_rating numeric;
  clean_time integer;
  clean_url text;
  clean_match integer;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_recipes, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_recipes, '[]'::jsonb)) > 12 then
    raise exception 'Invalid recipe cache payload' using errcode = '22023';
  end if;

  for recipe in select value from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb))
  loop
    clean_rating := nullif(recipe->>'rating', '')::numeric;
    clean_time := nullif(recipe->>'total_time_minutes', '')::integer;
    clean_url := btrim(coalesce(recipe->>'source_url', ''));
    clean_match := greatest(0, least(100, coalesce(nullif(recipe->>'inventory_match_percent', '')::integer, 0)));
    if char_length(btrim(coalesce(recipe->>'external_key', ''))) = 0
       or char_length(btrim(coalesce(recipe->>'title', ''))) = 0
       or clean_rating < 4 or clean_rating > 5
       or clean_time <= 0
       or clean_url !~ '^https://'
       or jsonb_typeof(coalesce(recipe->'ingredients', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(recipe->'ingredients', '[]'::jsonb)) > 40 then
      continue;
    end if;

    insert into public.recipe_suggestions (
      family_id, external_key, title, source_name, source_url, rating, reviews,
      total_time_minutes, image_url, servings, ingredients, inventory_match_percent, updated_at
    ) values (
      ctx.family_id,
      left(btrim(recipe->>'external_key'), 300),
      left(btrim(recipe->>'title'), 300),
      left(coalesce(nullif(btrim(recipe->>'source_name'), ''), 'מקור המתכון'), 200),
      left(clean_url, 2000),
      clean_rating,
      greatest(0, coalesce(nullif(recipe->>'reviews', '')::integer, 0)),
      clean_time,
      nullif(left(btrim(coalesce(recipe->>'image_url', '')), 2000), ''),
      nullif(recipe->>'servings', '')::numeric,
      recipe->'ingredients',
      clean_match,
      now()
    )
    on conflict (family_id, external_key) do update set
      title = excluded.title,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      rating = excluded.rating,
      reviews = excluded.reviews,
      total_time_minutes = excluded.total_time_minutes,
      image_url = excluded.image_url,
      servings = excluded.servings,
      ingredients = excluded.ingredients,
      inventory_match_percent = excluded.inventory_match_percent,
      updated_at = now();
    saved_count := saved_count + 1;
  end loop;

  delete from public.recipe_suggestions
   where family_id = ctx.family_id and updated_at < now() - interval '30 days';
  return saved_count;
end;
$$;

create or replace function public.list_family_recipe_suggestions(p_session_token text)
returns setof public.recipe_suggestions
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.family_id is null then
    raise exception 'User is not assigned to a family' using errcode = '42501';
  end if;
  return query
    select recipe.* from public.recipe_suggestions recipe
     where recipe.family_id = ctx.family_id
       and recipe.updated_at >= now() - interval '30 days'
     order by recipe.inventory_match_percent desc, recipe.rating desc,
              recipe.reviews desc, recipe.updated_at desc
     limit 12;
end;
$$;

revoke all on function public.cache_family_recipe_suggestions(text, jsonb) from public;
revoke all on function public.list_family_recipe_suggestions(text) from public;
grant execute on function public.cache_family_recipe_suggestions(text, jsonb) to anon, authenticated;
grant execute on function public.list_family_recipe_suggestions(text) to anon, authenticated;

commit;
