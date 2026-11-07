"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { getCurrentTenant } from "@/lib/tenant-auth"
import { createNotification } from "@/lib/notifications"
import { normalizeUsPhone } from "@/lib/phone"

type Result = { ok: boolean; error?: string }

/** A unit rarely has more than this many people; caps abuse of the portal form. */
const MAX_HOUSEHOLD_MEMBERS = 15

function text(formData: FormData, key: string, max: number): string | null {
  const value = (formData.get(key) as string | null)?.trim() ?? ""
  return value ? value.slice(0, max) : null
}

/** Validates an optional phone field; returns the error message, if any. */
function phoneError(value: string | null, label: string): string | null {
  if (value && !normalizeUsPhone(value)) return `${label} must be a full 10-digit phone number.`
  return null
}

function revalidateTenant(tenantId: string) {
  revalidatePath("/portal/profile")
  revalidatePath(`/dashboard/tenants/${tenantId}`)
}

async function notifyManager(
  managerId: string,
  tenantId: string,
  title: string,
  message: string,
) {
  try {
    await createNotification({
      client: createServiceClient(),
      userId: managerId,
      recipientType: "manager",
      type: "tenant_updated",
      title,
      message,
      relatedId: tenantId,
      link: `/dashboard/tenants/${tenantId}`,
    })
  } catch (err) {
    console.error("[v0] household notification error:", err)
  }
}

// ---------------------------------------------------------------------------
// Tenant portal
//
// Tenants have no UPDATE policy on tenants and only SELECT on
// household_members, so these use the service client. Each one first resolves
// the signed-in tenant and only ever touches that tenant's own rows and the
// contact fields listed here.
// ---------------------------------------------------------------------------

export async function updateMyContactInfo(formData: FormData): Promise<Result> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { ok: false, error: "Not authorized." }

  const phone = text(formData, "phone", 40)
  const emergencyName = text(formData, "emergency_contact_name", 120)
  const emergencyPhone = text(formData, "emergency_contact_phone", 40)
  const emergencyRelationship = text(formData, "emergency_contact_relationship", 60)

  if (!phone) return { ok: false, error: "Please enter your phone number." }
  const invalid =
    phoneError(phone, "Your phone") ?? phoneError(emergencyPhone, "Emergency contact phone")
  if (invalid) return { ok: false, error: invalid }

  const { error } = await createServiceClient()
    .from("tenants")
    .update({
      phone,
      emergency_contact_name: emergencyName,
      emergency_contact_phone: emergencyPhone,
      emergency_contact_relationship: emergencyRelationship,
    })
    .eq("id", tenant.id)

  if (error) {
    console.error("[v0] updateMyContactInfo error:", error)
    return { ok: false, error: "Could not save your information." }
  }

  // The maintenance text line recognizes tenants by phone, so a new number
  // matters to the manager.
  if (normalizeUsPhone(phone) !== normalizeUsPhone(tenant.phone)) {
    await notifyManager(
      tenant.user_id,
      tenant.id,
      "Tenant phone number changed",
      `${tenant.first_name} ${tenant.last_name} changed their phone from ${tenant.phone || "none"} to ${phone}.`,
    )
  }

  revalidateTenant(tenant.id)
  return { ok: true }
}

export async function addMyHouseholdMember(formData: FormData): Promise<Result> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { ok: false, error: "Not authorized." }

  const fullName = text(formData, "full_name", 120)
  const relationship = text(formData, "relationship", 60)
  const phone = text(formData, "phone", 40)
  const isMinor = formData.get("is_minor") === "on" || formData.get("is_minor") === "true"

  if (!fullName) return { ok: false, error: "Please enter their full name." }
  const invalid = phoneError(phone, "Phone")
  if (invalid) return { ok: false, error: invalid }

  const db = createServiceClient()
  const { count } = await db
    .from("household_members")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .is("removed_at", null)
  if ((count ?? 0) >= MAX_HOUSEHOLD_MEMBERS) {
    return { ok: false, error: "Your household list is full. Please contact your property manager." }
  }

  const { error } = await db.from("household_members").insert({
    user_id: tenant.user_id,
    tenant_id: tenant.id,
    full_name: fullName,
    relationship,
    is_minor: isMinor,
    phone,
    added_by: "tenant",
  })

  if (error) {
    console.error("[v0] addMyHouseholdMember error:", error)
    return { ok: false, error: "Could not add that person." }
  }

  await notifyManager(
    tenant.user_id,
    tenant.id,
    "Household member added",
    `${tenant.first_name} ${tenant.last_name} added ${fullName}${relationship ? ` (${relationship})` : ""} to ${tenant.property?.name ?? "their unit"}.`,
  )

  revalidateTenant(tenant.id)
  return { ok: true }
}

export async function removeMyHouseholdMember(memberId: string): Promise<Result> {
  const tenant = await getCurrentTenant()
  if (!tenant) return { ok: false, error: "Not authorized." }

  // Kept as history for the manager; the tenant no longer sees it.
  const { data: removed, error } = await createServiceClient()
    .from("household_members")
    .update({ removed_at: new Date().toISOString(), removed_by: "tenant" })
    .eq("id", memberId)
    .eq("tenant_id", tenant.id)
    .is("removed_at", null)
    .select("full_name")
    .maybeSingle()

  if (error) {
    console.error("[v0] removeMyHouseholdMember error:", error)
    return { ok: false, error: "Could not remove that person." }
  }
  if (!removed) return { ok: false, error: "Person not found." }

  await notifyManager(
    tenant.user_id,
    tenant.id,
    "Household member removed",
    `${tenant.first_name} ${tenant.last_name} removed ${removed.full_name} from ${tenant.property?.name ?? "their unit"}.`,
  )

  revalidateTenant(tenant.id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Manager dashboard: plain server client, so RLS limits these to the
// manager's own tenants.
// ---------------------------------------------------------------------------

export async function addHouseholdMember(tenantId: string, formData: FormData): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authenticated." }

  const fullName = text(formData, "full_name", 120)
  const relationship = text(formData, "relationship", 60)
  const phone = text(formData, "phone", 40)
  const isMinor = formData.get("is_minor") === "on" || formData.get("is_minor") === "true"

  if (!fullName) return { ok: false, error: "Please enter their full name." }
  const invalid = phoneError(phone, "Phone")
  if (invalid) return { ok: false, error: invalid }

  // Confirms the tenant is this manager's before inserting under their id.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!tenant) return { ok: false, error: "Tenant not found." }

  const { error } = await supabase.from("household_members").insert({
    user_id: user.id,
    tenant_id: tenantId,
    full_name: fullName,
    relationship,
    is_minor: isMinor,
    phone,
    added_by: "manager",
  })

  if (error) {
    console.error("[v0] addHouseholdMember error:", error)
    return { ok: false, error: "Could not add that person." }
  }

  revalidateTenant(tenantId)
  return { ok: true }
}

export async function removeHouseholdMember(tenantId: string, memberId: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authenticated." }

  // Kept as history ("previously listed") rather than deleted.
  const { error } = await supabase
    .from("household_members")
    .update({ removed_at: new Date().toISOString(), removed_by: "manager" })
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .is("removed_at", null)

  if (error) {
    console.error("[v0] removeHouseholdMember error:", error)
    return { ok: false, error: "Could not remove that person." }
  }

  revalidateTenant(tenantId)
  return { ok: true }
}
