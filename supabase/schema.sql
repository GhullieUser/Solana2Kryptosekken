-- Supabase schema for user-owned address history
-- Enable pgcrypto for gen_random_uuid
-- create extension if not exists pgcrypto;

create table if not exists public.search_addresses (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	address text not null,
	label text,
	created_at timestamptz not null default now(),
	last_used_at timestamptz,
	unique (user_id, address)
);

alter table public.search_addresses enable row level security;

-- Users can only read their own rows
create policy "select_own_addresses" on public.search_addresses
for select
using (auth.uid() = user_id);

-- Users can only insert their own rows
create policy "insert_own_addresses" on public.search_addresses
for insert
with check (auth.uid() = user_id);

-- Users can only update their own rows
create policy "update_own_addresses" on public.search_addresses
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Users can only delete their own rows
create policy "delete_own_addresses" on public.search_addresses
for delete
using (auth.uid() = user_id);

-- Retention helper index
create index if not exists search_addresses_user_last_used_idx
on public.search_addresses (user_id, last_used_at desc);

-- Retention policy example: delete rows older than 90 days (adjust as needed)
-- Schedule via Supabase cron or external scheduler:
-- delete from public.search_addresses where last_used_at < now() - interval '90 days';
