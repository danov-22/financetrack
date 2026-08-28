-- Run this once in Supabase SQL Editor before deploying the onboarding release.
-- Existing approved accounts are marked complete so only future approved users
-- receive the tour automatically. Everyone can replay it from Settings.

begin;

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

update public.profiles
set onboarding_completed_at = now()
where status = 'approved'
  and onboarding_completed_at is null;

commit;
