-- 266 — Fertigation release: remove the System Admin development gate from 265.
-- PREPARED FOR RORK — apply on the shared database after 265.
-- Access becomes: any member of the vineyard. Existing spray_jobs policies
-- (role rules for creating/editing Program Steps) continue to apply unchanged.
-- NOTE: released mobile builds will now receive Fertigation Program Steps;
-- confirm iOS/Android handle operation_type = 'Fertigation' before applying.

begin;

create or replace function public.vt_fertigation_can_access(p_vineyard_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vineyard_members m
                 where m.vineyard_id = p_vineyard_id and m.user_id = auth.uid());
$$;

drop policy if exists spray_jobs_fertigation_dev_gate_select on public.spray_jobs;
drop policy if exists spray_jobs_fertigation_dev_gate_update on public.spray_jobs;
drop policy if exists spray_jobs_fertigation_dev_gate_insert on public.spray_jobs;

-- Fertigation stays a Program Step (template) only.
create policy spray_jobs_fertigation_template_only_insert on public.spray_jobs
  as restrictive for insert to authenticated
  with check (coalesce(lower(operation_type), '') <> 'fertigation' or is_template);
create policy spray_jobs_fertigation_template_only_update on public.spray_jobs
  as restrictive for update to authenticated
  using (true)
  with check (coalesce(lower(operation_type), '') <> 'fertigation' or is_template);

commit;
