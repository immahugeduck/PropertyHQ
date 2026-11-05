/** Shared totals for the dashboard, payment list and rent collection report. */
export function summarizePayments(payments: { amount: number | string; amount_paid?: number | string; balance_due?: number | string; status: string }[]) {
  return payments.reduce((totals, p) => {
    const amount = Number(p.amount)
    const paid = Number(p.amount_paid ?? (p.status === "paid" ? amount : 0))
    const balance = Number(p.balance_due ?? amount - paid)
    totals.charged += amount
    totals.collected += paid
    if (p.status === "overdue") { totals.overdue += balance; totals.overdueCount++ }
    else if (p.status !== "paid") { totals.pending += balance; totals.pendingCount++ }
    return totals
  }, { charged: 0, collected: 0, pending: 0, overdue: 0, pendingCount: 0, overdueCount: 0 })
}
