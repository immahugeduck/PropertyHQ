import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { InstallTemplatesButton } from "@/components/leases/install-templates-button"
import { FileSignature, FileText, Plus, ChevronRight, CheckCircle2, Clock, Send, Ban } from "lucide-react"
import type { Lease, LeaseTemplate } from "@/lib/types"

const STATUS: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground", icon: FileText },
  sent: { label: "Awaiting signature", className: "bg-amber-500/10 text-amber-600", icon: Send },
  signed: { label: "Signed", className: "bg-green-500/10 text-green-600", icon: CheckCircle2 },
  voided: { label: "Voided", className: "bg-destructive/10 text-destructive", icon: Ban },
}

export default async function LeasesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const [templatesRes, leasesRes] = await Promise.all([
    supabase.from("lease_templates").select("*").eq("user_id", user.id).order("name"),
    supabase
      .from("leases")
      .select("*, tenant:tenants(id, first_name, last_name), property:properties(id, name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ])
  const templates = (templatesRes.data || []) as LeaseTemplate[]
  const leases = (leasesRes.data || []) as Lease[]

  return (
    <div className="space-y-6 pt-12 lg:pt-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leases</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create leases from your templates and collect tenant signatures online
          </p>
        </div>
        {templates.length > 0 && (
          <Button asChild>
            <Link href="/dashboard/leases/new">
              <Plus className="mr-2 h-4 w-4" />
              New lease
            </Link>
          </Button>
        )}
      </div>

      {/* Templates */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">TEMPLATES</h2>
          {templates.length > 0 && <InstallTemplatesButton variant="outline" />}
        </div>
        {templates.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="rounded-full bg-primary/10 p-3">
                <FileSignature className="h-7 w-7 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Set up your lease templates</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Install the built-in Indiana Residential Lease template to start creating
                  fillable, e-signable leases for your tenants.
                </p>
              </div>
              <InstallTemplatesButton />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex items-start gap-3 pt-5">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <FileSignature className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.page_count} pages · {t.fields.length} fields
                    </p>
                    <Button asChild size="sm" variant="link" className="mt-1 h-auto p-0 text-xs">
                      <Link href={`/dashboard/leases/new?template=${t.id}`}>Create lease →</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Leases */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">LEASES</h2>
        {leases.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border py-12 text-center">
            <FileSignature className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No leases yet. {templates.length > 0 ? "Create one from a template above." : "Install a template to begin."}
            </p>
            <div className="mt-4">{templates.length > 0 ? <Button asChild><Link href="/dashboard/leases/new">Add lease</Link></Button> : <InstallTemplatesButton />}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {leases.map((l) => {
              const s = STATUS[l.status] || STATUS.draft
              const Icon = s.icon
              return (
                <Link key={l.id} href={`/dashboard/leases/${l.id}`}>
                  <Card className="transition-colors hover:border-primary/30 hover:bg-accent/30">
                    <CardContent className="flex items-center gap-4 py-4">
                      <div className="rounded-lg bg-muted p-2">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {l.tenant ? `${l.tenant.first_name} ${l.tenant.last_name}` : "No tenant"}
                          {l.property ? ` · ${l.property.name}` : ""}
                        </p>
                      </div>
                      <Badge variant="secondary" className={s.className}>
                        <Icon className="mr-1 h-3 w-3" />
                        {s.label}
                      </Badge>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
