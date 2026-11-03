import { describe, it, expect, vi, beforeEach } from "vitest"
import { createFakeSupabase, type ReadResult } from "@/test/utils/fake-supabase"

// vi.mock factories are hoisted above imports, so the fns they reference must
// be created via vi.hoisted() to exist at hoist time.
const { getCurrentTenant, sessionsCreate, createClient, createServiceClient } = vi.hoisted(() => ({
  getCurrentTenant: vi.fn(),
  sessionsCreate: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}))

vi.mock("@/lib/tenant-auth", () => ({ getCurrentTenant }))
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { create: sessionsCreate } } } }))
vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/lib/supabase/service", () => ({ createServiceClient }))
vi.mock("@/lib/payments", () => ({ settleInvoicePaid: vi.fn(async () => ({ ok: true })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "app.test"], ["x-forwarded-proto", "https"]]),
}))

import { createRentCheckout } from "@/app/actions/rent-checkout"

const tenant = { id: "tenant-1", email: "sam@example.com" }

function supabaseReturning(invoice: unknown) {
  return createFakeSupabase({ read: (): ReadResult => ({ data: invoice, error: null }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentTenant.mockResolvedValue(tenant)
  sessionsCreate.mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" })
})

describe("createRentCheckout", () => {
  it("rejects an unauthenticated caller", async () => {
    getCurrentTenant.mockResolvedValueOnce(null)
    const result = await createRentCheckout("inv-1")
    expect(result).toEqual({ error: "Not authorized" })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("returns an error when the invoice is not found for this tenant", async () => {
    createClient.mockResolvedValue(supabaseReturning(null).client)
    const result = await createRentCheckout("inv-1")
    expect(result).toEqual({ error: "Invoice not found" })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("refuses to charge an already-paid invoice", async () => {
    createClient.mockResolvedValue(
      supabaseReturning({ id: "inv-1", amount: 1500, status: "paid", due_date: "2026-07-01" }).client,
    )
    const result = await createRentCheckout("inv-1")
    expect(result).toEqual({ error: "This invoice is already paid" })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("rejects an amount below Stripe's 50-cent minimum", async () => {
    createClient.mockResolvedValue(
      supabaseReturning({ id: "inv-1", amount: 0.25, status: "pending", due_date: "2026-07-01" }).client,
    )
    const result = await createRentCheckout("inv-1")
    expect(result).toEqual({ error: "Invalid invoice amount" })
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("charges only the unpaid balance on a partial invoice", async () => {
    createClient.mockResolvedValue(supabaseReturning({ id:"inv-1",user_id:"manager-1",amount:800,amount_paid:300,status:"partial",due_date:"2026-10-01" }).client)
    createServiceClient.mockReturnValue(createFakeSupabase().client)
    await createRentCheckout("inv-1")
    expect(sessionsCreate.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(50000)
  })

  it("charges the DB amount (not any client input) and returns the checkout URL", async () => {
    createClient.mockResolvedValue(
      supabaseReturning({
        id: "inv-1",
        user_id: "manager-1",
        amount: 1500,
        status: "pending",
        due_date: "2026-07-01",
        property: { name: "Maple Court" },
      }).client,
    )

    const service = createFakeSupabase()
    createServiceClient.mockReturnValue(service.client)

    const result = await createRentCheckout("inv-1")

    expect(sessionsCreate).toHaveBeenCalledTimes(1)
    const arg = sessionsCreate.mock.calls[0][0]
    // Security property: unit_amount is derived server-side from the DB amount.
    expect(arg.line_items[0].price_data.unit_amount).toBe(150000)
    expect(arg.metadata.invoice_id).toBe("inv-1")
    expect(result.url).toContain("checkout.stripe.com")
    expect(result.error).toBeUndefined()
    // Tenants can't UPDATE rent_payments under RLS, so the session id must be
    // saved with the service client or the success-page reconcile can't find it.
    expect(service.writes).toEqual([
      { table: "rent_payments", op: "update", values: { stripe_session_id: "cs_test_123" } },
    ])
  })
})
