import { summarizePayments } from "@/lib/financial-summary"
import { createClient } from "@/lib/supabase/server"
import type { RentPayment, Tenant } from "@/lib/types"

type RecentPayment = Pick<RentPayment, "id" | "amount" | "status" | "due_date"> & {
  tenant: Pick<Tenant, "first_name" | "last_name"> | null
}
import { StatsCard } from "@/components/dashboard/stats-card"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Building2,
  Users,
  DollarSign,
  Wrench,
  AlertTriangle,
  CheckCircle,
  Clock,
} from "lucide-react"
import Link from "next/link"

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch dashboard stats
  const [
    propertiesResult,
    tenantsResult,
    paymentsResult,
    maintenanceResult,
    maintenanceStatusResult,
    expensesResult,
    settingsResult,
  ] = await Promise.all([
    supabase.from("properties").select("id, status, monthly_rent"),
    supabase.from("tenants").select("id, status, is_demo"),
    supabase.from("payment_balances").select("id, amount, amount_paid, balance_due, status, due_date"),
    supabase.from("maintenance_requests").select("id, status, urgency, title, property_id, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("maintenance_requests").select("status"),
    supabase.from("expenses").select("amount"),
    supabase.from("payment_settings").select("hide_demo_data").eq("user_id",user?.id ?? "").maybeSingle(),
  ])

  const properties = propertiesResult.data || []
  if ([propertiesResult, tenantsResult, paymentsResult, expensesResult, settingsResult].some(r => r.error)) throw new Error("Unable to load dashboard totals. Please retry.")
  const tenants = (tenantsResult.data || []).filter(t => !settingsResult.data?.hide_demo_data || !t.is_demo)
  const payments = paymentsResult.data || []
  const recentMaintenance = maintenanceResult.data || []
  const allMaintenance = maintenanceStatusResult.data || []

  // Calculate stats
  const totalProperties = properties.length
  const occupiedProperties = properties.filter(p => p.status === "occupied").length
  const vacantProperties = properties.filter(p => p.status === "vacant").length
  const totalTenants = tenants.filter(t => t.status === "active").length
  const monthlyRevenue = properties
    .filter(p => p.status === "occupied")
    .reduce((sum, p) => sum + (p.monthly_rent || 0), 0)
  const totals = summarizePayments(payments)
  const overduePayments = totals.overdueCount
  const totalExpenses = (expensesResult.data || []).reduce((sum,e) => sum + Number(e.amount),0)
  const openMaintenanceRequests = allMaintenance.filter(m => m.status === "open" || m.status === "in_progress").length

  // Get recent payments
  const { data: recentPayments } = await supabase
    .from("payment_balances")
    .select("id, amount, status, due_date, tenant:tenants(first_name, last_name)")
    .order("due_date", { ascending: false })
    .limit(5)

  const occupancyRate = totalProperties > 0 
    ? Math.round((occupiedProperties / totalProperties) * 100) 
    : 0

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your property portfolio · <Link className="text-primary underline" href="/dashboard/reports/data-quality">Check data consistency</Link>
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Properties"
          value={totalProperties}
          description={`${occupancyRate}% occupancy rate`}
          icon={Building2}
        />
        <StatsCard
          title="Active Tenants"
          value={totalTenants}
          description={`${vacantProperties} vacant units`}
          icon={Users}
        />
        <StatsCard
          title="Expected Monthly Rent"
          value={formatCurrency(monthlyRevenue)}
          description="Expected from occupied units"
          icon={DollarSign}
        />
        <StatsCard
          title="Open Requests"
          value={openMaintenanceRequests}
          description={`${overduePayments} overdue payments`}
          icon={Wrench}
        />
      </div>

      <p className="text-sm text-muted-foreground">Rent totals below are all time, matching Payments. Filter reports to the same dates when comparing. Expected rent above is a forecast.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Rent Collected" value={formatCurrency(totals.collected)} description="All time · recorded receipts" icon={DollarSign} />
        <StatsCard title="Pending Rent" value={formatCurrency(totals.pending)} description={`${totals.pendingCount} unpaid payments within grace period`} icon={Clock} />
        <StatsCard title="Overdue Rent" value={formatCurrency(totals.overdue)} description={`${totals.overdueCount} overdue payments`} icon={AlertTriangle} />
        <StatsCard title="Expenses" value={formatCurrency(totalExpenses)} description="All time · recorded expenses" icon={DollarSign} />
      </div>
      {/* Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Maintenance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <Link href="/dashboard/maintenance" className="hover:underline">
                Recent Maintenance
              </Link>
              <Link
                href="/dashboard/maintenance"
                className="text-sm font-normal text-primary hover:underline"
              >
                View all
              </Link>
            </CardTitle>
            <CardDescription>Latest maintenance requests</CardDescription>
          </CardHeader>
          <CardContent>
            {recentMaintenance.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No maintenance requests yet
              </p>
            ) : (
              <div className="space-y-4">
                {recentMaintenance.map((request) => (
                  <Link
                    key={request.id}
                    href={`/dashboard/maintenance/${request.id}`}
                    className="flex items-start justify-between gap-4 -mx-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start gap-3">
                      {request.urgency === "emergency" ? (
                        <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                      ) : request.status === "completed" ? (
                        <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                      ) : (
                        <Clock className="h-5 w-5 text-yellow-500 mt-0.5" />
                      )}
                      <div>
                        <p className="text-sm font-medium">{request.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(request.created_at)}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        request.urgency === "emergency"
                          ? "destructive"
                          : request.urgency === "high"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {request.urgency}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Payments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Payments</span>
              <Link 
                href="/dashboard/payments" 
                className="text-sm font-normal text-primary hover:underline"
              >
                View all
              </Link>
            </CardTitle>
            <CardDescription>Latest rent payment activity</CardDescription>
          </CardHeader>
          <CardContent>
            {!recentPayments || recentPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No payments recorded yet
              </p>
            ) : (
              <div className="space-y-4">
                {(recentPayments as unknown as RecentPayment[]).map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between gap-4"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {payment.tenant?.first_name} {payment.tenant?.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Due {formatDate(payment.due_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {formatCurrency(payment.amount)}
                      </p>
                      <Badge
                        variant={
                          payment.status === "paid"
                            ? "default"
                            : payment.status === "overdue"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {payment.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common tasks to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/dashboard/properties/new"
              className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent"
            >
              <Building2 className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium">Add Property</p>
                <p className="text-xs text-muted-foreground">
                  Create a new listing
                </p>
              </div>
            </Link>
            <Link
              href="/dashboard/tenants/new"
              className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent"
            >
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium">Add Tenant</p>
                <p className="text-xs text-muted-foreground">
                  Register a new tenant
                </p>
              </div>
            </Link>
            <Link
              href="/dashboard/maintenance/new"
              className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent"
            >
              <Wrench className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium">New Request</p>
                <p className="text-xs text-muted-foreground">
                  Log maintenance issue
                </p>
              </div>
            </Link>
            <Link
              href="/dashboard/payments/record"
              className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-accent"
            >
              <DollarSign className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium">Record Payment</p>
                <p className="text-xs text-muted-foreground">
                  Log rent payment
                </p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
