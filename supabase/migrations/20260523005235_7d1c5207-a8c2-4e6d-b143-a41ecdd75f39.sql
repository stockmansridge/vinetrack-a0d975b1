create table if not exists public.user_table_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vineyard_id uuid null,
  table_id text not null,
  column_order jsonb not null default '[]'::jsonb,
  hidden_columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_table_preferences_unique_with_vineyard
  on public.user_table_preferences (user_id, vineyard_id, table_id)
  where vineyard_id is not null;

create unique index if not exists user_table_preferences_unique_no_vineyard
  on public.user_table_preferences (user_id, table_id)
  where vineyard_id is null;

alter table public.user_table_preferences enable row level security;

create policy "Users view own table prefs" on public.user_table_preferences
  for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own table prefs" on public.user_table_preferences
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own table prefs" on public.user_table_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own table prefs" on public.user_table_preferences
  for delete to authenticated using (auth.uid() = user_id);

create trigger user_table_preferences_set_updated_at
  before update on public.user_table_preferences
  for each row execute function public.set_updated_at();