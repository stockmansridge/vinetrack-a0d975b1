-- Proposed for Rork to review and run on the shared VineTrack database.
-- Returns who started the discovery behind each pending V3 revision, and from
-- which vineyard, for the "Added by" column in Chemical Catalogue Review.
-- System Admin only. Read-only. Does not change chemical_v3_admin_review_queue.
--
-- ASSUMPTIONS (Rork to confirm/correct before running):
--   chemical_v3_product_revisions.job_id      -> chemical_v3_discovery_jobs.id
--   chemical_v3_discovery_jobs.requested_by   (uuid of the user who searched)
--   chemical_v3_discovery_jobs.vineyard_id    (vineyard the search came from)
--   public.profiles(id, full_name, email), public.vineyards(id, name)
create or replace function public.chemical_v3_admin_review_queue_requesters()
returns table (
  revision_id uuid,
  requested_by uuid,
  requested_by_name text,
  requested_by_email text,
  vineyard_id uuid,
  vineyard_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
  select r.id,
         j.requested_by,
         nullif(trim(p.full_name), ''),
         coalesce(p.email, u.email)::text,
         j.vineyard_id,
         v.name
    from public.chemical_v3_product_revisions r
    join public.chemical_v3_discovery_jobs j on j.id = r.job_id
    left join public.profiles p on p.id = j.requested_by
    left join auth.users u on u.id = j.requested_by
    left join public.vineyards v on v.id = j.vineyard_id;
end;
$$;

revoke all on function public.chemical_v3_admin_review_queue_requesters() from public, anon;
grant execute on function public.chemical_v3_admin_review_queue_requesters() to authenticated;

notify pgrst, 'reload schema';
