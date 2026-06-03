-- Optional helper for projects that still have the old groceries-app `foods` table.
-- Run supabase/schema.sql first, then run this file to seed public.products
-- from existing public.foods rows.

do $$
begin
  if to_regclass('public.foods') is null then
    raise notice 'public.foods does not exist, skipping old food import.';
    return;
  end if;

  insert into public.products (
    external_id,
    name,
    price,
    image_url,
    brand,
    unit_qty,
    source,
    source_payload,
    last_updated
  )
  select
    coalesce(nullif(f.external_id::text, ''), f.id::text) as external_id,
    f.name,
    f.price,
    f.picture_url,
    f.manufacturer,
    f.unit_qty,
    'legacy-foods',
    to_jsonb(f),
    now()
  from public.foods f
  where f.name is not null
  on conflict (external_id) do update
    set name = excluded.name,
        price = excluded.price,
        image_url = excluded.image_url,
        brand = excluded.brand,
        unit_qty = excluded.unit_qty,
        source_payload = excluded.source_payload,
        last_updated = now();
end $$;
