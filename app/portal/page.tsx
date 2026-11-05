import Link from "next/link"
import { getCurrentTenant } from "@/lib/tenant-auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CreditCard, MessageSquare, Wrench, Building2, CalendarClock, ArrowRight, AlertTriangle } from "lucide-react"
import type { RentPayment } from "@/lib/types"

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function currency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n)
}
function formatDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const statusColors: Record<string, string> = {
  paid: "bg-green-500/10 text-green-600 border-green-500/20",
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  overdue: "bg-red-500/10 text-red-600 border-red-500/20",
  partial: "bg-orange-500/10 text-orange-600 border-orange-500/20",
}

export default async function PortalOverviewPage() {
  const tenant = await getCurrentTenant()
  if (!tenant) return null

  const supabase = await createClient()

  const { data: payments } = await supabase
    .from("payment_balances")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("due_date", { ascending: false })
    .limit(50)

  const all = (payments || []) as RentPayment[]
  const outstanding = all.filter((p) => p.status === "pending" || p.status === "overdue" || p.status === "partial")
  const balance = outstanding.reduce((sum, p) => sum + Number(p.balance_due ?? p.amount ?? 0), 0)
  const nextDue = [...outstanding].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0]

  const { count: unreadMessages } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("sender_role", "manager")
    .eq("is_read", false)

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <div>
        <h1 className="text-2xl font-bold text-foreground text-balance">
          Welcome back, {tenant.first_name}
        </h1>
        {tenant.property && (
          <p className="text-muted-foreground flex items-center gap-1 mt-1">
            <Building2 className="h-4 w-4" />
            {tenant.property.name}
          </p>
        )}
      </div>

      {/* Balance / next invoice */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardDescription>Current balance</CardDescription>
            <CardTitle className="text-3xl">{currency(balance)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {nextDue ? (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarClock className="h-4 w-4" />
                  Next invoice {currency(Number(nextDue.amount))} due {formatDate(nextDue.due_date)}
                </div>
                <Button asChild size="sm">
                  <Link href="/portal/payments">
                    Pay rent
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">You&apos;re all caught up. No outstanding invoices.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Monthly rent</CardDescription>
            <CardTitle className="text-3xl">{currency(Number(tenant.rent_amount || 0))}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Lease ends {formatDate(tenant.lease_end)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Lease expiration warning */}
      {(() => {
        const days = daysUntil(tenant.lease_end)
        if (days === null || days > 60) return null
        const urgent = days <= 30
        return (
          <Card className={urgent ? "border-red-500/50 bg-red-500/5" : "border-amber-500/50 bg-amber-500/5"}>
            <CardContent className="flex items-center gap-3 py-4">
              <AlertTriangle className={`h-5 w-5 shrink-0 ${urgent ? "text-red-500" : "text-amber-500"}`} />
              <p className={`text-sm font-medium ${urgent ? "text-red-600" : "text-amber-600"}`}>
                {days <= 0
                  ? "Your lease has expired. Please contact your property manager."
                  : `Your lease expires in ${days} day${days === 1 ? "" : "s"} — contact your manager to discuss renewal.`}
              </p>
            </CardContent>
          </Card>
        )
      })()}

      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/portal/payments">
          <Card className="transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="rounded-lg bg-primary/10 p-2">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Payments</p>
                <p className="text-sm text-muted-foreground">View invoices & receipts</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/portal/messages">
          <Card className="transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="rounded-lg bg-primary/10 p-2">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium flex items-center gap-2">
                  Messages
                  {unreadMessages ? (
                    <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
                      {unreadMessages}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">Chat with your manager</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/portal/maintenance">
          <Card className="transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="rounded-lg bg-primary/10 p-2">
                <Wrench className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Maintenance</p>
                <p className="text-sm text-muted-foreground">Submit a work order</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Recent invoices</span>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/payments">View all</Link>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {all.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="space-y-3">
              {all.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="font-medium">{currency(Number(p.amount))}</p>
                    <p className="text-sm text-muted-foreground">Due {formatDate(p.due_date)}</p>
                  </div>
                  <Badge variant="outline" className={statusColors[p.status]}>
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
