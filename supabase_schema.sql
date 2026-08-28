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
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_status_created_idx on public.profiles (status, created_at desc);
alter table public.profiles add column if not exists registration_notified_at timestamptz;
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
create index if not exists profiles_region_license_idx on public.profiles (pricing_region, license_type);

create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value)
values ('support_whatsapp', '089504556187')
on conflict (key) do nothing;

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
-- update public.profiles set status = 'approved', license_type = 'lifetime', approved_at = now()
-- where email = 'YOUR_ADMIN_EMAIL';

-- Account synchronization and data-safety phase.
-- OAuth refresh tokens are encrypted by the Vercel API before they enter this table.
create table if not exists public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  google_email text,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  drive_file_id text not null,
  spreadsheet_revision text,
  byte_size bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists data_backups_user_created_idx on public.data_backups (user_id, created_at desc);

alter table public.google_connections enable row level security;
alter table public.data_backups enable row level security;
revoke all on public.google_connections from anon, authenticated;
revoke all on public.data_backups from anon, authenticated;

drop policy if exists "users read own backup metadata" on public.data_backups;
create policy "users read own backup metadata" on public.data_backups
for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.data_backups to authenticated;

create or replace function public.review_bewlet_account(target_user uuid, decision text, reason text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewed public.profiles;
  account_region text;
  current_license text;
  slot_capacity integer;
  slot_claimed integer;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  if decision not in ('approved', 'rejected', 'suspended') then raise exception 'Invalid decision'; end if;
  select pricing_region, license_type into account_region, current_license from public.profiles where id = target_user for update;
  if decision = 'approved' and current_license is null then
    select capacity, claimed into slot_capacity, slot_claimed from public.founder_slots where region = account_region for update;
    if slot_claimed < slot_capacity then
      update public.founder_slots set claimed = claimed + 1, updated_at = now() where region = account_region;
      current_license := 'founder_lifetime';
    else
      current_license := 'lifetime';
    end if;
  end if;
  update public.profiles set
    status = decision,
    approved_at = case when decision = 'approved' then now() else approved_at end,
    approved_by = case when decision = 'approved' then auth.uid() else approved_by end,
    rejection_reason = case when decision = 'approved' then null else reason end,
    license_type = case when decision = 'approved' then current_license else license_type end,
    updated_at = now()
  where id = target_user returning * into reviewed;
  if reviewed.id is null then raise exception 'Account not found'; end if;
  return reviewed;
end;
$$;
revoke all on function public.review_bewlet_account(uuid, text, text) from public;
grant execute on function public.review_bewlet_account(uuid, text, text) to authenticated;

create or replace function public.is_bewlet_admin()
returns boolean language sql stable security definer set search_path = '' as $$ select private.is_admin(); $$;
revoke all on function public.is_bewlet_admin() from public;
grant execute on function public.is_bewlet_admin() to authenticated;

-- Beta feedback workflow and persistent in-app notifications.
create table if not exists public.feedback_tickets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  type text not null,
  message text not null,
  page text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'withdrawn')),
  attachment_url text,
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_tickets_status_created_idx on public.feedback_tickets(status, created_at desc);
create index if not exists feedback_tickets_user_created_idx on public.feedback_tickets(user_id, created_at desc);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null default 'update' check (kind in ('feedback', 'update', 'maintenance')),
  title text not null,
  message text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_target_created_idx on public.user_notifications(user_id, created_at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.user_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.feedback_tickets enable row level security;
alter table public.user_notifications enable row level security;
alter table public.notification_reads enable row level security;
revoke all on public.feedback_tickets, public.user_notifications, public.notification_reads from anon, authenticated;
