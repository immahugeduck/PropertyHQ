import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { InvoiceForm } from "@/components/forms/invoice-form"

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; property?: string }>
}) {
  const { tenant: defaultTenantId, property: defaultPropertyId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [tenantsResult, propertiesResult] = await Promise.all([
    supabase.from("visible_tenants").select("id, first_name, last_name, rent_amount, property_id, lease_end").eq("status", "active").order("first_name"),
    supabase.from("properties").select("id, name, address, monthly_rent").order("name"),
  ])

  const tenants = tenantsResult.data || []
  const properties = propertiesResult.data || []

  return (
    <div className="space-y-6 pt-12 lg:pt-0 max-w-2xl">
      <div>
        <Link
          href="/dashboard/invoices"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
        <h1 className="text-2xl font-bold">New Invoice</h1>
        <p className="text-muted-foreground text-sm">Create a one-time or recurring rent invoice</p>
      </div>

      <InvoiceForm
        userId={user!.id}
        tenants={tenants}
        properties={properties}
        defaultTenantId={defaultTenantId}
        defaultPropertyId={defaultPropertyId}
      />
    </div>
  )
}
