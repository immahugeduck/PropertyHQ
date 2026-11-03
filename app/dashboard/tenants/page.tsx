import { createClient } from "@/lib/supabase/server"
import type { Tenant } from "@/lib/types"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Users, Mail, Phone, Building2, Calendar } from "lucide-react"

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateString: string | null) {
  if (!dateString) return "N/A"
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const statusColors = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  inactive: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
}

export default async function TenantsPage() {
  const supabase = await createClient()

  const { data: tenants, error } = await supabase
    .from("visible_tenants")
    .select("*, property:properties(id, name, address)")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching tenants:", error)
  }

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tenants</h1>
          <p className="text-muted-foreground">Manage your tenant roster</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/tenants/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Tenant
          </Link>
        </Button>
      </div>

      {!tenants || tenants.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No tenants yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add your first tenant to start managing your rentals
            </p>
            <Button asChild>
              <Link href="/dashboard/tenants/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Tenant
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tenants.map((tenant: Tenant) => (
            <Link key={tenant.id} href={`/dashboard/tenants/${tenant.id}`}>
              <Card className="h-full transition-colors hover:bg-accent/50 cursor-pointer">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">
                        {tenant.first_name} {tenant.last_name} {tenant.is_demo && <Badge variant="outline">Test/demo</Badge>}
                      </h3>
                      <Badge
                        variant="outline"
                        className={statusColors[tenant.status as keyof typeof statusColors]}
                      >
                        {tenant.status}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(tenant.rent_amount)}</p>
                      <p className="text-xs text-muted-foreground">per month</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <span className="truncate">{tenant.email}</span>
                    </div>
                    {tenant.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        <span>{tenant.phone}</span>
                      </div>
                    )}
                    {tenant.property && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                        <span className="truncate">{tenant.property.name}</span>
                      </div>
                    )}
                    {tenant.lease_end && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>Lease ends {formatDate(tenant.lease_end)}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
