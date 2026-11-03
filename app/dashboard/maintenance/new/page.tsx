import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { MaintenanceForm } from "@/components/forms/maintenance-form"

export default async function NewMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; tenant?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const [propertiesResult, tenantsResult] = await Promise.all([
    supabase.from("properties").select("*").order("name"),
    supabase.from("visible_tenants").select("*").eq("status", "active").order("first_name"),
  ])

  return (
    <div className="max-w-2xl mx-auto pt-12 lg:pt-0">
      <MaintenanceForm
        properties={propertiesResult.data || []}
        tenants={tenantsResult.data || []}
        userId={user.id}
        defaultPropertyId={params.property}
        defaultTenantId={params.tenant}
      />
    </div>
  )
}
