import { redirect } from "next/navigation"
import { Suspense } from "react"
import { getCurrentTenant } from "@/lib/tenant-auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PayRentButton } from "@/components/portal/pay-rent-button"
import { PaymentReturnHandler } from "@/components/portal/payment-return-handler"
import { CreditCard, Download, CheckCircle, Clock, AlertCircle, DollarSign } from "lucide-react"

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(amount)
}

function formatDate(dateString: string | null) {
  if (!dateString) return "—"
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function period(dueDate: string) {
  return new Date(dueDate).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

const statusConfig: Record<string, { label: string; className: string; icon: typeof CheckCircle }> = {
  paid: { label: "Paid", className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", icon: CheckCircle },
  pending: { label: "Due", className: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10", icon: Clock },
  overdue: { label: "Overdue", className: "border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/10", icon: AlertCircle },
  partial: { label: "Partial", className: "border-orange-500/30 text-orange-600 dark:text-orange-400 bg-orange-500/10", icon: DollarSign },
}

export default async function PortalPaymentsPage() {
  const tenant = await getCurrentTenant()
  if (!tenant) redirect("/portal")

  const supabase = await createClient()
  const { data: payments } = await supabase
    .from("payment_balances")
    .select("*, property:properties(name)")
    .eq("tenant_id", tenant.id)
    .order("due_date", { ascending: false })

  const all = payments || []
  const outstanding = all.filter((p) => p.status === "pending" || p.status === "overdue")
  const totalDue = outstanding.reduce((s, p) => s + Number(p.balance_due ?? p.amount ?? 0), 0)
  const totalPaid = all.reduce((s, p) => s + Number(p.amount_paid ?? 0), 0)

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <PaymentReturnHandler />
      </Suspense>
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payments</h1>
        <p className="text-muted-foreground">View your invoices, pay rent, and download receipts</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Balance</p>
                <p className="text-2xl font-bold">{formatCurrency(totalDue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="text-2xl font-bold">{formatCurrency(totalPaid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {all.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No invoices yet</h3>
            <p className="text-muted-foreground">Your rent invoices will appear here when issued.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {all.map((p) => {
            const cfg = statusConfig[p.status] || statusConfig.pending
            const StatusIcon = cfg.icon
            return (
              <Card key={p.id} className="transition-colors hover:bg-accent/40">
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className={`p-2 rounded-lg ${cfg.className}`}>
                        <StatusIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-lg">{formatCurrency(Number(p.amount))}</p>
                          <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Rent — {period(p.due_date)} · {p.property?.name || "Your property"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.status === "paid" ? `Paid ${formatDate(p.paid_date)}` : `Due ${formatDate(p.due_date)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {p.status === "paid" ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/api/receipts/${p.id}`} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-1.5 h-4 w-4" />
                            Receipt
                          </a>
                        </Button>
                      ) : (
                        <PayRentButton invoiceId={p.id} size="sm" />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Payments are processed securely by Stripe. A PDF receipt is generated automatically once your payment clears.
      </p>
    </div>
  )
}
