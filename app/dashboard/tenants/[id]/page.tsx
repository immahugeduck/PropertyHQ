import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { RentPayment, FileRecord, HouseholdMember } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  User,
  Mail,
  Phone,
  Building2,
  Calendar,
  DollarSign,
  Edit,
  ArrowLeft,
  MessageSquare,
  CreditCard,
  Users,
  ShieldAlert,
} from "lucide-react"
import { DeleteTenantButton } from "@/components/tenants/delete-tenant-button"
import { PortalAccessCard } from "@/components/tenants/portal-access-card"
import { RentScheduleCard } from "@/components/tenants/rent-schedule-card"
import { EntityFilesSection } from "@/components/files/entity-files-section"
import { LeaseDocumentsCard } from "@/components/tenants/lease-documents-card"
import { HouseholdEditor } from "@/components/household/household-editor"
import { addHouseholdMember, removeHouseholdMember } from "@/app/actions/household"

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
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

const statusColors = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  inactive: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
}

const paymentStatusColors = {
  paid: "bg-green-500/10 text-green-500",
  pending: "bg-yellow-500/10 text-yellow-500",
  overdue: "bg-red-500/10 text-red-500",
  partial: "bg-orange-500/10 text-orange-500",
}

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("*, property:properties(*)")
    .eq("id", id)
    .single()

  if (error || !tenant) {
    notFound()
  }

  // Fetch payment history
  const { data: payments } = await supabase
    .from("payment_balances")
    .select("*")
    .eq("tenant_id", id)
    .order("due_date", { ascending: false })
    .limit(10)

  // Fetch messages
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("tenant_id", id)
    .order("created_at", { ascending: false })
    .limit(5)

  // Fetch active recurring rent schedule
  const { data: schedule } = await supabase
    .from("rent_schedules")
    .select("*")
    .eq("tenant_id", id)
    .eq("active", true)
    .maybeSingle()

  // Fetch files linked to this tenant
  const { data: tenantFiles } = await supabase
    .from("files")
    .select("*, folder:file_folders(id, name)")
    .eq("tenant_id", id)
    .order("created_at", { ascending: false })

  // Everyone listed as living in the unit, current and previously listed
  const { data: household } = await supabase
    .from("household_members")
    .select("*")
    .eq("tenant_id", id)
    .order("created_at")
  const householdRows = (household as HouseholdMember[]) || []
  const currentHousehold = householdRows.filter((m) => !m.removed_at)
  const pastHousehold = householdRows
    .filter((m) => m.removed_at)
    .sort((a, b) => (b.removed_at ?? "").localeCompare(a.removed_at ?? ""))

  const totalPaid = (payments || [])
    .filter(p => p.status === "paid")
    .reduce((sum, p) => sum + (p.amount || 0), 0)

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard/tenants"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tenants
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">
                {tenant.first_name} {tenant.last_name}
              </h1>
              <Badge
                variant="outline"
                className={statusColors[tenant.status as keyof typeof statusColors]}
              >
                {tenant.status}
              </Badge>
            </div>
            {tenant.property && (
              <Link 
                href={`/dashboard/properties/${tenant.property.id}`}
                className="text-muted-foreground flex items-center gap-1 mt-1 hover:text-foreground"
              >
                <Building2 className="h-4 w-4" />
                {tenant.property.name}
              </Link>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/dashboard/tenants/${id}/edit`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <DeleteTenantButton tenantId={id} tenantName={`${tenant.first_name} ${tenant.last_name}`} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Monthly Rent</p>
                <p className="text-xl font-bold">{formatCurrency(tenant.rent_amount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="text-xl font-bold">{formatCurrency(totalPaid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Calendar className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Lease Ends</p>
                <p className="text-xl font-bold">{formatDate(tenant.lease_end)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details and Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Contact Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <a href={`mailto:${tenant.email}`} className="font-medium hover:underline">
                  {tenant.email}
                </a>
              </div>
            </div>
            {tenant.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <a href={`tel:${tenant.phone}`} className="font-medium hover:underline">
                    {tenant.phone}
                  </a>
                </div>
              </div>
            )}
            {(tenant.emergency_contact_name || tenant.emergency_contact_phone) && (
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Emergency Contact
                    {tenant.emergency_contact_relationship ? ` (${tenant.emergency_contact_relationship})` : ""}
                  </p>
                  <p className="font-medium">
                    {tenant.emergency_contact_name}
                    {tenant.emergency_contact_phone && (
                      <>
                        {tenant.emergency_contact_name ? " · " : ""}
                        <a href={`tel:${tenant.emergency_contact_phone}`} className="hover:underline">
                          {tenant.emergency_contact_phone}
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}
            <div className="pt-4 border-t border-border">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Lease Start</p>
                  <p className="font-medium">{formatDate(tenant.lease_start)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Lease End</p>
                  <p className="font-medium">{formatDate(tenant.lease_end)}</p>
                </div>
              </div>
            </div>
            <div className="pt-4 border-t border-border">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Rent</p>
                  <p className="font-medium">{formatCurrency(tenant.rent_amount)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Security Deposit</p>
                  <p className="font-medium">{formatCurrency(tenant.security_deposit)}</p>
                </div>
              </div>
            </div>
            {tenant.notes && (
              <div className="pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{tenant.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link href={`/dashboard/payments/record?tenant=${id}`}>
                <CreditCard className="mr-2 h-4 w-4" />
                Record Payment
              </Link>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link href={`/dashboard/messages/${id}/chat`}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Open Chat
              </Link>
            </Button>
            {tenant.property && (
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href={`/dashboard/maintenance/new?property=${tenant.property.id}&tenant=${id}`}>
                  <Building2 className="mr-2 h-4 w-4" />
                  Create Maintenance Request
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Household */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Household
          </CardTitle>
          <CardDescription>
            Everyone 12 and older living in the unit besides {tenant.first_name}. Management record
            only; it is not shown on maintenance jobs. Tenants can update it from their portal, and
            you&apos;re notified when they do. Removed people stay below as history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <HouseholdEditor
            members={currentHousehold}
            addAction={addHouseholdMember.bind(null, id)}
            removeAction={removeHouseholdMember.bind(null, id)}
            showAddedBy
            emptyText="No other residents listed."
          />
          {pastHousehold.length > 0 && (
            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium mb-2">Previously listed</p>
              <ul className="space-y-1.5">
                {pastHousehold.map((m) => (
                  <li key={m.id} className="text-sm">
                    <span className="text-muted-foreground line-through">{m.full_name}</span>
                    {m.relationship && <span className="text-muted-foreground"> ({m.relationship})</span>}
                    <span className="block text-xs text-muted-foreground">
                      Listed {formatDate(m.created_at)} by {m.added_by === "tenant" ? "tenant" : "you"} · removed{" "}
                      {formatDate(m.removed_at)} by {m.removed_by === "tenant" ? "tenant" : "you"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Portal Access & Recurring Rent */}
      <div className="grid gap-6 lg:grid-cols-2">
        <PortalAccessCard
          tenantId={id}
          hasEmail={Boolean(tenant.email)}
          authUserId={tenant.auth_user_id ?? null}
          invitedAt={tenant.invited_at ?? null}
          portalActivatedAt={tenant.portal_activated_at ?? null}
        />
        <RentScheduleCard
          tenantId={id}
          propertyId={tenant.property_id ?? null}
          defaultAmount={tenant.rent_amount}
          schedule={schedule ?? null}
        />
      </div>

      {/* Files & Documents */}
      <EntityFilesSection
        initialFiles={(tenantFiles as FileRecord[]) || []}
        tenantId={id}
        title="Files & Documents"
      />

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Payment History
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/payments/record?tenant=${id}`}>
                Record Payment
              </Link>
            </Button>
          </CardTitle>
          <CardDescription>Recent rent payments from this tenant</CardDescription>
        </CardHeader>
        <CardContent>
          {!payments || payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No payment history yet
            </p>
          ) : (
            <div className="space-y-3">
              {payments.map((payment: RentPayment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border"
                >
                  <div>
                    <p className="font-medium">{formatCurrency(payment.amount)}</p>
                    <p className="text-sm text-muted-foreground">
                      Due {formatDate(payment.due_date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant="outline"
                      className={paymentStatusColors[payment.status as keyof typeof paymentStatusColors]}
                    >
                      {payment.status}
                    </Badge>
                    {payment.paid_date && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Paid {formatDate(payment.paid_date)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
