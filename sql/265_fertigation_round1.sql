-- 265 — Fertigation Round 1 (Portal only, System Admin development gate).
-- PREPARED FOR RORK — NOT APPLIED. Review against the live schema first.
--
-- Spray Program → Fertigation Program Step (spray_jobs, is_template,
-- operation_type = 'Fertigation') → irrigation_sessions → fertigation_applications.
-- record_irrigation_session is NOT changed; fertigation is written afterwards.
--
-- Assumptions to confirm:
--  * public.is_system_admin() returns the caller's active System Admin status.
--  * public.has_vineyard_access(uuid) (or equivalent member check) exists —
--    replace vt_fertigation_can_access below with the canonical helper.
--  * spray_jobs.operation_type has no CHECK constraint that rejects
--    'Fertigation', and application_mode accepts NULL. If either is false,
--    extend those constraints in this migration.
--  * irrigation_sessions.status becomes 'reversed' via reverse_irrigation_session.

begin;

create or replace function public.vt_fertigation_can_access(p_vineyard_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_system_admin(), false)
     and exists (select 1 from public.vineyard_members m
                 where m.vineyard_id = p_vineyard_id and m.user_id = auth.uid());
$$;
revoke all on function public.vt_fertigation_can_access(uuid) from public, anon;
grant execute on function public.vt_fertigation_can_access(uuid) to authenticated;

-- Compatibility: released mobile builds must never receive Fertigation steps.
-- RESTRICTIVE policies combine with every existing spray_jobs policy.
create policy spray_jobs_fertigation_dev_gate_select on public.spray_jobs
  as restrictive for select to authenticated
  using (coalesce(lower(operation_type), '') <> 'fertigation' or coalesce(public.is_system_admin(), false));
create policy spray_jobs_fertigation_dev_gate_insert on public.spray_jobs
  as restrictive for insert to authenticated
  with check (coalesce(lower(operation_type), '') <> 'fertigation'
              or (coalesce(public.is_system_admin(), false) and is_template));
create policy spray_jobs_fertigation_dev_gate_update on public.spray_jobs
  as restrictive for update to authenticated
  using (coalesce(lower(operation_type), '') <> 'fertigation' or coalesce(public.is_system_admin(), false))
  with check (coalesce(lower(operation_type), '') <> 'fertigation'
              or (coalesce(public.is_system_admin(), false) and is_template));

create table public.fertigation_applications (
  id uuid primary key,
  vineyard_id uuid not null references public.vineyards(id) on delete cascade,
  irrigation_session_id uuid not null references public.irrigation_sessions(id),
  program_step_id uuid references public.spray_jobs(id),
  program_step_name text,
  growth_stage_code text,
  notes text,
  status text not null default 'active' check (status in ('active','reversed')),
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index fertigation_one_active_per_session
  on public.fertigation_applications (irrigation_session_id) where status = 'active';

create table public.fertigation_application_products (
  id uuid primary key,
  fertigation_application_id uuid not null references public.fertigation_applications(id) on delete cascade,
  vineyard_id uuid not null references public.vineyards(id) on delete cascade,
  saved_chemical_id uuid references public.saved_chemicals(id),
  product_name text not null,
  product_category text,
  product_form text,
  planned_rate numeric,
  rate_basis text check (rate_basis in ('per_hectare','per_vine','per_irrigation_cycle')),
  rate_unit text,
  planned_quantity numeric,
  actual_quantity numeric check (actual_quantity is null or actual_quantity >= 0),
  quantity_unit text,
  cost_per_unit numeric,
  product_snapshot jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.fertigation_applications, public.fertigation_application_products to authenticated;
grant all on public.fertigation_applications, public.fertigation_application_products to service_role;
alter table public.fertigation_applications enable row level security;
alter table public.fertigation_application_products enable row level security;
-- Reads: System Admin + vineyard access only. Writes: RPCs only (no write policies).
create policy fertigation_apps_select on public.fertigation_applications
  for select to authenticated using (public.vt_fertigation_can_access(vineyard_id));
create policy fertigation_products_select on public.fertigation_application_products
  for select to authenticated using (public.vt_fertigation_can_access(vineyard_id));

create or replace function public.vt_fertigation_json(p_app public.fertigation_applications)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p_app)
    || jsonb_build_object(
      'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
                            from public.fertigation_application_products p
                            where p.fertigation_application_id = p_app.id), '[]'::jsonb),
      'session_date', s.session_date, 'duration_minutes', s.duration_minutes,
      'total_volume_litres', s.total_volume_litres,
      'system_name', sys.name, 'valve_name', v.name)
  from public.irrigation_sessions s
  left join public.irrigation_systems sys on sys.id = s.irrigation_system_id
  left join public.irrigation_valves v on v.id = s.valve_id
  where s.id = p_app.irrigation_session_id;
$$;

create or replace function public.get_fertigation_capabilities(p_vineyard_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('can_use_fertigation', public.vt_fertigation_can_access(p_vineyard_id));
$$;

create or replace function public.list_fertigation_program_steps(p_vineyard_id uuid)
returns setof public.spray_jobs language plpgsql stable security definer set search_path = public as $$
begin
  if not public.vt_fertigation_can_access(p_vineyard_id) then raise exception 'not_authorised'; end if;
  return query select * from public.spray_jobs j
   where j.vineyard_id = p_vineyard_id and j.is_template and j.deleted_at is null
     and lower(j.operation_type) = 'fertigation'
   order by j.growth_stage_code nulls last, j.name;
end $$;

create or replace function public.get_irrigation_session_fertigation(p_vineyard_id uuid, p_irrigation_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.fertigation_applications;
begin
  if not public.vt_fertigation_can_access(p_vineyard_id) then raise exception 'not_authorised'; end if;
  select * into a from public.fertigation_applications
   where vineyard_id = p_vineyard_id and irrigation_session_id = p_irrigation_session_id and status = 'active';
  if not found then return null; end if;
  return public.vt_fertigation_json(a);
end $$;

create or replace function public.list_fertigation_applications(
  p_vineyard_id uuid, p_vintage_year int default null, p_program_step_id uuid default null,
  p_include_reversed boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.vt_fertigation_can_access(p_vineyard_id) then raise exception 'not_authorised'; end if;
  return coalesce((select jsonb_agg(public.vt_fertigation_json(a) order by s.session_date desc)
    from public.fertigation_applications a
    join public.irrigation_sessions s on s.id = a.irrigation_session_id
    where a.vineyard_id = p_vineyard_id
      and (p_include_reversed or a.status = 'active')
      and (p_program_step_id is null or a.program_step_id = p_program_step_id)
      and (p_vintage_year is null or s.vintage_year = p_vintage_year)), '[]'::jsonb);
end $$;

create or replace function public.upsert_fertigation_application(
  p_id uuid, p_vineyard_id uuid, p_irrigation_session_id uuid, p_program_step_id uuid,
  p_program_step_name text, p_growth_stage_code text, p_notes text, p_products jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.fertigation_applications; p jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.vt_fertigation_can_access(p_vineyard_id) then raise exception 'not_authorised'; end if;
  if not exists (select 1 from public.irrigation_sessions where id = p_irrigation_session_id
                 and vineyard_id = p_vineyard_id and status <> 'reversed') then
    raise exception 'irrigation_session_not_in_vineyard'; end if;
  if not exists (select 1 from public.spray_jobs where id = p_program_step_id and vineyard_id = p_vineyard_id
                 and is_template and lower(operation_type) = 'fertigation' and deleted_at is null) then
    raise exception 'program_step_not_fertigation'; end if;
  if exists (select 1 from public.fertigation_applications where id = p_id
             and (vineyard_id <> p_vineyard_id or irrigation_session_id <> p_irrigation_session_id)) then
    raise exception 'application_id_conflict'; end if;

  insert into public.fertigation_applications as f
    (id, vineyard_id, irrigation_session_id, program_step_id, program_step_name, growth_stage_code, notes, updated_by)
  values (p_id, p_vineyard_id, p_irrigation_session_id, p_program_step_id, p_program_step_name,
          p_growth_stage_code, p_notes, auth.uid())
  on conflict (id) do update set program_step_id = excluded.program_step_id,
    program_step_name = excluded.program_step_name, growth_stage_code = excluded.growth_stage_code,
    notes = excluded.notes, updated_by = auth.uid(), updated_at = now()
  where f.status = 'active'
  returning * into a;
  if a.id is null then raise exception 'application_reversed'; end if;

  delete from public.fertigation_application_products
   where fertigation_application_id = p_id
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(p_products) x);
  for p in select * from jsonb_array_elements(p_products) loop
    if (p->>'saved_chemical_id') is not null and not exists (
      select 1 from public.saved_chemicals where id = (p->>'saved_chemical_id')::uuid and vineyard_id = p_vineyard_id) then
      raise exception 'product_not_in_vineyard'; end if;
    insert into public.fertigation_application_products as fp (id, fertigation_application_id, vineyard_id,
      saved_chemical_id, product_name, product_category, product_form, planned_rate, rate_basis, rate_unit,
      planned_quantity, actual_quantity, quantity_unit, cost_per_unit, product_snapshot, sort_order)
    values ((p->>'id')::uuid, p_id, p_vineyard_id, (p->>'saved_chemical_id')::uuid, p->>'product_name',
      p->>'product_category', p->>'product_form', (p->>'planned_rate')::numeric, p->>'rate_basis', p->>'rate_unit',
      (p->>'planned_quantity')::numeric, (p->>'actual_quantity')::numeric, p->>'quantity_unit',
      (p->>'cost_per_unit')::numeric, p->'product_snapshot', coalesce((p->>'sort_order')::int, 0))
    on conflict (id) do update set actual_quantity = excluded.actual_quantity,
      planned_quantity = excluded.planned_quantity, sort_order = excluded.sort_order, updated_at = now()
    where fp.fertigation_application_id = p_id;
  end loop;
  return public.vt_fertigation_json(a);
end $$;

create or replace function public.reverse_fertigation_application(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.fertigation_applications;
begin
  select * into a from public.fertigation_applications where id = p_id;
  if not found or not public.vt_fertigation_can_access(a.vineyard_id) then raise exception 'not_authorised'; end if;
  update public.fertigation_applications set status = 'reversed', reversed_at = now(),
    reversed_by = auth.uid(), reversal_reason = p_reason, updated_at = now()
   where id = p_id and status = 'active' returning * into a;
  return public.vt_fertigation_json(coalesce(a, (select f from public.fertigation_applications f where f.id = p_id)));
end $$;

-- Irrigation reversal reverses the linked application (never hard-deletes it,
-- never changes its quantities).
create or replace function public.vt_fertigation_on_session_reversed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'reversed' and old.status is distinct from 'reversed' then
    update public.fertigation_applications set status = 'reversed', reversed_at = now(),
      reversed_by = auth.uid(), reversal_reason = 'irrigation_session_reversed', updated_at = now()
     where irrigation_session_id = new.id and status = 'active';
  end if;
  return new;
end $$;
create trigger irrigation_session_reverses_fertigation
  after update of status on public.irrigation_sessions
  for each row execute function public.vt_fertigation_on_session_reversed();

revoke all on function public.get_fertigation_capabilities(uuid), public.list_fertigation_program_steps(uuid),
  public.get_irrigation_session_fertigation(uuid, uuid), public.list_fertigation_applications(uuid, int, uuid, boolean),
  public.upsert_fertigation_application(uuid, uuid, uuid, uuid, text, text, text, jsonb),
  public.reverse_fertigation_application(uuid, text), public.vt_fertigation_json(public.fertigation_applications)
  from public, anon;
grant execute on function public.get_fertigation_capabilities(uuid), public.list_fertigation_program_steps(uuid),
  public.get_irrigation_session_fertigation(uuid, uuid), public.list_fertigation_applications(uuid, int, uuid, boolean),
  public.upsert_fertigation_application(uuid, uuid, uuid, uuid, text, text, text, jsonb),
  public.reverse_fertigation_application(uuid, text) to authenticated;

commit;
