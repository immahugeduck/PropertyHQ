import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { NewLeaseForm } from "@/components/leases/new-lease-form"
import type { LeaseTemplate, Tenant } from "@/lib/types"

type LeaseFormTenant = Pick<Tenant, "id" | "first_name" | "last_name"> & { property?: { name: string } | null }

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { template } = await searchParams

  const [templatesRes, tenantsRes] = await Promise.all([
    supabase.from("lease_templates").select("*").eq("user_id", user.id).order("name"),
    supabase
      .from("visible_tenants")
      .select("id, first_name, last_name, property:properties(name)")
      .eq("user_id", user.id)
      .order("first_name"),
  ])

  const templates = (templatesRes.data || []) as LeaseTemplate[]
  if (templates.length === 0) redirect("/dashboard/leases")

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard/leases">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to leases
        </Link>
      </Button>
      <NewLeaseForm
        templates={templates}
        tenants={(tenantsRes.data || []) as unknown as LeaseFormTenant[]}
        defaultTemplate={template}
      />
    </div>
  )
}
