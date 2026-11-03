import { LeaseBillingForm } from "@/components/leases/lease-billing-form"
import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { LeaseEditor } from "@/components/leases/lease-editor"
import type { Lease, LeaseTemplate } from "@/lib/types"

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { id } = await params
  const { data: lease } = await supabase
    .from("leases")
    .select("*, tenant:tenants(id, first_name, last_name), property:properties(id, name), template:lease_templates(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!lease) notFound()
  const template = (Array.isArray(lease.template) ? lease.template[0] : lease.template) as LeaseTemplate

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard/leases">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to leases
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold text-foreground">{lease.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {lease.tenant ? `${lease.tenant.first_name} ${lease.tenant.last_name}` : "No tenant"}
          {lease.property ? ` · ${lease.property.name}` : ""}
        </p>
      </div>

      <LeaseBillingForm lease={lease as unknown as Lease} />
      {template ? (
        <LeaseEditor lease={lease as unknown as Lease} template={template} />
      ) : (
        <p className="text-sm text-destructive">This lease&apos;s template is missing.</p>
      )}
    </div>
  )
}
