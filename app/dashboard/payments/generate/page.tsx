import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { GenerateRentForm } from "@/components/forms/generate-rent-form"

export default async function GenerateRentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect("/auth/login")
  }

  // Get active tenants with properties
  const { data: tenants } = await supabase
    .from("visible_tenants")
    .select(`
      *,
      property:properties(id, name, address, monthly_rent)
    `)
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("property_id", "is", null)
    .order("last_name", { ascending: true })

  // Get existing payments for current month to avoid duplicates
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0]

  const { data: existingPayments } = await supabase
    .from("payment_balances")
    .select("tenant_id")
    .eq("user_id", user.id)
    .gte("due_date", firstOfMonth)
    .lte("due_date", lastOfMonth)

  const existingTenantIds = new Set(existingPayments?.map(p => p.tenant_id) || [])

  return (
    <div className="max-w-3xl mx-auto">
      <GenerateRentForm 
        tenants={tenants || []}
        existingTenantIds={existingTenantIds}
        userId={user.id}
      />
    </div>
  )
}
