-- Run this entire file once in Supabase > SQL Editor > New query.
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
