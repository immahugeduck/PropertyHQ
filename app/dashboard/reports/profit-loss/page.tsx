import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ReportFilters } from "@/components/reports/report-filters"
import { getDateRange } from "@/lib/reports"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)

const EXPENSE_CATEGORIES = [
  "repairs", "utilities", "insurance", "taxes", "management",
  "supplies", "landscaping", "cleaning", "other",
]

const categoryLabel = (c: string) =>
  c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ")

export default async function ProfitLossPage({
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

  const { from, to } = preset === "custom"
    ? { from: params.from || new Date().toISOString().slice(0, 10), to: params.to || new Date().toISOString().slice(0, 10) }
    : getDateRange(preset)

  const [{ data: properties }, { data: payments }, { data: expenses }] = await Promise.all([
    supabase.from("properties").select("id, name").eq("user_id", user.id).order("name"),
    supabase
      .from("payment_balances")
      .select("id, amount, amount_paid, paid_date, property_id, tenant_id, tenants(first_name, last_name), properties(name)")
      .eq("user_id", user.id)
      .gt("amount_paid", 0)
      .gte("paid_date", from)
      .lte("paid_date", to)
      .then((r) => ({
        data: propertyId === "all" ? r.data : r.data?.filter((p) => p.property_id === propertyId),
      })),
    supabase
      .from("expenses")
      .select("id, amount, date, category, description, property_id, properties(name)")
      .eq("user_id", user.id)
      .gte("date", from)
      .lte("date", to)
      .then((r) => ({
        data: propertyId === "all" ? r.data : r.data?.filter((e) => e.property_id === propertyId),
      })),
  ])

  const totalIncome = payments?.reduce((s, p) => s + Number(p.amount_paid), 0) ?? 0
  const totalExpenses = expenses?.reduce((s, e) => s + Number(e.amount), 0) ?? 0
  const netIncome = totalIncome - totalExpenses
  const margin = totalIncome > 0 ? ((netIncome / totalIncome) * 100).toFixed(1) : "0.0"

  // Expenses by category
  const byCategory: Record<string, number> = {}
  expenses?.forEach((e) => {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + Number(e.amount)
  })

  // By property
  const byProperty: Record<string, { name: string; income: number; expenses: number }> = {}
  properties?.forEach((p) => {
    byProperty[p.id] = { name: p.name, income: 0, expenses: 0 }
  })
  payments?.forEach((p) => {
    if (p.property_id && byProperty[p.property_id]) {
      byProperty[p.property_id].income += Number(p.amount_paid)
    }
  })
  expenses?.forEach((e) => {
    if (e.property_id && byProperty[e.property_id]) {
      byProperty[e.property_id].expenses += Number(e.amount)
    }
  })

  // Monthly breakdown
  const monthMap: Record<string, { income: number; expenses: number }> = {}
  payments?.forEach((p) => {
    if (!p.paid_date) return
    const key = p.paid_date.slice(0, 7)
    if (!monthMap[key]) monthMap[key] = { income: 0, expenses: 0 }
    monthMap[key].income += Number(p.amount_paid)
  })
  expenses?.forEach((e) => {
    const key = e.date.slice(0, 7)
    if (!monthMap[key]) monthMap[key] = { income: 0, expenses: 0 }
    monthMap[key].expenses += Number(e.amount)
  })
  const months = Object.keys(monthMap).sort()

  // CSV data
  const csvData = [
    { Section: "INCOME", Item: "Rental Income", Amount: totalIncome },
    { Section: "INCOME", Item: "Total Income", Amount: totalIncome },
    ...EXPENSE_CATEGORIES.filter((c) => byCategory[c]).map((c) => ({
      Section: "EXPENSES",
      Item: categoryLabel(c),
      Amount: byCategory[c],
    })),
    { Section: "EXPENSES", Item: "Total Expenses", Amount: totalExpenses },
    { Section: "SUMMARY", Item: "Net Operating Income", Amount: netIncome },
  ]

  const periodLabel = preset === "custom"
    ? `${from} to ${to}`
    : { "this-year": `Year ${from.slice(0, 4)}`, "last-year": `Year ${to.slice(0, 4)}`, "this-month": new Date(from).toLocaleString("default", { month: "long", year: "numeric" }), "last-month": new Date(from).toLocaleString("default", { month: "long", year: "numeric" }), "this-quarter": `Q${Math.floor(new Date(from).getMonth() / 3) + 1} ${from.slice(0, 4)}`, "last-quarter": `Q${Math.floor(new Date(from).getMonth() / 3) + 1} ${from.slice(0, 4)}` }[preset] ?? preset

  return (
    <div className="space-y-6">
      {/* Print header */}
      <div className="hidden print:flex items-center justify-between border-b pb-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Profit & Loss</h1>
          <p className="text-sm text-gray-600">{periodLabel}</p>
        </div>
        <p className="text-sm text-gray-500">Generated {new Date().toLocaleDateString()}</p>
      </div>

      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profit & Loss</h1>
          <p className="text-sm text-muted-foreground">{periodLabel}</p>
        </div>
      </div>

      <ReportFilters
        properties={properties ?? []}
        showProperty
        csvData={csvData}
        csvFilename={`profit-loss-${from}-${to}`}
        title="Profit & Loss"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Income", value: fmt(totalIncome), color: "text-emerald-600" },
          { label: "Total Expenses", value: fmt(totalExpenses), color: "text-red-600" },
          { label: "Net Income", value: fmt(netIncome), color: netIncome >= 0 ? "text-emerald-600" : "text-red-600" },
          { label: "Profit Margin", value: `${margin}%`, color: Number(margin) >= 0 ? "text-emerald-600" : "text-red-600" },
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

      {/* P&L Statement */}
      <Card className="print:border print:shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Income & Expense Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Item</TableHead>
                <TableHead className="text-right font-semibold">Amount</TableHead>
                <TableHead className="text-right font-semibold w-24">% of Income</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Income */}
              <TableRow className="bg-muted/30">
                <TableCell colSpan={3} className="py-1.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Income
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-6">Rental Income</TableCell>
                <TableCell className="text-right text-emerald-600">{fmt(totalIncome)}</TableCell>
                <TableCell className="text-right text-muted-foreground">100.0%</TableCell>
              </TableRow>
              <TableRow className="font-semibold border-t-2">
                <TableCell>Total Income</TableCell>
                <TableCell className="text-right text-emerald-600">{fmt(totalIncome)}</TableCell>
                <TableCell className="text-right">100.0%</TableCell>
              </TableRow>

              {/* Expenses */}
              <TableRow className="bg-muted/30">
                <TableCell colSpan={3} className="py-1.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                  Operating Expenses
                </TableCell>
              </TableRow>
              {EXPENSE_CATEGORIES.filter((c) => byCategory[c] > 0).map((c) => (
                <TableRow key={c}>
                  <TableCell className="pl-6">{categoryLabel(c)}</TableCell>
                  <TableCell className="text-right text-red-600">{fmt(byCategory[c])}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {totalIncome > 0 ? ((byCategory[c] / totalIncome) * 100).toFixed(1) : "—"}%
                  </TableCell>
                </TableRow>
              ))}
              {totalExpenses === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="pl-6 text-muted-foreground text-sm">No expenses recorded</TableCell>
                </TableRow>
              )}
              <TableRow className="font-semibold border-t-2">
                <TableCell>Total Expenses</TableCell>
                <TableCell className="text-right text-red-600">{fmt(totalExpenses)}</TableCell>
                <TableCell className="text-right">
                  {totalIncome > 0 ? ((totalExpenses / totalIncome) * 100).toFixed(1) : "—"}%
                </TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow className="text-base">
                <TableCell className="font-bold">Net Operating Income</TableCell>
                <TableCell className={`text-right font-bold ${netIncome >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmt(netIncome)}
                </TableCell>
                <TableCell className={`text-right font-bold ${netIncome >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {margin}%
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {/* By Property */}
      {Object.keys(byProperty).length > 1 && (
        <Card className="print:border print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By Property</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead className="text-right">Income</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(byProperty).map(([id, d]) => (
                  <TableRow key={id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-right text-emerald-600">{fmt(d.income)}</TableCell>
                    <TableCell className="text-right text-red-600">{fmt(d.expenses)}</TableCell>
                    <TableCell className={`text-right font-medium ${d.income - d.expenses >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmt(d.income - d.expenses)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold text-emerald-600">{fmt(totalIncome)}</TableCell>
                  <TableCell className="text-right font-bold text-red-600">{fmt(totalExpenses)}</TableCell>
                  <TableCell className={`text-right font-bold ${netIncome >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmt(netIncome)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Monthly Breakdown */}
      {months.length > 1 && (
        <Card className="print:border print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Monthly Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Income</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => {
                  const d = monthMap[m]
                  const net = d.income - d.expenses
                  return (
                    <TableRow key={m}>
                      <TableCell>{new Date(m + "-01").toLocaleString("default", { month: "long", year: "numeric" })}</TableCell>
                      <TableCell className="text-right text-emerald-600">{fmt(d.income)}</TableCell>
                      <TableCell className="text-right text-red-600">{fmt(d.expenses)}</TableCell>
                      <TableCell className={`text-right font-medium ${net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmt(net)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold text-emerald-600">{fmt(totalIncome)}</TableCell>
                  <TableCell className="text-right font-bold text-red-600">{fmt(totalExpenses)}</TableCell>
                  <TableCell className={`text-right font-bold ${netIncome >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmt(netIncome)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
