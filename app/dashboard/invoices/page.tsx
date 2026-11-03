import { createClient } from "@/lib/supabase/server"
import type { RentPayment } from "@/lib/types"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Plus,
  FileText,
  User,
  Building2,
  RefreshCw,
  Search,
  DollarSign,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react"

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(dateString: string | null) {
  if (!dateString) return "—"
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function invoiceNumber(id: string, createdAt: string) {
  const year = new Date(createdAt).getFullYear()
  const seq = id.replace(/-/g, "").slice(-4).toUpperCase()
  return `PHQ-${year}-${seq}`
}

const statusConfig = {
  paid: { label: "Paid", color: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5", icon: CheckCircle },
  pending: { label: "Pending", color: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5", icon: Clock },
  overdue: { label: "Overdue", color: "border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5", icon: AlertCircle },
  partial: { label: "Partial", color: "border-orange-500/30 text-orange-600 dark:text-orange-400 bg-orange-500/5", icon: DollarSign },
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: filterStatus } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from("payment_balances")
    .select("*, tenant:tenants(id, first_name, last_name, email), property:properties(id, name)")
    .order("due_date", { ascending: false })

  if (filterStatus) {
    query = query.eq("status", filterStatus)
  }

  const { data: invoices, error } = await query

  if (error) console.error("Error fetching invoices:", error)

  const allInvoices = invoices || []
  const totalPaid = allInvoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.amount || 0), 0)
  const totalPending = allInvoices.filter(i => i.status === "pending").reduce((s, i) => s + (i.amount || 0), 0)
  const totalOverdue = allInvoices.filter(i => i.status === "overdue").reduce((s, i) => s + (i.amount || 0), 0)

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
          <p className="text-muted-foreground text-sm">Manage rent invoices and recurring billing</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/invoices/new">
            <Plus className="mr-2 h-4 w-4" />
            New Invoice
          </Link>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Collected</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalPaid)}</p>
                <p className="text-xs text-muted-foreground">{allInvoices.filter(i => i.status === "paid").length} invoices</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(totalPending)}</p>
                <p className="text-xs text-muted-foreground">{allInvoices.filter(i => i.status === "pending").length} invoices</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Overdue</p>
                <p className="text-xl font-bold text-red-600 dark:text-red-400">{formatCurrency(totalOverdue)}</p>
                <p className="text-xs text-muted-foreground">{allInvoices.filter(i => i.status === "overdue").length} invoices</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { label: "All", value: "" },
          { label: "Paid", value: "paid" },
          { label: "Pending", value: "pending" },
          { label: "Overdue", value: "overdue" },
        ].map((tab) => (
          <Link key={tab.value} href={tab.value ? `/dashboard/invoices?status=${tab.value}` : "/dashboard/invoices"}>
            <Badge
              variant={filterStatus === tab.value || (!filterStatus && !tab.value) ? "default" : "outline"}
              className="cursor-pointer px-3 py-1 text-xs"
            >
              {tab.label}
            </Badge>
          </Link>
        ))}
      </div>

      {/* Invoice List */}
      {allInvoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No invoices found</h3>
            <p className="text-muted-foreground text-center text-sm mb-6 max-w-sm">
              Create your first invoice or set up recurring monthly rent billing for your tenants.
            </p>
            <Button asChild>
              <Link href="/dashboard/invoices/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Invoice
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_100px_120px_100px] gap-4 px-6 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Invoice</span>
              <span>Tenant</span>
              <span>Property</span>
              <span>Amount</span>
              <span>Due Date</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-border">
              {allInvoices.map((invoice: RentPayment) => {
                const cfg = statusConfig[invoice.status as keyof typeof statusConfig] || statusConfig.pending
                const invNum = invoiceNumber(invoice.id, invoice.created_at)
                return (
                  <Link key={invoice.id} href={`/dashboard/invoices/${invoice.id}`}>
                    <div className="grid md:grid-cols-[1fr_1fr_1fr_100px_120px_100px] gap-4 px-6 py-4 hover:bg-accent/50 transition-colors items-center cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-primary/10 rounded-md hidden sm:block">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-mono font-medium">{invNum}</p>
                          {invoice.is_recurring && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <RefreshCw className="h-3 w-3 text-primary" />
                              <span className="text-[10px] text-primary">Recurring</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm">
                          {invoice.tenant ? `${invoice.tenant.first_name} ${invoice.tenant.last_name}` : "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{invoice.property?.name || "—"}</span>
                      </div>
                      <p className="text-sm font-semibold">{formatCurrency(invoice.amount)}</p>
                      <p className="text-sm text-muted-foreground">{formatDate(invoice.due_date)}</p>
                      <Badge variant="outline" className={`text-xs w-fit ${cfg.color}`}>
                        {cfg.label}
                      </Badge>
                    </div>
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
