-- Bewlet registration and lifetime-license foundation.
-- Run in the Supabase SQL editor after creating a project.

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  pricing_region text not null default 'INTL' check (pricing_region in ('ID', 'INTL')),
  license_type text check (license_type in ('founder_lifetime', 'lifetime')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  rejection_reason text,
  google_sheet_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_status_created_idx on public.profiles (status, created_at desc);
create index if not exists profiles_region_license_idx on public.profiles (pricing_region, license_type);

create table if not exists public.payment_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('IDR', 'USD')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  rejection_reason text
);

create index if not exists payment_submissions_user_idx on public.payment_submissions (user_id, submitted_at desc);
create index if not exists payment_submissions_pending_idx on public.payment_submissions (submitted_at) where status = 'pending';

create table if not exists public.founder_slots (
  region text primary key check (region in ('ID', 'INTL')),
  capacity integer not null default 100 check (capacity > 0),
  claimed integer not null default 0 check (claimed >= 0 and claimed <= capacity),
  updated_at timestamptz not null default now()
);

insert into public.founder_slots (region, capacity, claimed)
values ('ID', 100, 0), ('INTL', 100, 0)
on conflict (region) do nothing;

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.founder_slots enable row level security;
alter table private.admin_users enable row level security;

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles
for select to authenticated
using ((select auth.uid()) = id or (select private.is_admin()));

drop policy if exists "users choose own pricing region" on public.profiles;
create policy "users choose own pricing region" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "users read own payment submissions" on public.payment_submissions;
create policy "users read own payment submissions" on public.payment_submissions
for select to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));

drop policy if exists "users create own payment submissions" on public.payment_submissions;
create policy "users create own payment submissions" on public.payment_submissions
for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'pending');

drop policy if exists "founder counts are publicly readable" on public.founder_slots;
create policy "founder counts are publicly readable" on public.founder_slots
for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.founder_slots to anon, authenticated;
grant select on public.profiles, public.payment_submissions to authenticated;
revoke update on public.profiles from authenticated;
grant update (pricing_region) on public.profiles to authenticated;
grant insert on public.payment_submissions to authenticated;
grant usage, select on sequence public.payment_submissions_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs', 'payment-proofs', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload own payment proof" on storage.objects;
create policy "users upload own payment proof" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "users read own payment proof" on storage.objects;
create policy "users read own payment proof" on storage.objects
for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "users delete own pending payment proof" on storage.objects;
create policy "users delete own pending payment proof" on storage.objects
for delete to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- After your first Google login, bootstrap the owner once in the SQL editor:
-- insert into private.admin_users (user_id)
-- select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
