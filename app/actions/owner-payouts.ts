"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { loadOwnerSettlement } from "@/lib/owner-settlement-data"
import { netPayout, roundCents } from "@/lib/owner-settlement"

type Result = { ok: boolean; error?: string }

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

function money(formData: FormData, key: string): number {
  const n = Number(formData.get(key) ?? 0)
  return Number.isFinite(n) ? roundCents(n) : NaN
}

/**
 * Records a payout the manager has already sent. The settlement is
 * recomputed here from the database, and the amount saved is always
 * carried over + rent - expenses - the fees entered + adjustment, so the
 * breakdown on record always adds up.
 */
export async function recordOwnerPayout(formData: FormData): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authenticated." }

  const ownerId = String(formData.get("owner_id") ?? "")
  const through = String(formData.get("through_date") ?? "")
  const payoutDate = String(formData.get("payout_date") ?? "")
  const method = String(formData.get("payment_method") ?? "").trim()
  const reference = String(formData.get("reference_number") ?? "").trim() || null
  const notes = String(formData.get("notes") ?? "").trim() || null
  const leasingFee = money(formData, "leasing_fee")
  const managementFee = money(formData, "management_fee")
  const adjustment = money(formData, "adjustment")

  if (!isDate(through) || !isDate(payoutDate)) return { ok: false, error: "Enter valid dates." }
  if (!method) return { ok: false, error: "Enter how you paid (check, ACH, cash…)." }
  if ([leasingFee, managementFee, adjustment].some(Number.isNaN) || leasingFee < 0 || managementFee < 0) {
    return { ok: false, error: "Fees must be zero or more." }
  }
  if (adjustment !== 0 && !notes) return { ok: false, error: "Add a note explaining the adjustment." }

  const data = await loadOwnerSettlement(supabase, user.id, ownerId, through)
  if (!data) return { ok: false, error: "Owner not found." }
  const { settlement } = data
  if (settlement.lastThrough && through <= settlement.lastThrough) {
    return { ok: false, error: `The last payout already covers through ${settlement.lastThrough}. Pick a later date.` }
  }

  const amount = netPayout(settlement, { leasingFee, managementFee, adjustment })
  if (amount <= 0) {
    return { ok: false, error: "Nothing is owed for this period with these numbers, so there's no payout to record." }
  }

  const { error } = await supabase.from("owner_payouts").insert({
    user_id: user.id,
    owner_id: ownerId,
    amount,
    payout_date: payoutDate,
    payment_method: method.slice(0, 80),
    reference_number: reference,
    notes,
    rent_collected: settlement.rentCollected,
    expenses_deducted: settlement.managerPaidExpenses,
    leasing_fee: leasingFee,
    management_fee: managementFee,
    adjustment,
    through_date: through,
  })
  if (error) {
    console.error("[v0] recordOwnerPayout error:", error)
    return { ok: false, error: error.message }
  }

  revalidatePath("/dashboard/owners/payouts")
  revalidatePath("/dashboard/reports/owners")
  return { ok: true }
}

/** Voids a recorded payout. It stays on file, marked void, and stops counting. */
export async function voidOwnerPayout(payoutId: string, reason: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authenticated." }
  const why = reason.trim()
  if (!why) return { ok: false, error: "Give a reason for voiding this payout." }

  const { data, error } = await supabase
    .from("owner_payouts")
    .update({ voided_at: new Date().toISOString(), void_reason: why.slice(0, 500) })
    .eq("id", payoutId)
    .eq("user_id", user.id)
    .is("voided_at", null)
    .select("id")
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: "Payout not found or already voided." }

  revalidatePath("/dashboard/owners/payouts")
  revalidatePath("/dashboard/reports/owners")
  return { ok: true }
}
