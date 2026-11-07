import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Wrench,
  Building2,
  User,
  Calendar,
  DollarSign,
  Edit,
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  Play,
  MessageSquare,
} from "lucide-react"
import { DeleteMaintenanceButton } from "@/components/maintenance/delete-maintenance-button"
import { UpdateStatusButton } from "@/components/maintenance/update-status-button"
import { VendorAssignmentCard } from "@/components/vendors/vendor-assignment-card"

function formatDate(dateString: string | null) {
  if (!dateString) return "Not set"
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function formatCurrency(amount: number | null) {
  if (!amount) return "N/A"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount)
}

const urgencyColors = {
  low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  emergency: "bg-red-500/10 text-red-500 border-red-500/20",
}

const statusColors = {
  open: "bg-yellow-500/10 text-yellow-500",
  in_progress: "bg-blue-500/10 text-blue-500",
  completed: "bg-green-500/10 text-green-500",
  cancelled: "bg-gray-500/10 text-gray-500",
}

const statusIcons = {
  open: Clock,
  in_progress: Play,
  completed: CheckCircle,
  cancelled: AlertTriangle,
}

const categoryLabels = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "HVAC",
  appliance: "Appliances",
  structural: "Structural",
  general: "General",
}

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: request, error }, { data: vendors }] = await Promise.all([
    supabase
      .from("maintenance_requests")
      .select("*, property:properties(*), tenant:tenants(*), vendor:vendors(*)")
      .eq("id", id)
      .single(),
    supabase.from("vendors").select("*").eq("user_id", user?.id ?? "").order("name"),
  ])

  if (error || !request) {
    notFound()
  }

  // Sign any attached photos so they can be displayed.
  let photoUrls: string[] = []
  if (request.photo_paths?.length) {
    const { data: signed } = await supabase.storage
      .from("property-files")
      .createSignedUrls(request.photo_paths, 3600)
    photoUrls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[]
  }

  const StatusIcon = statusIcons[request.status as keyof typeof statusIcons]

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard/maintenance"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Maintenance
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{request.title}</h1>
              <Badge
                variant="outline"
                className={urgencyColors[request.urgency as keyof typeof urgencyColors]}
              >
                {request.urgency}
              </Badge>
              <Badge
                variant="outline"
                className={statusColors[request.status as keyof typeof statusColors]}
              >
                <StatusIcon className="mr-1 h-3 w-3" />
                {request.status.replace("_", " ")}
              </Badge>
            </div>
            {request.property && (
              <Link
                href={`/dashboard/properties/${request.property.id}`}
                className="text-muted-foreground flex items-center gap-1 mt-1 hover:text-foreground"
              >
                <Building2 className="h-4 w-4" />
                {request.property.name}
              </Link>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <UpdateStatusButton 
              requestId={id} 
              currentStatus={request.status}
              requestTitle={request.title}
              propertyName={request.property?.name || "Property"}
              userId={user?.id || ""}
            />
            <Button variant="outline" asChild>
              <Link href={`/dashboard/maintenance/${id}/edit`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <DeleteMaintenanceButton requestId={id} requestTitle={request.title} />
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Main Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Request Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Summary</p>
              <p className="whitespace-pre-wrap">{request.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div>
                <p className="text-sm text-muted-foreground">Category</p>
                <p className="font-medium">
                  {categoryLabels[request.category as keyof typeof categoryLabels]}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Urgency</p>
                <Badge
                  variant="outline"
                  className={urgencyColors[request.urgency as keyof typeof urgencyColors]}
                >
                  {request.urgency}
                </Badge>
              </div>
            </div>
            {request.notes && (
              <div className="pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground mb-1">Internal Notes</p>
                <p className="text-sm whitespace-pre-wrap">{request.notes}</p>
              </div>
            )}
            {photoUrls.length > 0 && (
              <div className="pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground mb-2">Photos</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photoUrls.map((url, idx) => (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg border border-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Maintenance photo ${idx + 1}`}
                        className="aspect-square w-full object-cover transition-transform hover:scale-105"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Timeline and Costs */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{formatDate(request.created_at)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Scheduled</p>
                  <p className="font-medium">{formatDate(request.scheduled_date)}</p>
                </div>
              </div>
              <div className="pt-4 border-t border-border">
                <div>
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="font-medium">{formatDate(request.completed_date)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Cost
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                <p className="text-sm text-muted-foreground">Actual</p>
                <p className="text-xl font-bold">{formatCurrency(request.actual_cost)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Vendor */}
          <VendorAssignmentCard
            requestId={id}
            currentVendor={request.vendor ?? null}
            vendors={vendors ?? []}
          />

          {/* Reported By — free-text name (non-tenant reporter) */}
          {!request.tenant && request.reported_by_name && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Reported By
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-medium">{request.reported_by_name}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Reported By — tenant */}
          {request.tenant && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Reported By
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/dashboard/tenants/${request.tenant.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {request.tenant.first_name} {request.tenant.last_name}
                    </p>
                    <p className="text-sm text-muted-foreground">{request.tenant.email}</p>
                  </div>
                </Link>
                <Button variant="outline" className="w-full mt-3" asChild>
                  <Link href={`/dashboard/messages/${request.tenant.id}/chat`}>
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Message Tenant
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
