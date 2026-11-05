import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ReportFilters } from "@/components/reports/report-filters"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table"

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—")

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    occupied: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    vacant: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    maintenance: "bg-red-500/10 text-red-600 border-red-500/20",
  }
  return (
    <Badge className={map[s] ?? "bg-muted text-muted-foreground"}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </Badge>
  )
}

export default async function OccupancyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const params = await searchParams
  const propertyId = params.property || "all"

  const [{ data: allProperties }, { data: tenants }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, address, city, state, property_type, bedrooms, bathrooms, monthly_rent, status")
      .eq("user_id", user.id)
      .order("name"),
    supabase
      .from("visible_tenants")
      .select("id, first_name, last_name, property_id, lease_start, lease_end, rent_amount, status")
      .eq("user_id", user.id)
      .eq("status", "active"),
  ])

  const properties = allProperties?.filter((p) =>
    propertyId === "all" || p.id === propertyId
  ) ?? []

  const totalUnits = properties.length
  const occupiedCount = properties.filter((p) => p.status === "occupied").length
  const vacantCount = properties.filter((p) => p.status === "vacant").length
  const maintenanceCount = properties.filter((p) => p.status === "maintenance").length
  const occupancyRate = totalUnits > 0 ? ((occupiedCount / totalUnits) * 100).toFixed(1) : "0.0"
  const totalMonthlyRent = properties.filter((p) => p.status === "occupied").reduce((s, p) => s + Number(p.monthly_rent), 0)
  const potentialRent = properties.reduce((s, p) => s + Number(p.monthly_rent), 0)

  // Leases expiring in next 90 days
  const today = new Date()
  const in90 = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
  const expiringLeases = tenants?.filter((t) => {
    if (!t.lease_end) return false
    const end = new Date(t.lease_end)
    return end >= today && end <= in90
  }).sort((a, b) => new Date(a.lease_end!).getTime() - new Date(b.lease_end!).getTime()) ?? []

  const tenantByProperty: Record<string, typeof tenants extends (infer T)[] | null ? T : never> = {}
  tenants?.forEach((t) => {
    if (t.property_id) tenantByProperty[t.property_id] = t
  })

  const csvData = properties.map((p) => {
    const tenant = tenantByProperty[p.id]
    return {
      Property: p.name,
      Address: `${p.address}, ${p.city}, ${p.state}`,
      Type: p.property_type,
      Status: p.status,
      Tenant: tenant ? `${(tenant as { first_name: string; last_name: string }).first_name} ${(tenant as { first_name: string; last_name: string }).last_name}` : "",
      "Lease End": tenant ? fmtDate((tenant as { lease_end: string | null }).lease_end) : "",
      "Monthly Rent": Number(p.monthly_rent),
    }
  })

  return (
    <div className="space-y-6">
      <div className="hidden print:flex items-center justify-between border-b pb-4 mb-6">
        <h1 className="text-xl font-bold">Occupancy Summary</h1>
        <p className="text-sm text-gray-500">Generated {new Date().toLocaleDateString()}</p>
      </div>

      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Occupancy Summary</h1>
        <p className="text-sm text-muted-foreground">Current snapshot — as of {today.toLocaleDateString()}</p>
      </div>

      <ReportFilters
        properties={allProperties ?? []}
        showProperty
        csvData={csvData}
        csvFilename="occupancy-summary"
        title="Occupancy Summary"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Occupancy Rate", value: `${occupancyRate}%`, color: "text-emerald-600" },
          { label: "Occupied", value: String(occupiedCount), color: "text-emerald-600" },
          { label: "Vacant", value: String(vacantCount), color: "text-amber-600" },
          { label: "In Maintenance", value: String(maintenanceCount), color: "text-red-600" },
        ].map((k) => (
          <Card key={k.label} className="print:border print:shadow-none">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span>Current revenue: <strong className="text-foreground">{fmt(totalMonthlyRent)}/mo</strong></span>
        <span>Potential (100% occupancy): <strong className="text-foreground">{fmt(potentialRent)}/mo</strong></span>
        {potentialRent > 0 && (
          <span>Vacancy loss: <strong className="text-red-600">{fmt(potentialRent - totalMonthlyRent)}/mo</strong></span>
        )}
      </div>

      <Card className="print:border print:shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Property Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current Tenant</TableHead>
                <TableHead>Lease End</TableHead>
                <TableHead className="text-right">Monthly Rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((p) => {
                const tenant = tenantByProperty[p.id]
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.city}, {p.state}</p>
                    </TableCell>
                    <TableCell className="capitalize">{p.property_type}</TableCell>
                    <TableCell>{statusBadge(p.status)}</TableCell>
                    <TableCell>
                      {tenant
                        ? `${(tenant as { first_name: string; last_name: string }).first_name} ${(tenant as { first_name: string; last_name: string }).last_name}`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {tenant ? fmtDate((tenant as { lease_end: string | null }).lease_end) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{fmt(Number(p.monthly_rent))}</TableCell>
                  </TableRow>
                )
              })}
              {properties.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No properties found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {properties.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="font-bold">{totalUnits} properties</TableCell>
                  <TableCell className="text-right font-bold">{fmt(totalMonthlyRent)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      {expiringLeases.length > 0 && (
        <Card className="border-amber-500/30 print:border print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-600">Leases Expiring Within 90 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Lease End</TableHead>
                  <TableHead>Days Remaining</TableHead>
                  <TableHead className="text-right">Monthly Rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiringLeases.map((t) => {
                  const daysLeft = Math.ceil(
                    (new Date((t as { lease_end: string }).lease_end).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
                  )
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        {(t as { first_name: string; last_name: string }).first_name} {(t as { first_name: string; last_name: string }).last_name}
                      </TableCell>
                      <TableCell>{fmtDate((t as { lease_end: string }).lease_end)}</TableCell>
                      <TableCell>
                        <Badge className={daysLeft <= 30 ? "bg-red-500/10 text-red-600 border-red-500/20" : "bg-amber-500/10 text-amber-600 border-amber-500/20"}>
                          {daysLeft} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{fmt(Number(t.rent_amount))}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
