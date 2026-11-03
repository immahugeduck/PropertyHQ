import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { Tenant, MaintenanceRequest, FileRecord } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Building2,
  MapPin,
  Bed,
  Bath,
  Square,
  DollarSign,
  Edit,
  Users,
  Wrench,
  ArrowLeft,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
} from "lucide-react"
import { DeletePropertyButton } from "@/components/properties/delete-property-button"
import { EntityFilesSection } from "@/components/files/entity-files-section"

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

const statusColors = {
  vacant: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  occupied: "bg-green-500/10 text-green-500 border-green-500/20",
  maintenance: "bg-red-500/10 text-red-500 border-red-500/20",
}

const propertyTypeLabels = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhouse: "Townhouse",
  commercial: "Commercial",
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch property details
  const { data: property, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !property) {
    notFound()
  }

  // Fetch related data in parallel
  const [tenantsResult, paymentsResult, maintenanceResult] = await Promise.all([
    supabase
      .from("tenants")
      .select("*")
      .eq("property_id", id)
      .eq("status", "active"),
    supabase
      .from("payment_balances")
      .select("*, tenant:tenants(first_name, last_name)")
      .eq("property_id", id)
      .order("due_date", { ascending: false })
      .limit(10),
    supabase
      .from("maintenance_requests")
      .select("*")
      .eq("property_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ])

  const tenants = tenantsResult.data || []
  const payments = paymentsResult.data || []
  const maintenance = maintenanceResult.data || []

  const { data: propertyFiles } = await supabase
    .from("files")
    .select("*, folder:file_folders(id, name)")
    .eq("property_id", id)
    .order("created_at", { ascending: false })

  // Calculate revenue stats
  const paidPayments = payments.filter(p => p.status === "paid")
  const totalRevenue = paidPayments.reduce((sum, p) => sum + (p.amount || 0), 0)

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard/properties"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Properties
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{property.name}</h1>
              <Badge
                variant="outline"
                className={statusColors[property.status as keyof typeof statusColors]}
              >
                {property.status}
              </Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="h-4 w-4" />
              {property.address}, {property.city}, {property.state} {property.zip_code}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/dashboard/properties/${id}/edit`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <DeletePropertyButton propertyId={id} propertyName={property.name} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Monthly Rent</p>
                <p className="text-xl font-bold">{formatCurrency(property.monthly_rent)}</p>
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
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-xl font-bold">{formatCurrency(totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Tenants</p>
                <p className="text-xl font-bold">{tenants.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Wrench className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Open Requests</p>
                <p className="text-xl font-bold">
                  {maintenance.filter(m => m.status === "open" || m.status === "in_progress").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Property Details and Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Property Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Property Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Type</p>
                <p className="font-medium">
                  {propertyTypeLabels[property.property_type as keyof typeof propertyTypeLabels]}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Added</p>
                <p className="font-medium">{formatDate(property.created_at)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Bed className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Bedrooms</p>
                  <p className="font-medium">{property.bedrooms}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Bath className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Bathrooms</p>
                  <p className="font-medium">{property.bathrooms}</p>
                </div>
              </div>
              {property.square_feet && (
                <div className="flex items-center gap-2">
                  <Square className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Sq Ft</p>
                    <p className="font-medium">{property.square_feet.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>
            {property.notes && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{property.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Current Tenants */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Current Tenants
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/tenants/new?property=${id}`}>
                  Add Tenant
                </Link>
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No active tenants
              </p>
            ) : (
              <div className="space-y-3">
                {tenants.map((tenant: Tenant) => (
                  <Link
                    key={tenant.id}
                    href={`/dashboard/tenants/${tenant.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                  >
                    <div>
                      <p className="font-medium">
                        {tenant.first_name} {tenant.last_name}
                      </p>
                      <p className="text-sm text-muted-foreground">{tenant.email}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatCurrency(tenant.rent_amount)}/mo</p>
                      {tenant.lease_end && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Lease ends {formatDate(tenant.lease_end)}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Files & Documents */}
      <EntityFilesSection
        initialFiles={(propertyFiles as FileRecord[]) || []}
        propertyId={id}
        title="Files & Documents"
      />

      {/* Maintenance History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Maintenance History
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/maintenance/new?property=${id}`}>
                New Request
              </Link>
            </Button>
          </CardTitle>
          <CardDescription>Recent maintenance requests for this property</CardDescription>
        </CardHeader>
        <CardContent>
          {maintenance.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No maintenance requests yet
            </p>
          ) : (
            <div className="space-y-3">
              {maintenance.map((request: MaintenanceRequest) => (
                <Link
                  key={request.id}
                  href={`/dashboard/maintenance/${request.id}`}
                  className="flex items-start justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
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
                      <p className="font-medium">{request.title}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {request.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      variant={
                        request.status === "completed"
                          ? "default"
                          : request.status === "in_progress"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {request.status.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(request.created_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
