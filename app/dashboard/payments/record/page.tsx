import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PaymentForm } from "@/components/forms/payment-form"

export default async function RecordPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; payment?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const { data: tenants } = await supabase
    .from("visible_tenants")
    .select("*")
    .eq("status", "active")
    .order("first_name")

  const { data: payment } = params.payment
    ? await supabase.from("rent_payments").select("*").eq("id", params.payment).eq("user_id", user.id).single()
    : { data: null }
  if (params.payment && !payment) notFound()

  const roster = tenants || []
  if (payment && !roster.some(t => t.id === payment.tenant_id)) {
    const {data: currentTenant} = await supabase.from("tenants").select("*").eq("id",payment.tenant_id).single()
    if (currentTenant) roster.push(currentTenant)
  }
  return (
    <div className="max-w-2xl mx-auto pt-12 lg:pt-0">
      <PaymentForm
        payment={payment ?? undefined}
        tenants={roster}
        userId={user.id}
        defaultTenantId={params.tenant}
      />
    </div>
  )
}
