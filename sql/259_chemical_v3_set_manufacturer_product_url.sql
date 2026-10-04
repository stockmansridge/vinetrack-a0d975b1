-- Proposed for Rork to review and run on the shared VineTrack database.
-- Lets a System Admin correct the manufacturer product page link on a V3 revision.
create or replace function public.chemical_v3_set_manufacturer_product_url(
  p_revision_id uuid,
  p_url text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_url is null or p_url !~* '^https?://' then
    raise exception 'Product page link must start with http:// or https://' using errcode = '22023';
  end if;
  update public.chemical_v3_product_revisions
     set manufacturer_product_url = trim(p_url)
   where id = p_revision_id;
  if not found then
    raise exception 'Revision not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.chemical_v3_set_manufacturer_product_url(uuid, text, text) from public, anon;
grant execute on function public.chemical_v3_set_manufacturer_product_url(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
