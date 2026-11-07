-- =============================================================================
-- Tenant contact details and household members
--
-- Lets tenants keep their own phone and emergency contact current from the
-- portal, and list everyone 12 and older living in the unit. The list is a
-- management record only (it is not shown on maintenance jobs): it helps the
-- manager spot occupants who aren't on the lease and recall who lived where.
--
-- Removing someone keeps the row and stamps removed_at, so the manager keeps
-- a history of everyone who was ever listed. Tenants only see current rows.
--
-- Tenants have no UPDATE policy on public.tenants (they must not edit rent or
-- lease terms), so their edits go through server actions that only touch the
-- fields below. Household rows are readable by the tenant through RLS; writes
-- go through the same server actions, which also notify the manager.
-- =============================================================================

alter table public.tenants
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text;

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  -- The manager who owns the tenant record (same scope as tenants.user_id).
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  relationship text check (relationship is null or length(relationship) <= 60),
  -- Ages 12-17; adults leave this false.
  is_minor boolean not null default false,
  phone text check (phone is null or length(phone) <= 40),
  -- Who added the row: the tenant from the portal or the manager.
  added_by text not null default 'tenant' check (added_by in ('tenant', 'manager')),
  -- Set when the person is taken off the list; null while they are current.
  removed_at timestamp with time zone,
  removed_by text check (removed_by is null or removed_by in ('tenant', 'manager')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_household_members_tenant_id
  on public.household_members (tenant_id);
create index if not exists idx_household_members_user_id
  on public.household_members (user_id);

drop trigger if exists household_members_set_updated_at on public.household_members;
create trigger household_members_set_updated_at
  before update on public.household_members
  for each row execute function public.set_updated_at();

alter table public.household_members enable row level security;

drop policy if exists household_members_manager_all on public.household_members;
create policy household_members_manager_all on public.household_members
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists household_members_tenant_select on public.household_members;
create policy household_members_tenant_select on public.household_members
  for select to authenticated
  using (removed_at is null and public.is_tenant_of(tenant_id));
