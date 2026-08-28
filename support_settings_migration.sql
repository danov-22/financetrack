-- Run once in Supabase SQL Editor to enable admin-managed support details.
create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

insert into public.app_settings (key, value)
values ('support_whatsapp', '089504556187')
on conflict (key) do nothing;
