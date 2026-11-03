"use server"

import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import { getCurrentTenant } from "@/lib/tenant-auth"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { settleInvoicePaid } from "@/lib/payments"
import { revalidatePath } from "next/cache"

async function getBaseUrl() {
  const h = await headers()
  const host = h.get("x-forwarded-host") || h.get("host")
  const proto = h.get("x-forwarded-proto") || "https"
  return `${proto}://${host}`
}

/**
 * Creates a Stripe Checkout session for a specific rent invoice.
 * The amount is looked up server-side from the database and scoped to the
 * authenticated tenant, so the client can never tamper with the price.
 */
export async function createRentCheckout(invoiceId: string): Promise<{ url?: string; error?: string }> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { error: "Not authorized" }

  const supabase = await createClient()

  // Look up the invoice, scoped to this tenant. RLS also enforces this.
  const { data: invoice, error } = await supabase
    .from("rent_payments")
    .select("*, property:properties(name)")
    .eq("id", invoiceId)
    .eq("tenant_id", tenant.id)
    .single()

  if (error || !invoice) return { error: "Invoice not found" }
  if (invoice.status === "paid") return { error: "This invoice is already paid" }

  const amountInCents = Math.round((Number(invoice.amount) - Number(invoice.amount_paid || 0)) * 100)
  if (!amountInCents || amountInCents < 50) return { error: "Invalid invoice amount" }

  const baseUrl = await getBaseUrl()
  const period = new Date(invoice.due_date).toLocaleDateString("en-US", { month: "long", year: "numeric" })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountInCents,
            product_data: {
              name: `Rent — ${period}`,
              description: invoice.property?.name ? `${invoice.property.name}` : "Monthly rent",
            },
          },
        },
      ],
      // We reconcile via the webhook; metadata ties the session back to our invoice.
      metadata: {
        invoice_id: invoice.id,
        tenant_id: tenant.id,
        manager_user_id: invoice.user_id,
      },
      customer_email: tenant.email || undefined,
      success_url: `${baseUrl}/portal/payments?paid=${invoice.id}`,
      cancel_url: `${baseUrl}/portal/payments?canceled=1`,
    })

    // Store the session id so the success-page reconcile and the webhook can
    // match it. Tenants have no UPDATE policy on rent_payments, so this must use
    // the service client; the invoice was already verified as this tenant's above.
    const { error: saveErr } = await createServiceClient()
      .from("rent_payments")
      .update({ stripe_session_id: session.id })
      .eq("id", invoice.id)
      .eq("tenant_id", tenant.id)
    if (saveErr) console.error("[v0] Could not save Stripe session id:", saveErr)

    return { url: session.url ?? undefined }
  } catch (err) {
    console.error("[v0] Stripe checkout error:", err)
    return { error: "Could not start checkout. Please try again." }
  }
}

/**
 * Safety-net reconciliation called from the success page. Confirms the invoice's
 * Stripe session is actually paid, then settles it. This covers environments where
 * the Stripe webhook secret isn't configured. Idempotent.
 */
export async function reconcileInvoicePayment(invoiceId: string): Promise<{ paid: boolean }> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { paid: false }

  const supabase = await createClient()
  const { data: invoice } = await supabase
    .from("rent_payments")
    .select("id, status, stripe_session_id")
    .eq("id", invoiceId)
    .eq("tenant_id", tenant.id)
    .single()

  if (!invoice) return { paid: false }
  if (invoice.status === "paid") return { paid: true }
  if (!invoice.stripe_session_id) return { paid: false }

  try {
    const session = await stripe.checkout.sessions.retrieve(invoice.stripe_session_id)
    if (session.payment_status === "paid") {
      const db = createServiceClient()
      const h = await headers()
      const host = h.get("x-forwarded-host") || h.get("host")
      const proto = h.get("x-forwarded-proto") || "https"
      await settleInvoicePaid(db, invoiceId, {
        paymentMethod: "Card (Stripe)",
        stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
        portalUrl: `${proto}://${host}/portal/payments/${invoiceId}/receipt`,
      })
      revalidatePath("/portal/payments")
      return { paid: true }
    }
  } catch (err) {
    console.error("[v0] Reconcile error:", err)
  }
  return { paid: false }
}
