/**
 * Owner settlement math: what the manager should pay an owner, as a
 * *suggestion*. Nothing here writes data; the manager reviews the numbers,
 * changes any of them, and records what was actually paid.
 *
 * The owner's money held by the manager is
 *
 *   rent collected - expenses the manager paid - fees taken - payouts made
 *
 * Fees are only "taken" when a payout records them, so the suggestion for the
 * next payout adds fees on the rent collected since the last payout:
 *
 *   carried over (balance as of the last payout's through-date)
 *   + rent collected since then
 *   - expenses the manager paid since then
 *   - leasing fee (first month of a new tenant) and management fee
 *   = suggested payout
 *
 * Expenses the owner paid directly are listed for the owner's records but
 * never deducted.
 */

export interface SettlementPayment {
  id: string
  tenant_id: string | null
  property_id: string | null
  due_date: string
  /** Day the rent was received (yyyy-mm-dd). Uncollected rows are ignored. */
  paid_date: string | null
  amount_paid: number
}

export interface SettlementTenant {
  id: string
  lease_start: string | null
}

export interface SettlementExpense {
  property_id: string | null
  amount: number
  date: string
  paid_by: "manager" | "owner"
  description?: string | null
  vendor?: string | null
}

export interface SettlementPayout {
  amount: number
  leasing_fee: number
  management_fee: number
  payout_date: string
  through_date: string | null
  voided_at: string | null
}

export interface FeeSettings {
  leasing_fee_pct: number
  management_fee_pct: number
}

export interface Settlement {
  /** Activity after this day is unsettled; null when nothing was paid yet. */
  lastThrough: string | null
  through: string
  carriedOver: number
  rentCollected: number
  /** Part of rentCollected that is a new tenant's first month. */
  firstMonthRent: number
  leasingFee: number
  managementFee: number
  managerPaidExpenses: number
  ownerPaidExpenses: number
  suggestedPayout: number
}

export const roundCents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** yyyy-mm-dd one calendar month after `date` (clamped to month end). */
export function addOneMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const next = new Date(Date.UTC(y, m, Math.min(d, lastDay)))
  return next.toISOString().slice(0, 10)
}

/**
 * Picks each tenant's first-month invoice: the earliest-due invoice dated
 * within a month of their lease start (a week of slack for a pre-dated first
 * bill). Tenants with no lease start, or whose lease began before their
 * earliest invoice here (e.g. moved in before the app was used), get none, so
 * existing tenants are never charged the leasing fee by mistake.
 */
export function firstMonthInvoiceIds(
  invoices: Pick<SettlementPayment, "id" | "tenant_id" | "due_date">[],
  tenants: SettlementTenant[],
): Set<string> {
  const leaseStart = new Map(tenants.map((t) => [t.id, t.lease_start]))
  const earliest = new Map<string, { id: string; due: string }>()
  for (const inv of invoices) {
    if (!inv.tenant_id) continue
    const current = earliest.get(inv.tenant_id)
    if (!current || inv.due_date < current.due || (inv.due_date === current.due && inv.id < current.id)) {
      earliest.set(inv.tenant_id, { id: inv.id, due: inv.due_date })
    }
  }
  const ids = new Set<string>()
  for (const [tenantId, inv] of earliest) {
    const start = leaseStart.get(tenantId)
    if (!start) continue
    const weekBefore = new Date(`${start}T00:00:00Z`)
    weekBefore.setUTCDate(weekBefore.getUTCDate() - 7)
    if (inv.due >= weekBefore.toISOString().slice(0, 10) && inv.due < addOneMonth(start)) ids.add(inv.id)
  }
  return ids
}

/** Settlement for one owner. All inputs must already be limited to that owner's properties. */
export function computeSettlement(input: {
  payments: SettlementPayment[]
  firstMonthIds: Set<string>
  expenses: SettlementExpense[]
  payouts: SettlementPayout[]
  fees: FeeSettings
  /** Settle activity dated on or before this day (yyyy-mm-dd). */
  through: string
  /** Optional start of a reporting period; carriedOver is then not meaningful. */
  from?: string
}): Settlement {
  const { payments, firstMonthIds, expenses, fees, through, from } = input
  const payouts = input.payouts.filter((p) => !p.voided_at)

  const lastThrough = payouts.reduce<string | null>((latest, p) => {
    const d = p.through_date ?? p.payout_date
    return latest === null || d > latest ? d : latest
  }, null)

  const settled = (date: string) => lastThrough !== null && date <= lastThrough
  const inWindow = (date: string) => !settled(date) && date <= through && (!from || date >= from)

  const collected = payments.filter((p) => p.paid_date && Number(p.amount_paid) > 0)
  const managerExpenses = expenses.filter((e) => e.paid_by !== "owner")

  const carriedOver = roundCents(
    collected.filter((p) => settled(p.paid_date!)).reduce((s, p) => s + Number(p.amount_paid), 0) -
      managerExpenses.filter((e) => settled(e.date)).reduce((s, e) => s + Number(e.amount), 0) -
      payouts.reduce(
        (s, p) => s + Number(p.amount) + Number(p.leasing_fee || 0) + Number(p.management_fee || 0),
        0,
      ),
  )

  const windowRent = collected.filter((p) => inWindow(p.paid_date!))
  const rentCollected = roundCents(windowRent.reduce((s, p) => s + Number(p.amount_paid), 0))
  const firstMonthRent = roundCents(
    windowRent.filter((p) => firstMonthIds.has(p.id)).reduce((s, p) => s + Number(p.amount_paid), 0),
  )
  const leasingFee = roundCents((firstMonthRent * fees.leasing_fee_pct) / 100)
  const managementFee = roundCents(((rentCollected - firstMonthRent) * fees.management_fee_pct) / 100)

  const managerPaidExpenses = roundCents(
    managerExpenses.filter((e) => inWindow(e.date)).reduce((s, e) => s + Number(e.amount), 0),
  )
  const ownerPaidExpenses = roundCents(
    expenses.filter((e) => e.paid_by === "owner" && inWindow(e.date)).reduce((s, e) => s + Number(e.amount), 0),
  )

  return {
    lastThrough,
    through,
    carriedOver,
    rentCollected,
    firstMonthRent,
    leasingFee,
    managementFee,
    managerPaidExpenses,
    ownerPaidExpenses,
    suggestedPayout: roundCents(carriedOver + rentCollected - managerPaidExpenses - leasingFee - managementFee),
  }
}

/** Net payout for the numbers the manager actually entered. */
export function netPayout(s: Pick<Settlement, "carriedOver" | "rentCollected" | "managerPaidExpenses">, entered: {
  leasingFee: number
  managementFee: number
  adjustment: number
}): number {
  return roundCents(
    s.carriedOver + s.rentCollected - s.managerPaidExpenses - entered.leasingFee - entered.managementFee + entered.adjustment,
  )
}
