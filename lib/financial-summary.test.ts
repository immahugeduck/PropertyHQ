import { describe,it,expect } from "vitest"
import { summarizePayments } from "./financial-summary"
import { getDateRange } from "./reports"
describe("financial totals",()=>{
  it("reconciles charges with receipts and pending/overdue balances, including partial receipts",()=>{
    const totals=summarizePayments([
      {amount:"800.00",amount_paid:"300.00",balance_due:"500.00",status:"overdue"},
      {amount:1200,amount_paid:1200,balance_due:0,status:"paid"},
      {amount:700.25,amount_paid:0,balance_due:700.25,status:"pending"},
      {amount:100,amount_paid:20,balance_due:80,status:"partial"},
    ])
    expect(totals).toEqual({charged:2800.25,collected:1520,pending:780.25,overdue:500,pendingCount:2,overdueCount:1})
    expect(totals.charged).toBe(totals.collected+totals.pending+totals.overdue)
  })
  it("handles an empty account",()=>expect(summarizePayments([]).charged).toBe(0))
  it("provides an all-time report range for dashboard reconciliation",()=>expect(getDateRange("all-time")).toEqual({from:"0001-01-01",to:"9999-12-31"}))
})
