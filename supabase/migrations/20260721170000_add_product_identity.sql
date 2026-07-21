begin;

create or replace function public.normalize_product_text(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    translate(lower(btrim(coalesce(p_value, ''))), 'ךםןףץ', 'כמנפצ'),
    '[^a-z0-9א-ת]+',
    '',
    'g'
  );
$$;

create or replace function public.normalize_product_weight(p_value text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  clean_value text := lower(btrim(coalesce(p_value, '')));
  number_text text;
  number_value numeric;
  number_count integer;
  canonical_number text;
begin
  clean_value := replace(clean_value, ',', '.');
  select count(*) into number_count
    from regexp_matches(clean_value, '[0-9]+[.]?[0-9]*', 'g');

  if number_count = 1 then
    number_text := substring(clean_value from '[0-9]+[.]?[0-9]*');
    number_value := number_text::numeric;

    if clean_value ~ '(ק.?ג|קילו|kg)' then
      number_value := number_value * 1000;
      canonical_number := regexp_replace(regexp_replace(number_value::text, '(\.[0-9]*?)0+$', '\1'), '\.$', '');
      return canonical_number || 'g';
    elsif clean_value ~ '(גרם|גרמים|גר|gram|grams|(^|[^a-z])g([^a-z]|$))' then
      canonical_number := regexp_replace(regexp_replace(number_value::text, '(\.[0-9]*?)0+$', '\1'), '\.$', '');
      return canonical_number || 'g';
    elsif clean_value ~ '(מ.?ל|milliliter|milliliters|ml)' then
      canonical_number := regexp_replace(regexp_replace(number_value::text, '(\.[0-9]*?)0+$', '\1'), '\.$', '');
      return canonical_number || 'ml';
    elsif clean_value ~ '(ליטר|ליטרים|liter|liters|litre|litres|(^|[^a-z])l([^a-z]|$))' then
      number_value := number_value * 1000;
      canonical_number := regexp_replace(regexp_replace(number_value::text, '(\.[0-9]*?)0+$', '\1'), '\.$', '');
      return canonical_number || 'ml';
    elsif clean_value ~ '(יחידה|יחידות|יח|unit|units)' then
      canonical_number := regexp_replace(regexp_replace(number_value::text, '(\.[0-9]*?)0+$', '\1'), '\.$', '');
      return canonical_number || 'unit';
    end if;
  end if;

  return public.normalize_product_text(clean_value);
end;
$$;

create or replace function public.product_identity_key(
  p_name text,
  p_manufacturer text,
  p_unit_qty text
)
returns text
language sql
immutable
parallel safe
as $$
  select public.normalize_product_text(p_name)
    || '|' || public.normalize_product_text(p_manufacturer)
    || '|' || public.normalize_product_weight(p_unit_qty);
$$;

create index if not exists foods_product_identity_lookup_idx
  on public.foods (public.product_identity_key(name, manufacturer, unit_qty));

create or replace function app_private.enforce_food_identity()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  identity_key text;
begin
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.manufacturer is not distinct from old.manufacturer
     and new.unit_qty is not distinct from old.unit_qty then
    return new;
  end if;

  identity_key := public.product_identity_key(new.name, new.manufacturer, new.unit_qty);
  perform pg_advisory_xact_lock(hashtextextended(identity_key, 0));

  if exists (
    select 1 from public.foods f
     where public.product_identity_key(f.name, f.manufacturer, f.unit_qty) = identity_key
       and f.id is distinct from new.id
  ) then
    raise exception 'Product already exists' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists foods_identity_guard on public.foods;
create trigger foods_identity_guard
before insert or update of name, manufacturer, unit_qty on public.foods
for each row execute function app_private.enforce_food_identity();

create or replace function public.add_receipt_catalog_food(
  p_session_token text,
  p_external_id text,
  p_name text,
  p_manufacturer text,
  p_category text,
  p_unit_qty text,
  p_picture_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  ctx record;
  saved_food public.foods%rowtype;
  clean_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
  requested_identity text := public.product_identity_key(p_name, p_manufacturer, p_unit_qty);
begin
  select * into ctx from app_private.session_context(p_session_token);
  if ctx.member_role <> 'manager' and not ctx.is_admin then
    raise exception 'Only household managers can import receipt products' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0
     or char_length(btrim(coalesce(p_manufacturer, ''))) = 0
     or char_length(btrim(coalesce(p_category, ''))) = 0
     or char_length(btrim(coalesce(p_unit_qty, ''))) = 0 then
    raise exception 'Receipt product data is incomplete' using errcode = '22023';
  end if;

  select * into saved_food
    from public.foods
   where (clean_external_id is not null and external_id = clean_external_id)
      or public.product_identity_key(name, manufacturer, unit_qty) = requested_identity
   order by case when external_id = clean_external_id then 0 else 1 end
   limit 1;
  if found then
    return to_jsonb(saved_food);
  end if;

  insert into public.foods (
    source, external_id, name, manufacturer, unit_qty, picture_url,
    category, created_by, updated_at
  )
  values (
    'receipt',
    coalesce(clean_external_id, 'receipt_' || replace(gen_random_uuid()::text, '-', '')),
    btrim(p_name), btrim(p_manufacturer), btrim(p_unit_qty),
    coalesce(nullif(btrim(coalesce(p_picture_url, '')), ''), '/groceries-app/product-placeholder.svg'),
    btrim(p_category), ctx.user_id, now()
  )
  returning * into saved_food;
  return to_jsonb(saved_food);
end;
$$;

revoke all on function public.normalize_product_text(text) from public, anon, authenticated;
revoke all on function public.normalize_product_weight(text) from public, anon, authenticated;
revoke all on function public.product_identity_key(text, text, text) from public, anon, authenticated;

commit;
