-- =============================================================================
-- Owner settlements: management fees, who paid each expense, payout breakdowns
--
-- Nothing here moves money or posts entries on its own. The app *suggests* a
-- payout (rent collected - fees - expenses the manager paid, plus whatever is
-- carried over), and the manager edits and records what was actually paid.
--
--   property_owners.leasing_fee_pct     % of a new tenant's first month's rent
--   property_owners.management_fee_pct  % of rent collected every other month
--   expenses.paid_by                    'manager' = paid by the manager and
--                                       deducted from the owner's payout;
--                                       'owner' = the owner paid the vendor
--                                       directly (shown for their records only)
--   owner_payouts.*                     the breakdown actually used, the date
--                                       the payout covers activity through,
--                                       and a void marker (payouts are never
--                                       edited or deleted, so history stays
--                                       accurate; a mistake is voided and
--                                       re-recorded)
-- =============================================================================

alter table public.property_owners
  add column if not exists leasing_fee_pct numeric(5,2) not null default 50
    check (leasing_fee_pct between 0 and 100),
  add column if not exists management_fee_pct numeric(5,2) not null default 10
    check (management_fee_pct between 0 and 100);

alter table public.expenses
  add column if not exists paid_by text not null default 'manager'
    check (paid_by in ('manager', 'owner'));

alter table public.owner_payouts
  -- Rent collected and expenses deducted since the previous payout, as shown
  -- when this one was recorded (kept for the statement).
  add column if not exists rent_collected numeric(12,2),
  add column if not exists expenses_deducted numeric(12,2),
  -- Fees actually taken with this payout (may differ from the suggestion).
  add column if not exists leasing_fee numeric(12,2) not null default 0 check (leasing_fee >= 0),
  add column if not exists management_fee numeric(12,2) not null default 0 check (management_fee >= 0),
  -- Manual +/- correction, with the reason in notes.
  add column if not exists adjustment numeric(12,2) not null default 0,
  -- Activity (rent, expenses) dated on or before this day is settled.
  add column if not exists through_date date,
  add column if not exists voided_at timestamp with time zone,
  add column if not exists void_reason text;

-- Recorded payouts are history: money fields can't be changed afterwards, and
-- the only allowed update is voiding (once). Deleting is no longer allowed.
create or replace function public.owner_payouts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'This payout was voided and can no longer be changed';
  end if;
  if (new.owner_id, new.amount, new.payout_date, new.payment_method, new.reference_number,
      new.rent_collected, new.expenses_deducted, new.leasing_fee, new.management_fee,
      new.adjustment, new.through_date, new.user_id)
     is distinct from
     (old.owner_id, old.amount, old.payout_date, old.payment_method, old.reference_number,
      old.rent_collected, old.expenses_deducted, old.leasing_fee, old.management_fee,
      old.adjustment, old.through_date, old.user_id) then
    raise exception 'Recorded payouts cannot be edited. Void it and record a corrected payout.';
  end if;
  if new.voided_at is not null and coalesce(btrim(new.void_reason), '') = '' then
    raise exception 'Give a reason for voiding this payout';
  end if;
  return new;
end;
$$;

drop trigger if exists owner_payouts_guard on public.owner_payouts;
create trigger owner_payouts_guard
  before update on public.owner_payouts
  for each row execute function public.owner_payouts_guard();

drop policy if exists "owner_payouts_delete_own" on public.owner_payouts;
revoke delete on public.owner_payouts from authenticated;
