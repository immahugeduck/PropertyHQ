import { createClient } from "@/lib/supabase/server"
import type { MaintenanceRequest } from "@/lib/types"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { WaitingIndicator } from "@/components/maintenance/waiting-indicator"
import { Plus, Wrench, Building2, AlertTriangle, CheckCircle, Clock, Play } from "lucide-react"

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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
  appliance: "Appliance",
  structural: "Structural",
  general: "General",
}

export default async function MaintenancePage() {
  const supabase = await createClient()

  const [{ data: requests, error },{data:followupSettings}] = await Promise.all([supabase
    .from("maintenance_requests")
    .select("*, property:properties(id, name, address), tenant:tenants(id, first_name, last_name)")
    .order("created_at", { ascending: false }),supabase.from("maintenance_followup_settings").select("enabled,reminder_hours").maybeSingle()])

  if (error) {
    console.error("Error fetching maintenance requests:", error)
  }

  // Group by status
  const openRequests = requests?.filter(r => r.status === "open") || []
  const inProgressRequests = requests?.filter(r => r.status === "in_progress") || []
  const completedRequests = requests?.filter(r => r.status === "completed") || []

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Maintenance</h1>
          <p className="text-muted-foreground">
            Track and manage maintenance requests
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/maintenance/new">
            <Plus className="mr-2 h-4 w-4" />
            New Request
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/10 rounded-lg">
                <Clock className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Open</p>
                <p className="text-2xl font-bold">{openRequests.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Play className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In Progress</p>
                <p className="text-2xl font-bold">{inProgressRequests.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">{completedRequests.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {!requests || requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No maintenance requests</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first maintenance request to track issues
            </p>
            <Button asChild>
              <Link href="/dashboard/maintenance/new">
                <Plus className="mr-2 h-4 w-4" />
                New Request
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((request: MaintenanceRequest) => {
            const StatusIcon = statusIcons[request.status as keyof typeof statusIcons]
            return (
              <Link key={request.id} href={`/dashboard/maintenance/${request.id}`}>
                <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                  <CardContent className="pt-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={`p-2 rounded-lg ${statusColors[request.status as keyof typeof statusColors]}`}>
                          <StatusIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold">{request.title}</h3>
                            <Badge
                              variant="outline"
                              className={urgencyColors[request.urgency as keyof typeof urgencyColors]}
                            >
                              {request.urgency}
                            </Badge>
                            <Badge variant="secondary">
                              {categoryLabels[request.category as keyof typeof categoryLabels]}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {request.description}
                          </p>
                          <WaitingIndicator request={request} hours={followupSettings?.reminder_hours??24} enabled={followupSettings?.enabled??true}/>
                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            {request.property && (
                              <span className="flex items-center gap-1">
                                <Building2 className="h-4 w-4" />
                                {request.property.name}
                              </span>
                            )}
                            <span>Created {formatDate(request.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right sm:text-left">
                        <Badge
                          variant="outline"
                          className={statusColors[request.status as keyof typeof statusColors]}
                        >
                          {request.status.replace("_", " ")}
                        </Badge>
                        {request.estimated_cost && (
                          <p className="text-sm text-muted-foreground mt-2">
                            Est. {formatCurrency(request.estimated_cost)}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
