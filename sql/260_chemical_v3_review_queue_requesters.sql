-- Reflects the LIVE corrected contract (already applied in production — do
-- not re-run against production). Returns who started the discovery behind
-- each current pending / needs-attention V3 revision, for the "Added by"
-- column in Chemical Catalogue Review. System Admin only. Read-only.
--
-- Provenance path (current schema):
--   chemical_v3_product_revisions.id
--     -> latest chemical_v3_discovery_jobs row where revision_id = revision.id
--     -> chemical_v3_job_requests where job_id = discovery_job.id
--   user     = chemical_v3_job_requests.user_id, fallback discovery_jobs.created_by
--   vineyard = chemical_v3_job_requests.vineyard_id (may be null; the current
--              start_chemical_v3_discovery() does not populate it)
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
  with pending as (
    select r.id
      from public.chemical_v3_admin_review_queue() q
      join public.chemical_v3_product_revisions r on r.id = q.revision_id
  ),
  latest_job as (
    select distinct on (j.revision_id) j.revision_id, j.id as job_id, j.created_by
      from public.chemical_v3_discovery_jobs j
      join pending p on p.id = j.revision_id
     order by j.revision_id, j.created_at desc
  ),
  req as (
    select distinct on (lj.revision_id)
           lj.revision_id,
           coalesce(jr.user_id, lj.created_by) as user_id,
           jr.vineyard_id
      from latest_job lj
      left join public.chemical_v3_job_requests jr on jr.job_id = lj.job_id
     order by lj.revision_id, (jr.user_id is null), jr.created_at asc nulls last
  )
  select p.id,
         rq.user_id,
         nullif(trim(pr.full_name), ''),
         coalesce(pr.email, u.email)::text,
         rq.vineyard_id,
         v.name
    from pending p
    left join req rq on rq.revision_id = p.id
    left join public.profiles pr on pr.id = rq.user_id
    left join auth.users u on u.id = rq.user_id
    left join public.vineyards v on v.id = rq.vineyard_id;
end;
$$;

revoke all on function public.chemical_v3_admin_review_queue_requesters() from public, anon;
grant execute on function public.chemical_v3_admin_review_queue_requesters() to authenticated;

notify pgrst, 'reload schema';
