import { describe, expect, it } from "vitest"
import { addOneMonth, computeSettlement, firstMonthInvoiceIds, netPayout } from "./owner-settlement"

const fees = { leasing_fee_pct: 50, management_fee_pct: 10 }

describe("addOneMonth", () => {
  it("clamps to the end of shorter months", () => {
    expect(addOneMonth("2026-01-31")).toBe("2026-02-28")
    expect(addOneMonth("2026-12-15")).toBe("2027-01-15")
  })
})

describe("firstMonthInvoiceIds", () => {
  it("marks a new tenant's earliest invoice near lease start", () => {
    const ids = firstMonthInvoiceIds(
      [
        { id: "b", tenant_id: "t1", due_date: "2026-12-01" },
        { id: "a", tenant_id: "t1", due_date: "2026-11-01" },
      ],
      [{ id: "t1", lease_start: "2026-11-01" }],
    )
    expect([...ids]).toEqual(["a"])
  })

  it("skips tenants who moved in long before their first invoice here", () => {
    const ids = firstMonthInvoiceIds(
      [{ id: "a", tenant_id: "t1", due_date: "2026-11-01" }],
      [{ id: "t1", lease_start: "2024-06-01" }],
    )
    expect(ids.size).toBe(0)
  })

  it("skips tenants with no lease start", () => {
    const ids = firstMonthInvoiceIds([{ id: "a", tenant_id: "t1", due_date: "2026-11-01" }], [{ id: "t1", lease_start: null }])
    expect(ids.size).toBe(0)
  })
})

describe("computeSettlement", () => {
  const payments = [
    // New tenant: first month 1000 (50%), second month 1000 (10%).
    { id: "p1", tenant_id: "t1", property_id: "h1", due_date: "2026-11-01", paid_date: "2026-11-01", amount_paid: 1000 },
    { id: "p2", tenant_id: "t1", property_id: "h1", due_date: "2026-12-01", paid_date: "2026-12-02", amount_paid: 1000 },
    // Uncollected rent is ignored.
    { id: "p3", tenant_id: "t1", property_id: "h1", due_date: "2027-01-01", paid_date: null, amount_paid: 0 },
  ]
  const expenses = [
    { property_id: "h1", amount: 150, date: "2026-12-05", paid_by: "manager" as const },
    { property_id: "h1", amount: 400, date: "2026-12-06", paid_by: "owner" as const },
  ]

  it("suggests the first payout with leasing fee, management fee and expenses", () => {
    const s = computeSettlement({
      payments,
      firstMonthIds: new Set(["p1"]),
      expenses,
      payouts: [],
      fees,
      through: "2026-12-31",
    })
    expect(s).toMatchObject({
      lastThrough: null,
      carriedOver: 0,
      rentCollected: 2000,
      firstMonthRent: 1000,
      leasingFee: 500,
      managementFee: 100,
      managerPaidExpenses: 150,
      ownerPaidExpenses: 400,
      suggestedPayout: 1250,
    })
  })

  it("only settles activity after the last payout, carrying any difference", () => {
    // November paid out with the full suggested fee: 1000 - 500 = 500.
    const s = computeSettlement({
      payments,
      firstMonthIds: new Set(["p1"]),
      expenses,
      payouts: [
        { amount: 500, leasing_fee: 500, management_fee: 0, payout_date: "2026-11-05", through_date: "2026-11-30", voided_at: null },
      ],
      fees,
      through: "2026-12-31",
    })
    expect(s.carriedOver).toBe(0)
    expect(s.rentCollected).toBe(1000)
    expect(s.leasingFee).toBe(0)
    expect(s.managementFee).toBe(100)
    expect(s.suggestedPayout).toBe(750)
  })

  it("carries an underpayment forward and ignores voided payouts", () => {
    const s = computeSettlement({
      payments,
      firstMonthIds: new Set(["p1"]),
      expenses,
      payouts: [
        // Paid 100 less than owed for November.
        { amount: 400, leasing_fee: 500, management_fee: 0, payout_date: "2026-11-05", through_date: "2026-11-30", voided_at: null },
        { amount: 999, leasing_fee: 0, management_fee: 0, payout_date: "2026-11-06", through_date: "2026-12-31", voided_at: "2026-11-07T00:00:00Z" },
      ],
      fees,
      through: "2026-12-31",
    })
    expect(s.lastThrough).toBe("2026-11-30")
    expect(s.carriedOver).toBe(100)
    expect(s.suggestedPayout).toBe(850)
  })

  it("limits a statement to its period when given a start date", () => {
    const s = computeSettlement({
      payments,
      firstMonthIds: new Set(["p1"]),
      expenses,
      payouts: [],
      fees,
      from: "2026-12-01",
      through: "2026-12-31",
    })
    expect(s.rentCollected).toBe(1000)
    expect(s.leasingFee).toBe(0)
    expect(s.managementFee).toBe(100)
    expect(s.managerPaidExpenses).toBe(150)
  })

  it("nets the numbers the manager actually entered", () => {
    const s = { carriedOver: 100, rentCollected: 1000, managerPaidExpenses: 150 }
    expect(netPayout(s, { leasingFee: 0, managementFee: 80, adjustment: -20 })).toBe(850)
  })
})
