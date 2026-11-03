"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { getCurrentTenant } from "@/lib/tenant-auth"
import { getFromName } from "@/lib/profile"
import { fillLeasePdf, resolveAutofill } from "@/lib/lease-pdf"
import { createNotification } from "@/lib/notifications"
import type { LeaseTemplate, LeaseTemplateField } from "@/lib/types"
import { revalidatePath } from "next/cache"

const BUCKET = "property-files"

/** Create a draft lease from a template for a tenant, pre-filling bound fields. */
export async function createLease({
  templateId,
  tenantId,
}: {
  templateId: string
  tenantId: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: template } = await supabase
    .from("lease_templates")
    .select("*")
    .eq("id", templateId)
    .eq("user_id", user.id)
    .single()
  if (!template) return { error: "Template not found" }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("*, property:properties(*)")
    .eq("id", tenantId)
    .eq("user_id", user.id)
    .single()
  if (!tenant) return { error: "Tenant not found" }
  if (!tenant.property_id) return { error: "Assign a property to this tenant before creating a lease." }

  const managerName = await getFromName(supabase, user.id)
  const values = resolveAutofill(template.fields as LeaseTemplateField[], {
    tenant,
    property: tenant.property,
    managerName,
  })
  // Default: mark the fixed-lease box if the template has it.
  if ((template.fields as LeaseTemplateField[]).some((f) => f.key === "lease_type_fixed")) {
    values["lease_type_fixed"] = true as unknown as string
  }

  const { data: lease, error } = await supabase
    .from("leases")
    .insert({
      user_id: user.id,
      template_id: template.id,
      tenant_id: tenant.id,
      property_id: tenant.property_id,
      title: template.name,
      status: "draft",
      values,
    })
    .select()
    .single()
  if (error) return { error: error.message }

  revalidatePath("/dashboard/leases")
  return { success: true, leaseId: lease.id }
}

/** Save manager-entered field values on a draft/sent lease. */
export async function updateLeaseValues(
  leaseId: string,
  values: Record<string, string | boolean>
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: lease } = await supabase
    .from("leases")
    .select("values, status")
    .eq("id", leaseId)
    .eq("user_id", user.id)
    .single()
  if (!lease) return { error: "Lease not found" }
  if (lease.status === "signed" || lease.status === "voided")
    return { error: "This lease can no longer be edited" }

  const merged = { ...(lease.values || {}), ...values }
  const { error } = await supabase
    .from("leases")
    .update({ values: merged })
    .eq("id", leaseId)
    .eq("user_id", user.id)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/leases/${leaseId}`)
  return { success: true }
}

/** Send a lease to the tenant for signing. */
export async function sendLease(leaseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: lease } = await supabase
    .from("leases")
    .select("*, tenant:tenants(id, first_name, last_name, auth_user_id, portal_enabled)")
    .eq("id", leaseId)
    .eq("user_id", user.id)
    .single()
  if (!lease) return { error: "Lease not found" }
  if (lease.status === "signed")
    return { error: "This lease has already been signed and can't be sent again." }
  if (lease.status === "voided")
    return { error: "This lease has been voided." }
  if (!lease.starts_on || !lease.ends_on || !lease.monthly_rent || !lease.rent_due_day)
    return { error: "Save lease billing terms before sending for signature." }
  if (!lease.tenant?.auth_user_id)
    return { error: "This tenant has not activated their portal yet. Invite them first." }

  const { error } = await supabase
    .from("leases")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", leaseId)
    .eq("user_id", user.id)
  if (error) return { error: error.message }

  await createNotification({
    userId: lease.tenant.auth_user_id,
    recipientType: "tenant",
    type: "general",
    title: "Lease ready to sign",
    message: `Your ${lease.title} is ready for review and signature.`,
    link: `/portal/documents/${leaseId}/sign`,
    relatedId: leaseId,
  })

  revalidatePath(`/dashboard/leases/${leaseId}`)
  revalidatePath("/dashboard/leases")
  return { success: true }
}

/** Void a lease (manager). */
export async function voidLease(leaseId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await supabase
    .from("leases")
    .update({ status: "voided" })
    .eq("id", leaseId)
    .eq("user_id", user.id)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/leases/${leaseId}`)
  return { success: true }
}

/**
 * Returns a short-lived signed URL for a lease document so it can be rendered in
 * the browser. `which` selects the blank template or the final signed PDF. Access
 * is authorized first (manager owner or the assigned tenant); file IO uses the
 * service client so it works regardless of storage RLS.
 */
export async function getLeaseDocumentUrl(leaseId: string, which: "template" | "signed") {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: lease } = await supabase
    .from("leases")
    .select("user_id, tenant_id, signed_storage_path, template:lease_templates(storage_path)")
    .eq("id", leaseId)
    .single()
  if (!lease) return { error: "Lease not found" }

  // Authorize: manager owner, or the tenant the lease belongs to.
  let authorized = lease.user_id === user.id
  if (!authorized) {
    const tenant = await getCurrentTenant()
    authorized = !!tenant && tenant.id === lease.tenant_id
  }
  if (!authorized) return { error: "Not authorized" }

  const path =
    which === "signed"
      ? lease.signed_storage_path
      : // @ts-expect-error supabase infers template as array in the typegen
        (Array.isArray(lease.template) ? lease.template[0]?.storage_path : lease.template?.storage_path)
  if (!path) return { error: "Document not available" }

  const service = createServiceClient()
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error) return { error: error.message }
  return { success: true, url: data.signedUrl }
}

/**
 * Tenant action: merge tenant-entered values + signature, render the final
 * flattened PDF, store it in Files, and mark the lease signed.
 */
export async function signLease(
  leaseId: string,
  tenantValues: Record<string, string>,
  signatures: Record<string, string>
) {
  const supabase = await createClient()
  const tenant = await getCurrentTenant()
  if (!tenant) return { error: "Not authenticated" }

  const { data: lease } = await supabase
    .from("leases")
    .select("*, template:lease_templates(*)")
    .eq("id", leaseId)
    .single()
  if (!lease) return { error: "Lease not found" }
  if (lease.tenant_id !== tenant.id) return { error: "Not authorized" }
  if (lease.status !== "sent") return { error: "This lease is not awaiting your signature" }

  const template = (Array.isArray(lease.template) ? lease.template[0] : lease.template) as LeaseTemplate
  if (!template) return { error: "Template missing" }

  const today = new Date().toLocaleDateString("en-US")
  const tenantFields = template.fields.filter((f) => f.role === "tenant")
  const merged: Record<string, string | boolean> = { ...(lease.values || {}) }
  for (const f of tenantFields) {
    if (f.type === "signature" || f.type === "initials") {
      if (signatures[f.key]) merged[f.key] = signatures[f.key]
    } else if (f.type === "date" && !tenantValues[f.key]) {
      merged[f.key] = today
    } else if (tenantValues[f.key] != null) {
      merged[f.key] = tenantValues[f.key]
    }
  }

  // Render the final PDF with the service client (download template + upload signed).
  const service = createServiceClient()
  const { data: tplFile, error: dlErr } = await service.storage
    .from(BUCKET)
    .download(template.storage_path)
  if (dlErr || !tplFile) return { error: "Could not load the lease template" }
  const templateBytes = new Uint8Array(await tplFile.arrayBuffer())

  let signedBytes: Uint8Array
  try {
    signedBytes = await fillLeasePdf(templateBytes, template.fields, merged)
  } catch (e) {
    return { error: `Failed to generate signed PDF: ${(e as Error).message}` }
  }

  const signerName = `${tenant.first_name} ${tenant.last_name}`.trim()
  const fileName = `${template.name} - ${signerName} (signed).pdf`
  const signedPath = `${lease.user_id}/signed-leases/${leaseId}.pdf`

  const { error: upErr } = await service.storage
    .from(BUCKET)
    .upload(signedPath, signedBytes, { contentType: "application/pdf", upsert: true })
  if (upErr) return { error: `Failed to store signed lease: ${upErr.message}` }

  // Attach to the manager's Files (tenant-linked) via the service client.
  const { data: fileRow, error: fileErr } = await service
    .from("files")
    .insert({
      user_id: lease.user_id,
      storage_path: signedPath,
      file_name: fileName,
      file_size: signedBytes.byteLength,
      mime_type: "application/pdf",
      tenant_id: tenant.id,
      property_id: lease.property_id,
      is_template: false,
      description: "Signed lease agreement",
    })
    .select("id")
    .single()
  if (fileErr || !fileRow) {
    // Roll back the uploaded PDF so we don't leave an orphaned object, and abort
    // before marking the lease signed.
    await service.storage.from(BUCKET).remove([signedPath])
    return { error: `Failed to record the signed lease: ${fileErr?.message ?? "unknown error"}` }
  }

  const { error: updErr } = await service
    .from("leases")
    .update({
      status: "signed",
      values: merged,
      signed_storage_path: signedPath,
      signed_file_id: fileRow.id,
      signer_name: signerName,
      signed_at: new Date().toISOString(),
    })
    .eq("id", leaseId)
  if (updErr) return { error: updErr.message }

  await createNotification({
    userId: lease.user_id,
    recipientType: "manager",
    type: "general",
    title: "Lease signed",
    message: `${signerName} signed the ${lease.title}.`,
    link: `/dashboard/leases/${leaseId}`,
    relatedId: leaseId,
    client: service,
  })

  revalidatePath(`/portal/documents`)
  revalidatePath(`/dashboard/leases/${leaseId}`)
  revalidatePath("/dashboard/leases")
  if (lease.tenant_id) revalidatePath(`/dashboard/tenants/${lease.tenant_id}`)
  return { success: true }
}
