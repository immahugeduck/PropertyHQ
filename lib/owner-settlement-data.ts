import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  computeSettlement,
  firstMonthInvoiceIds,
  type Settlement,
  type SettlementExpense,
  type SettlementPayout,
} from "@/lib/owner-settlement"

export interface OwnerSettlementData {
  owner: { id: string; first_name: string; last_name: string; leasing_fee_pct: number; management_fee_pct: number }
  settlement: Settlement
  /** Expenses in the window, for the itemized list. */
  expenses: (SettlementExpense & { id: string; property_name: string | null })[]
}

/**
 * Loads one owner's rent, expenses and payouts (through RLS, so only the
 * signed-in manager's data) and computes the suggested payout through `through`.
 * `from` limits the window for statements that cover a set period.
 */
export async function loadOwnerSettlement(
  supabase: SupabaseClient,
  userId: string,
  ownerId: string,
  through: string,
  from?: string,
): Promise<OwnerSettlementData | null> {
  const { data: owner } = await supabase
    .from("property_owners")
    .select("id, first_name, last_name, leasing_fee_pct, management_fee_pct")
    .eq("id", ownerId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!owner) return null

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name")
    .eq("user_id", userId)
    .eq("owner_id", ownerId)
  const propertyIds = (properties ?? []).map((p) => p.id)
  const propertyName = new Map((properties ?? []).map((p) => [p.id, p.name as string]))

  const [{ data: invoices }, { data: expenses }, { data: payouts }] = await Promise.all([
    propertyIds.length
      ? supabase
          .from("payment_balances")
          .select("id, tenant_id, property_id, due_date, paid_date, amount_paid")
          .eq("user_id", userId)
          .in("property_id", propertyIds)
      : Promise.resolve({ data: [] }),
    propertyIds.length
      ? supabase
          .from("expenses")
          .select("id, property_id, amount, date, paid_by, description, vendor")
          .eq("user_id", userId)
          .in("property_id", propertyIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("owner_payouts")
      .select("amount, leasing_fee, management_fee, payout_date, through_date, voided_at")
      .eq("user_id", userId)
      .eq("owner_id", ownerId),
  ])

  const tenantIds = [...new Set((invoices ?? []).map((i) => i.tenant_id).filter(Boolean))] as string[]
  const { data: tenants } = tenantIds.length
    ? await supabase.from("tenants").select("id, lease_start").in("id", tenantIds)
    : { data: [] }

  const fees = {
    leasing_fee_pct: Number(owner.leasing_fee_pct ?? 50),
    management_fee_pct: Number(owner.management_fee_pct ?? 10),
  }
  const settlement = computeSettlement({
    payments: (invoices ?? []).map((i) => ({ ...i, amount_paid: Number(i.amount_paid) })),
    firstMonthIds: firstMonthInvoiceIds(invoices ?? [], tenants ?? []),
    expenses: (expenses ?? []) as SettlementExpense[],
    payouts: (payouts ?? []) as SettlementPayout[],
    fees,
    through,
    from,
  })

  const inWindow = (d: string) =>
    (settlement.lastThrough === null || d > settlement.lastThrough) && d <= through && (!from || d >= from)

  return {
    owner: { ...owner, ...fees },
    settlement,
    expenses: (expenses ?? [])
      .filter((e) => inWindow(e.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ ...e, amount: Number(e.amount), property_name: propertyName.get(e.property_id) ?? null })),
  }
}
