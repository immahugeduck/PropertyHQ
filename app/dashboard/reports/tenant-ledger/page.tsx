import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ReportFilters } from "@/components/reports/report-filters"
import { getDateRange } from "@/lib/reports"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table"

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—")

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

export default async function TenantLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const params = await searchParams
  const preset = params.preset || "this-year"
  const tenantId = params.tenant || "all"

  const { from, to } = preset === "custom"
    ? { from: params.from || new Date().toISOString().slice(0, 10), to: params.to || new Date().toISOString().slice(0, 10) }
    : getDateRange(preset)

  const [{ data: tenants }, { data: selectedTenant }, { data: rawPayments }] = await Promise.all([
    supabase.from("visible_tenants").select("id, first_name, last_name").eq("user_id", user.id).order("last_name"),
    tenantId !== "all"
      ? supabase
          .from("visible_tenants")
          .select("id, first_name, last_name, email, lease_start, lease_end, rent_amount, security_deposit, status, properties(name, address)")
          .eq("id", tenantId)
          .single()
      : Promise.resolve({ data: null }),
    tenantId !== "all"
      ? supabase
          .from("payment_balances")
          .select("id, amount, amount_paid, balance_due, due_date, paid_date, status, payment_method, receipt_number")
          .eq("user_id", user.id)
          .eq("tenant_id", tenantId)
          .gte("due_date", from)
          .lte("due_date", to)
          .order("due_date", { ascending: true })
      : supabase
          .from("payment_balances")
          .select("id, amount, amount_paid, balance_due, due_date, paid_date, status, payment_method, receipt_number, tenant_id, tenants(first_name, last_name)")
          .eq("user_id", user.id)
          .gte("due_date", from)
          .lte("due_date", to)
          .order("due_date", { ascending: true }),
  ])

  const payments = rawPayments ?? []

  const totalCharged = payments.reduce((s, p) => s + Number(p.amount), 0)
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount_paid), 0)
  const balance = totalCharged - totalPaid

  // Running balance for ledger
  let running = 0
  const ledgerRows = payments.map((p) => {
    const charge = Number(p.amount)
    const credit = Number(p.amount_paid)
    running = running + charge - credit
    return { ...p, charge, credit, running }
  })

  const csvData = ledgerRows.map((r) => ({
    "Due Date": fmtDate(r.due_date),
    "Paid Date": fmtDate(r.paid_date),
    Status: r.status,
    Charges: r.charge,
    Credits: r.credit,
    Balance: r.running,
    "Receipt #": r.receipt_number ?? "",
    Method: r.payment_method ?? "",
  }))

  return (
    <div className="space-y-6">
      <div className="hidden print:flex items-center justify-between border-b pb-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Tenant Ledger</h1>
          {selectedTenant && (
            <p className="text-sm text-gray-600">
              {selectedTenant.first_name} {selectedTenant.last_name}
            </p>
          )}
        </div>
        <p className="text-sm text-gray-500">Generated {new Date().toLocaleDateString()}</p>
      </div>

      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Tenant Ledger</h1>
        <p className="text-sm text-muted-foreground">{from} to {to}</p>
      </div>

      <ReportFilters
        tenants={tenants ?? []}
        showTenant
        csvData={csvData}
        csvFilename={`tenant-ledger-${tenantId}-${from}-${to}`}
        title="Tenant Ledger"
      />

      {selectedTenant && (
        <Card className="print:border print:shadow-none">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">Tenant</p>
                <p className="font-medium">{selectedTenant.first_name} {selectedTenant.last_name}</p>
                <p className="text-muted-foreground">{selectedTenant.email}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">Property</p>
                <p className="font-medium">{(selectedTenant.properties as unknown as { name: string; address: string } | null)?.name ?? "—"}</p>
                <p className="text-muted-foreground">{(selectedTenant.properties as unknown as { name: string; address: string } | null)?.address}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">Lease</p>
                <p className="font-medium">{fmtDate(selectedTenant.lease_start)} – {fmtDate(selectedTenant.lease_end)}</p>
                <p className="text-muted-foreground">Monthly rent: {fmt(Number(selectedTenant.rent_amount))}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">Status</p>
                <p className="font-medium capitalize">{selectedTenant.status}</p>
                <p className="text-muted-foreground">Deposit: {fmt(Number(selectedTenant.security_deposit))}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Charged", value: fmt(totalCharged), color: "text-foreground" },
          { label: "Total Paid", value: fmt(totalPaid), color: "text-emerald-600" },
          { label: "Balance Due", value: fmt(balance), color: balance > 0 ? "text-red-600" : "text-emerald-600" },
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

      <Card className="print:border print:shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Account Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Due Date</TableHead>
                {tenantId === "all" && <TableHead>Tenant</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDate(r.due_date)}</TableCell>
                  {tenantId === "all" && (
                    <TableCell className="font-medium">
                      {(r as unknown as { tenants?: { first_name: string; last_name: string } }).tenants
                        ? `${(r as unknown as { tenants: { first_name: string; last_name: string } }).tenants.first_name} ${(r as unknown as { tenants: { first_name: string; last_name: string } }).tenants.last_name}`
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-right">{fmt(r.charge)}</TableCell>
                  <TableCell className="text-right text-emerald-600">
                    {r.credit > 0 ? fmt(r.credit) : "—"}
                  </TableCell>
                  <TableCell className={`text-right font-medium ${r.running > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {fmt(r.running)}
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">{r.payment_method ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.receipt_number ?? "—"}</TableCell>
                </TableRow>
              ))}
              {ledgerRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    {tenantId === "all" ? "Select a tenant or view all activity above" : "No activity for this period"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {ledgerRows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={tenantId === "all" ? 3 : 2} className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold">{fmt(totalCharged)}</TableCell>
                  <TableCell className="text-right font-bold text-emerald-600">{fmt(totalPaid)}</TableCell>
                  <TableCell className={`text-right font-bold ${balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {fmt(balance)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
