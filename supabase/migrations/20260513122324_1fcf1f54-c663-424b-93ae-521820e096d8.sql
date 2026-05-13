-- support_requests table
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  vineyard_id uuid,
  vineyard_name text,
  user_id uuid,
  user_email text,
  user_name text,
  user_role text,
  request_type text not null check (request_type in ('support','bug','feature','other')),
  subject text not null,
  message text not null,
  page_path text,
  browser_info text,
  attachment_paths text[] not null default '{}',
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.support_requests enable row level security;

-- Authenticated users can create requests (must be themselves)
create policy "auth users create support requests"
  on public.support_requests
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can read their own requests
create policy "users read own support requests"
  on public.support_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

create index idx_support_requests_user on public.support_requests (user_id, created_at desc);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger support_requests_updated_at
before update on public.support_requests
for each row execute function public.set_updated_at();

-- Storage bucket for attachments (private)
insert into storage.buckets (id, name, public)
values ('support-request-attachments', 'support-request-attachments', false)
on conflict (id) do nothing;

-- Storage policies: authenticated users can upload to their own user-id-prefixed folder
create policy "auth upload support attachments"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'support-request-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "auth read own support attachments"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'support-request-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
