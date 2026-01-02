-- Supabase schema for nippo-app (minimal document store)

create table if not exists public.nippo_docs (
  user_id uuid not null,
  doc_type text not null,
  doc_key text not null,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, doc_type, doc_key)
);

alter table public.nippo_docs enable row level security;

-- Allow each user to read/write their own docs
create policy "nippo_docs_select_own" on public.nippo_docs
for select
using (auth.uid() = user_id);

create policy "nippo_docs_insert_own" on public.nippo_docs
for insert
with check (auth.uid() = user_id);

create policy "nippo_docs_update_own" on public.nippo_docs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "nippo_docs_delete_own" on public.nippo_docs
for delete
using (auth.uid() = user_id);
