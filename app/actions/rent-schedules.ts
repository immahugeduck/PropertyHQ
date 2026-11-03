"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createNotification, notificationTemplates } from "@/lib/notifications"
import { sendEmail } from "@/lib/email"
import type { Tenant } from "@/lib/types"

type InvoiceTenant = Pick<Tenant, "id" | "first_name" | "last_name" | "email" | "auth_user_id">

function periodLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

/**
 * Manager action: create or update a recurring rent schedule for a tenant.
 * "Set up once" — the schedule then drives invoice generation on its day_of_month.
 */
export async function upsertRentSchedule(params: {
  tenantId: string
  propertyId: string | null
  amount: number
  dayOfMonth: number
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { tenantId, propertyId, amount, dayOfMonth } = params
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid rent amount." }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) return { error: "Day of month must be between 1 and 28." }

  const { data: tenant } = await supabase.from("tenants").select("id,property_id").eq("id",tenantId).eq("user_id",user.id).single()
  if (!tenant || !propertyId || tenant.property_id !== propertyId) return {error:"Select this tenant’s assigned property."}
  const { data: existing } = await supabase
    .from("rent_schedules")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from("rent_schedules")
      .update({ amount, day_of_month: dayOfMonth, property_id: propertyId, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from("rent_schedules").insert({
      user_id: user.id,
      tenant_id: tenantId,
      property_id: propertyId,
      amount,
      day_of_month: dayOfMonth,
      active: true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath(`/dashboard/tenants/${tenantId}`)
  return { success: true }
}

/**
 * Manager action: stop a recurring rent schedule.
 */
export async function cancelRentSchedule(scheduleId: string, tenantId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await supabase
    .from("rent_schedules")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .eq("user_id", user.id)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/tenants/${tenantId}`)
  return { success: true }
}

/**
 * Generate any due invoices from active schedules for the current manager.
 * Idempotent per month via rent_schedules.last_generated_for.
 * Can be triggered manually by the manager, or by a scheduled job.
 */
export async function generateDueInvoices() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated", created: 0 }

  const { data: schedules } = await supabase
    .from("rent_schedules")
    .select("*, tenant:tenants(id, first_name, last_name, email, auth_user_id, is_demo, status, lease_start, lease_end), lease:leases(id, status, starts_on, ends_on), property:properties(id, name)")
    .eq("user_id", user.id)
    .eq("active", true)

  if (!schedules || schedules.length === 0) return { success: true, created: 0 }

  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodKey = periodStart.toISOString().slice(0, 10)
  let created = 0

  for (const s of schedules) {
    const today = now.toISOString().slice(0,10)
    if (s.tenant?.is_demo || s.tenant?.status !== "active") continue
    const lease = s.lease as { id:string; status:string; starts_on:string; ends_on:string } | null
    if (lease && (lease.status !== "signed" || today < lease.starts_on || today > lease.ends_on)) continue
    if (!lease && ((s.tenant?.lease_start && today < s.tenant.lease_start) || (s.tenant?.lease_end && today > s.tenant.lease_end))) continue
    // Only generate once the day_of_month has arrived this month.
    if (now.getDate() < (s.day_of_month || 1)) continue
    // Skip if already generated for this month.
    if (s.last_generated_for && s.last_generated_for >= periodKey) continue

    const dueDate = new Date(now.getFullYear(), now.getMonth(), s.day_of_month || 1)
    const dueKey = dueDate.toISOString().slice(0,10)
    if (lease && (dueKey < lease.starts_on || dueKey > lease.ends_on)) continue
    const receiptBase = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`

    const { error: insErr } = await supabase.from("rent_payments").insert({
      user_id: user.id,
      tenant_id: s.tenant_id,
      property_id: s.property_id,
      amount: s.amount,
      due_date: dueDate.toISOString().slice(0, 10),
      status: "pending",
      is_recurring: true,
      recurring_day: s.day_of_month,
      rent_schedule_id: s.id,
      lease_id: s.lease_id,
      receipt_number: `${receiptBase}-${s.tenant_id.slice(0, 6)}`,
    })

    if (insErr) {
      console.log("[v0] Failed to generate invoice:", insErr.message)
      continue
    }

    await supabase.from("rent_schedules").update({ last_generated_for: periodKey }).eq("id", s.id)
    created++

    // Notify the tenant (if their portal is active) that a new invoice is ready.
    const tenant = s.tenant as InvoiceTenant | null
    if (tenant?.auth_user_id) {
      const label = periodLabel(periodStart)
      const tmpl = notificationTemplates.invoiceIssued(s.amount, label)
      await createNotification({
        userId: tenant.auth_user_id,
        recipientType: "tenant",
        ...tmpl,
        link: "/portal/payments",
      }).catch(() => {})

      // Also send an email if the tenant has one on file
      if (tenant.email) {
        const money = `$${Number(s.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
        await sendEmail({
          to: tenant.email,
          subject: `New Rent Invoice — ${label}`,
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1a1f25;">
              <h1 style="font-size:20px;">Property HQ — New Invoice</h1>
              <p>Hi ${tenant.first_name},</p>
              <p>Your rent invoice of <strong>${money}</strong> for <strong>${label}</strong> is ready.</p>
              <p style="margin:24px 0;">
                <a href="${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/portal/payments"
                   style="background:#1f8f6b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;display:inline-block;">
                  View &amp; Pay Invoice
                </a>
              </p>
              <p style="color:#6b7280;font-size:12px;">Log in to your tenant portal to pay online.</p>
            </div>`,
        }).catch(() => {})
      }
    }
  }

  revalidatePath("/dashboard/payments")
  return { success: true, created }
}
