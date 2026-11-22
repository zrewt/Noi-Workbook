-- =====================================================================
-- NOI Optimization Workbook — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profiles (one per signed-up user)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  title      text,
  is_admin   boolean not null default false,
  job_roles  text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists job_roles text[] not null default '{}';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, title, job_roles)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          coalesce(new.raw_user_meta_data ->> 'title', ''),
          coalesce(array(select jsonb_array_elements_text(
            case when jsonb_typeof(new.raw_user_meta_data -> 'job_roles') = 'array'
                 then new.raw_user_meta_data -> 'job_roles' else '[]'::jsonb end)), '{}'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Questionnaires (one per property / workbook)
-- ---------------------------------------------------------------------
create table if not exists public.questionnaires (
  id               uuid primary key default gen_random_uuid(),
  property_name    text not null,
  property_address text,
  status           text not null default 'in_progress'
                   check (status in ('in_progress', 'submitted', 'reviewed')),
  created_by       uuid references auth.users (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  submitted_at     timestamptz
);

-- People who can open a questionnaire. Membership is by email, so you can
-- invite someone before they have signed up.
create table if not exists public.questionnaire_members (
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  email            text not null check (email = lower(email)),
  role             text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  added_by         uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  primary key (questionnaire_id, email)
);

-- Answers: one row per questionnaire section, stored as JSON.
create table if not exists public.responses (
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  section_key      text not null,
  data             jsonb not null default '{}'::jsonb,
  updated_by       uuid default auth.uid(),
  updated_by_email text,
  updated_at       timestamptz not null default now(),
  primary key (questionnaire_id, section_key)
);

create index if not exists questionnaire_members_email_idx on public.questionnaire_members (email);

-- ---------------------------------------------------------------------
-- Access helpers (security definer avoids RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.member_role(q uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.questionnaire_members
  where questionnaire_id = q and email = lower(auth.jwt() ->> 'email')
$$;

create or replace function public.can_view(q uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.member_role(q) is not null
$$;

create or replace function public.can_edit(q uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.member_role(q) in ('owner', 'editor'), false)
$$;

create or replace function public.is_owner(q uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.member_role(q) = 'owner', false)
$$;

-- Storage paths look like "<questionnaire id>/<file>"
create or replace function public.path_qid(p text)
returns uuid language plpgsql immutable as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
-- Creator automatically becomes owner.
create or replace function public.add_creator_as_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.questionnaire_members (questionnaire_id, email, role, added_by)
  values (new.id, lower(auth.jwt() ->> 'email'), 'owner', auth.uid())
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists questionnaire_owner on public.questionnaires;
create trigger questionnaire_owner
  after insert on public.questionnaires
  for each row execute function public.add_creator_as_owner();

-- Stamp who saved a section and when; bump the questionnaire's updated_at.
create or replace function public.stamp_response()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_email := lower(auth.jwt() ->> 'email');
  update public.questionnaires set updated_at = now() where id = new.questionnaire_id;
  return new;
end $$;

drop trigger if exists responses_stamp on public.responses;
create trigger responses_stamp
  before insert or update on public.responses
  for each row execute function public.stamp_response();

create or replace function public.lower_member_email()
returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

drop trigger if exists members_lower on public.questionnaire_members;
create trigger members_lower
  before insert or update on public.questionnaire_members
  for each row execute function public.lower_member_email();

-- ---------------------------------------------------------------------
-- Which roles answer which questionnaire section.
-- People can only save answers in sections for their role(s);
-- workbook owners and admins can edit every section.
-- Keep in sync with the "roles" lists in questionnaire.js.
-- ---------------------------------------------------------------------
create table if not exists public.section_roles (
  section_key text not null,
  role        text not null,
  primary key (section_key, role)
);
delete from public.section_roles;
insert into public.section_roles (section_key, role) values
  ('site', 'pm'),
  ('site', 'apm'),
  ('site', 'gm'),
  ('director', 'director'),
  ('leasing', 'director'),
  ('leasing', 'leasing'),
  ('accounting', 'accounting'),
  ('gm_swot', 'gm'),
  ('gm_swot', 'pm'),
  ('gm_swot', 'apm'),
  ('gm_swot', 'ops_tech'),
  ('gm_opex', 'gm'),
  ('gm_opex', 'pm'),
  ('gm_opex', 'apm'),
  ('gm_tax', 'gm'),
  ('gm_tax', 'pm'),
  ('gm_tax', 'apm'),
  ('gm_revenue', 'gm'),
  ('gm_revenue', 'pm'),
  ('gm_revenue', 'apm'),
  ('gm_priority', 'gm'),
  ('gm_priority', 'pm'),
  ('gm_risk', 'gm'),
  ('gm_risk', 'pm'),
  ('gm_risk', 'ops_tech'),
  ('gm_risk', 'ops_security'),
  ('gm_data', 'gm'),
  ('gm_data', 'pm'),
  ('gm_data', 'apm'),
  ('tenant', 'gm'),
  ('tenant', 'pm'),
  ('tenant', 'apm'),
  ('summary', 'pm'),
  ('summary', 'gm'),
  ('leaseadmin', 'lease_admin'),
  ('sustainability', 'sustainability'),
  ('proptech', 'proptech'),
  ('appendix_b', 'gm'),
  ('appendix_b', 'pm'),
  ('appendix_b', 'apm'),
  ('appendix_b', 'ops_tech'),
  ('appendix_b', 'ops_security'),
  ('appendix_c', 'gm'),
  ('appendix_c', 'pm'),
  ('appendix_c', 'apm');

create or replace function public.can_edit_section(q uuid, s text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner(q)
      or (public.can_edit(q) and (
            not exists (select 1 from public.section_roles where section_key = s)
            or exists (select 1 from public.section_roles sr
                       join public.profiles p on p.id = auth.uid()
                       where sr.section_key = s and sr.role = any (p.job_roles))))
$$;

-- Names and roles of the people on a workbook (for the Team page).
create or replace function public.team_profiles(q uuid)
returns table (email text, full_name text, title text, job_roles text[], signed_up boolean)
language sql stable security definer set search_path = public as $$
  select m.email, p.full_name, p.title, coalesce(p.job_roles, '{}'), p.id is not null
  from public.questionnaire_members m
  left join public.profiles p on p.email = m.email
  where m.questionnaire_id = q and public.can_view(q)
$$;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.questionnaires        enable row level security;
alter table public.questionnaire_members enable row level security;
alter table public.responses             enable row level security;
alter table public.section_roles         enable row level security;

drop policy if exists "section roles: read" on public.section_roles;
create policy "section roles: read" on public.section_roles
  for select to authenticated using (true);

-- profiles
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- users may change their name/title but never their own is_admin flag
revoke update on public.profiles from authenticated, anon;
grant update (full_name, title, job_roles) on public.profiles to authenticated;

-- questionnaires
drop policy if exists "q: view" on public.questionnaires;
create policy "q: view" on public.questionnaires
  for select to authenticated using (public.can_view(id));

drop policy if exists "q: create" on public.questionnaires;
create policy "q: create" on public.questionnaires
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "q: edit" on public.questionnaires;
create policy "q: edit" on public.questionnaires
  for update to authenticated using (public.can_edit(id)) with check (public.can_edit(id));

drop policy if exists "q: delete" on public.questionnaires;
create policy "q: delete" on public.questionnaires
  for delete to authenticated using (public.is_owner(id));

-- members
drop policy if exists "m: view" on public.questionnaire_members;
create policy "m: view" on public.questionnaire_members
  for select to authenticated using (public.can_view(questionnaire_id));

drop policy if exists "m: owner adds" on public.questionnaire_members;
create policy "m: owner adds" on public.questionnaire_members
  for insert to authenticated with check (public.is_owner(questionnaire_id));

drop policy if exists "m: owner changes" on public.questionnaire_members;
create policy "m: owner changes" on public.questionnaire_members
  for update to authenticated using (public.is_owner(questionnaire_id)) with check (public.is_owner(questionnaire_id));

drop policy if exists "m: owner removes" on public.questionnaire_members;
create policy "m: owner removes" on public.questionnaire_members
  for delete to authenticated using (public.is_owner(questionnaire_id));

-- responses
drop policy if exists "r: view" on public.responses;
create policy "r: view" on public.responses
  for select to authenticated using (public.can_view(questionnaire_id));

drop policy if exists "r: insert" on public.responses;
create policy "r: insert" on public.responses
  for insert to authenticated with check (public.can_edit_section(questionnaire_id, section_key));

drop policy if exists "r: update" on public.responses;
create policy "r: update" on public.responses
  for update to authenticated
  using (public.can_edit_section(questionnaire_id, section_key))
  with check (public.can_edit_section(questionnaire_id, section_key));

-- ---------------------------------------------------------------------
-- Storage for site photos (private bucket)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "photos: view" on storage.objects;
create policy "photos: view" on storage.objects
  for select to authenticated
  using (bucket_id = 'site-photos' and public.can_view(public.path_qid(name)));

drop policy if exists "photos: upload" on storage.objects;
create policy "photos: upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-photos' and public.can_edit(public.path_qid(name)));

drop policy if exists "photos: delete" on storage.objects;
create policy "photos: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-photos' and public.can_edit(public.path_qid(name)));

-- ---------------------------------------------------------------------
-- Make yourself an admin (sees and manages every questionnaire).
-- Sign up in the app first, then run this with your email:
--
--   update public.profiles set is_admin = true where email = 'you@example.com';
-- ---------------------------------------------------------------------
