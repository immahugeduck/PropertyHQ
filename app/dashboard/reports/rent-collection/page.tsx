import { summarizePayments } from "@/lib/financial-summary"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ReportFilters } from "@/components/reports/report-filters"
import { getDateRange } from "@/lib/reports"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table"

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString() : "—"

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    overdue: "bg-red-500/10 text-red-600 border-red-500/20",
    partial: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  }
  return (
    <Badge className={map[s] ?? "bg-muted text-muted-foreground"}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </Badge>
  )
}

export default async function RentCollectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const params = await searchParams
  const preset = params.preset || "this-year"
  const propertyId = params.property || "all"
  const tenantId = params.tenant || "all"

  const { from, to } = preset === "custom"
    ? { from: params.from || new Date().toISOString().slice(0, 10), to: params.to || new Date().toISOString().slice(0, 10) }
    : getDateRange(preset)

  const [{ data: properties }, { data: tenants }, { data: rawPayments }] = await Promise.all([
    supabase.from("properties").select("id, name").eq("user_id", user.id).order("name"),
    supabase.from("visible_tenants").select("id, first_name, last_name").eq("user_id", user.id).order("last_name"),
    supabase
      .from("payment_balances")
      .select("id, amount, amount_paid, balance_due, due_date, paid_date, status, payment_method, property_id, tenant_id, tenants(first_name, last_name), properties(name)")
      .eq("user_id", user.id)
      .gte("due_date", from)
      .lte("due_date", to)
      .order("due_date", { ascending: false }),
  ])

  const payments = rawPayments?.filter((p) => {
    if (propertyId !== "all" && p.property_id !== propertyId) return false
    if (tenantId !== "all" && p.tenant_id !== tenantId) return false
    return true
  }) ?? []

  const totals = summarizePayments(payments)
  const totalCharged = totals.charged
  const totalPaid = totals.collected
  const totalPending = totals.pending
  const totalOverdue = totals.overdue
  const collectionRate = totalCharged > 0 ? ((totalPaid / totalCharged) * 100).toFixed(1) : "0.0"

  const csvData = payments.map((p) => ({
    "Due Date": fmtDate(p.due_date),
    "Paid Date": fmtDate(p.paid_date),
    Tenant: p.tenants ? `${(p.tenants as unknown as { first_name: string; last_name: string }).first_name} ${(p.tenants as unknown as { first_name: string; last_name: string }).last_name}` : "",
    Property: (p.properties as unknown as { name: string } | null)?.name ?? "",
    Amount: Number(p.amount),
    Status: p.status,
    Method: p.payment_method ?? "",
  }))

  return (
    <div className="space-y-6">
      <div className="hidden print:flex items-center justify-between border-b pb-4 mb-6">
        <h1 className="text-xl font-bold">Rent Collection Report</h1>
        <p className="text-sm text-gray-500">Generated {new Date().toLocaleDateString()}</p>
      </div>

      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Rent Collection</h1>
        <p className="text-sm text-muted-foreground">{from} to {to}</p>
      </div>

      <ReportFilters
        properties={properties ?? []}
        tenants={tenants ?? []}
        showProperty
        showTenant
        csvData={csvData}
        csvFilename={`rent-collection-${from}-${to}`}
        title="Rent Collection"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Charged", value: fmt(totalCharged), color: "text-foreground" },
          { label: "Collected", value: fmt(totalPaid), color: "text-emerald-600" },
          { label: "Pending", value: fmt(totalPending), color: "text-amber-600" },
          { label: "Overdue", value: fmt(totalOverdue), color: "text-red-600" },
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

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Collection rate: <strong className="text-foreground">{collectionRate}%</strong></span>
        <span>{payments.length} invoice{payments.length !== 1 ? "s" : ""}</span>
      </div>

      <Card className="print:border print:shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payment Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Due Date</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Property</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid Date</TableHead>
                <TableHead>Method</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{fmtDate(p.due_date)}</TableCell>
                  <TableCell className="font-medium">
                    {p.tenants
                      ? `${(p.tenants as unknown as { first_name: string; last_name: string }).first_name} ${(p.tenants as unknown as { first_name: string; last_name: string }).last_name}`
                      : "—"}
                  </TableCell>
                  <TableCell>{(p.properties as unknown as { name: string } | null)?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(p.amount))}</TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell>{fmtDate(p.paid_date)}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">
                    {p.payment_method ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No payments found for this period
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {payments.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold">{fmt(totalCharged)}</TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
