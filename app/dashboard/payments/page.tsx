import { summarizePayments } from "@/lib/financial-summary"
import { DeletePaymentButton } from "@/components/payments/delete-payment-button"
import { createClient } from "@/lib/supabase/server"
import type { RentPayment } from "@/lib/types"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, CreditCard, DollarSign, User, Building2, AlertCircle, CheckCircle, RefreshCw } from "lucide-react"

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
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
  paid: "bg-green-500/10 text-green-500 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  overdue: "bg-red-500/10 text-red-500 border-red-500/20",
  partial: "bg-orange-500/10 text-orange-500 border-orange-500/20",
}

export default async function PaymentsPage() {
  const supabase = await createClient()

  const { data: payments, error } = await supabase
    .from("payment_balances")
    .select("*, tenant:tenants(id, first_name, last_name), property:properties(id, name)")
    .order("due_date", { ascending: false })

  if (error) {
    console.error("Error fetching payments:", error)
  }

  if (error) throw new Error("Unable to load payments. Please retry.")
  const totals = summarizePayments(payments || [])
  const totalCollected = totals.collected
  const totalPending = totals.pending
  const totalOverdue = totals.overdue

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payments</h1>
          <p className="text-muted-foreground">All-time rent payments · overdue includes unpaid balances after the grace period</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/payments/generate">
              <RefreshCw className="mr-2 h-4 w-4" />
              Generate Rent
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/payments/record">
              <Plus className="mr-2 h-4 w-4" />
              Record Payment
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Collected</p>
                <p className="text-2xl font-bold">{formatCurrency(totalCollected)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <DollarSign className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{formatCurrency(totalPending)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue</p>
                <p className="text-2xl font-bold">{formatCurrency(totalOverdue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {!payments || payments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No payments recorded</h3>
            <p className="text-muted-foreground text-center mb-4">
              Record your first rent payment to start tracking
            </p>
            <Button asChild>
              <Link href="/dashboard/payments/record">
                <Plus className="mr-2 h-4 w-4" />
                Record Payment
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {payments.map((payment: RentPayment) => (
            <Card key={payment.id} className="transition-colors hover:bg-accent/50">
              <CardContent className="pt-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${statusColors[payment.status as keyof typeof statusColors]}`}>
                      <DollarSign className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-lg">{formatCurrency(payment.amount)}</p>
                        <Badge
                          variant="outline"
                          className={statusColors[payment.status as keyof typeof statusColors]}
                        >
                          {payment.status} {payment.is_demo && " · Test/demo"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                        {payment.tenant && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {payment.tenant.first_name} {payment.tenant.last_name}
                          </span>
                        )}
                        {payment.property && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {payment.property.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Due: </span>
                      {formatDate(payment.due_date)}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button asChild size="sm" variant="outline"><Link href={`/dashboard/payments/record?payment=${payment.id}`}>Edit</Link></Button>
                      <DeletePaymentButton id={payment.id} />
                    </div>
                    {payment.paid_date && (
                      <p className="text-sm text-green-500">
                        Paid: {formatDate(payment.paid_date)}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
