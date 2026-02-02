-- Enable pg_cron extension (Supabase: Database -> Extensions)
-- create extension if not exists pg_cron;

-- Optional: configuration table for retention (days)
create table if not exists public.retention_policy (
	id int primary key default 1,
	address_history_days int not null default 90,
	updated_at timestamptz not null default now()
);

insert into public.retention_policy (id)
values (1)
on conflict (id) do nothing;

-- Function to apply retention
create or replace function public.apply_address_retention()
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE
	days_to_keep int;
BEGIN
	select address_history_days into days_to_keep from public.retention_policy where id = 1;
	delete from public.search_addresses
	where last_used_at < now() - make_interval(days => days_to_keep);
END;
$$;

-- Schedule daily at 03:00 UTC
-- select cron.schedule('address_retention_daily', '0 3 * * *', $$select public.apply_address_retention();$$);
