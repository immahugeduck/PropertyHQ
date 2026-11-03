"use server"
import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
export async function saveLeaseBilling(id: string, form: FormData) {
  const db = await createClient()
  const { data:{user} } = await db.auth.getUser()
  if (!user) return { error:"Not authenticated" }
  const starts_on=String(form.get("starts_on") || ""), ends_on=String(form.get("ends_on") || "")
  const monthly_rent=Number(form.get("monthly_rent")), rent_due_day=Number(form.get("rent_due_day"))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(starts_on) || !/^\d{4}-\d{2}-\d{2}$/.test(ends_on) || ends_on<starts_on) return {error:"Enter valid lease dates; end must follow start."}
  if (!Number.isFinite(monthly_rent) || monthly_rent<=0 || !Number.isInteger(rent_due_day) || rent_due_day<1 || rent_due_day>28) return {error:"Enter a positive rent and billing day from 1 to 28."}
  const { data, error } = await db.from("leases").update({starts_on,ends_on,monthly_rent,rent_due_day}).eq("id",id).eq("user_id",user.id).eq("status","draft").select("id").single()
  if (error || !data) return {error:error?.message || "Only draft lease terms can be edited."}
  revalidatePath(`/dashboard/leases/${id}`)
  return {success:true}
}
