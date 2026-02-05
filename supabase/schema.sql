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

-- Drop policies if they already exist (safe to re-run)
drop policy if exists "select_own_addresses" on public.search_addresses;
drop policy if exists "insert_own_addresses" on public.search_addresses;
drop policy if exists "update_own_addresses" on public.search_addresses;
drop policy if exists "delete_own_addresses" on public.search_addresses;

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

-- Generated CSVs (one per address per user)
create table if not exists public.generated_csvs (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	address text not null,
	label text,
	csv_text text not null,
	raw_count int,
	processed_count int,
	partial boolean not null default false,
	scan_session_id text,
	from_iso timestamptz,
	to_iso timestamptz,
	include_nft boolean,
	use_oslo boolean,
	dust_mode text,
	dust_threshold numeric,
	dust_interval text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.generated_csvs enable row level security;

-- Drop policies if they already exist (safe to re-run)
drop policy if exists "select_own_csvs" on public.generated_csvs;
drop policy if exists "insert_own_csvs" on public.generated_csvs;
drop policy if exists "update_own_csvs" on public.generated_csvs;
drop policy if exists "delete_own_csvs" on public.generated_csvs;

create policy "select_own_csvs" on public.generated_csvs
for select
using (auth.uid() = user_id);

create policy "insert_own_csvs" on public.generated_csvs
for insert
with check (auth.uid() = user_id);

create policy "update_own_csvs" on public.generated_csvs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "delete_own_csvs" on public.generated_csvs
for delete
using (auth.uid() = user_id);

-- Allow multiple CSVs per address/timeframe; update when same params are re-generated
create unique index if not exists generated_csvs_user_addr_params_unique
on public.generated_csvs (
	user_id,
	address,
	from_iso,
	to_iso,
	include_nft,
	use_oslo,
	dust_mode,
	dust_threshold,
	dust_interval
);

create index if not exists generated_csvs_user_updated_idx
on public.generated_csvs (user_id, updated_at desc);

alter table public.generated_csvs
add column if not exists partial boolean not null default false;

alter table public.generated_csvs
add column if not exists scan_session_id text;

-- ================= Billing: prepaid credits + usage =================
create table if not exists public.billing_user_usage (
	user_id uuid primary key references auth.users(id) on delete cascade,
	raw_tx_used int not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.billing_user_usage enable row level security;

drop policy if exists "select_own_billing_usage" on public.billing_user_usage;
drop policy if exists "insert_own_billing_usage" on public.billing_user_usage;
drop policy if exists "update_own_billing_usage" on public.billing_user_usage;

create policy "select_own_billing_usage" on public.billing_user_usage
for select
using (auth.uid() = user_id);

create policy "insert_own_billing_usage" on public.billing_user_usage
for insert
with check (auth.uid() = user_id);

create policy "update_own_billing_usage" on public.billing_user_usage
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.billing_user_credits (
	user_id uuid primary key references auth.users(id) on delete cascade,
	credits_remaining int not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.billing_user_credits enable row level security;

drop policy if exists "select_own_billing_credits" on public.billing_user_credits;
drop policy if exists "insert_own_billing_credits" on public.billing_user_credits;
drop policy if exists "update_own_billing_credits" on public.billing_user_credits;

create policy "select_own_billing_credits" on public.billing_user_credits
for select
using (auth.uid() = user_id);

create policy "insert_own_billing_credits" on public.billing_user_credits
for insert
with check (auth.uid() = user_id);

create policy "update_own_billing_credits" on public.billing_user_credits
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- One-time free credit grants by email hash (survives account deletion)
create table if not exists public.billing_email_grants (
	email_hash text primary key,
	user_id uuid,
	raw_used int not null default 0,
	credits_granted int not null default 50,
	granted_at timestamptz not null default now()
);

alter table public.billing_email_grants enable row level security;

-- No RLS policies needed; service role only

create index if not exists billing_email_grants_user_idx
on public.billing_email_grants (user_id);

alter table public.billing_email_grants
add column if not exists raw_used int not null default 0;

create table if not exists public.billing_usage_events (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	cache_key text not null,
	raw_count int not null,
	created_at timestamptz not null default now(),
	unique (user_id, cache_key)
);

alter table public.billing_usage_events enable row level security;

drop policy if exists "select_own_billing_events" on public.billing_usage_events;
drop policy if exists "insert_own_billing_events" on public.billing_usage_events;

create policy "select_own_billing_events" on public.billing_usage_events
for select
using (auth.uid() = user_id);

create policy "insert_own_billing_events" on public.billing_usage_events
for insert
with check (auth.uid() = user_id);

create table if not exists public.billing_webhook_events (
	id text primary key,
	event_type text,
	processed_at timestamptz not null default now()
);

alter table public.billing_webhook_events enable row level security;

-- Retention policy example: delete rows older than 90 days (adjust as needed)
-- Schedule via Supabase cron or external scheduler:
-- delete from public.search_addresses where last_used_at < now() - interval '90 days';
