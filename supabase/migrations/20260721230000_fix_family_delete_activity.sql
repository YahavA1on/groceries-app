begin;

drop trigger if exists capture_site_activity on public.families;
drop trigger if exists capture_site_activity_insert_update on public.families;
drop trigger if exists capture_site_activity_delete on public.families;

create trigger capture_site_activity_insert_update
after insert or update on public.families
for each row execute function app_private.capture_site_activity();

create trigger capture_site_activity_delete
before delete on public.families
for each row execute function app_private.capture_site_activity();

commit;
