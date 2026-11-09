-- À coller dans Supabase > SQL Editor > Run
create table if not exists public.dashboards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboards enable row level security;

create policy "lecture de ses données" on public.dashboards
  for select using (auth.uid() = user_id);

create policy "création de ses données" on public.dashboards
  for insert with check (auth.uid() = user_id);

create policy "modification de ses données" on public.dashboards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
