import { redirect } from "next/navigation"
import { getCurrentTenant } from "@/lib/tenant-auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ContactInfoForm } from "@/components/portal/contact-info-form"
import { HouseholdEditor } from "@/components/household/household-editor"
import { addMyHouseholdMember, removeMyHouseholdMember } from "@/app/actions/household"
import type { HouseholdMember } from "@/lib/types"

export default async function PortalProfilePage() {
  const tenant = await getCurrentTenant()
  if (!tenant) redirect("/auth/login")

  const supabase = await createClient()
  const { data: members } = await supabase
    .from("household_members")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Info</h1>
        <p className="text-muted-foreground">Keep your contact details and household up to date</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact information</CardTitle>
            <CardDescription>
              {tenant.first_name} {tenant.last_name}
              {tenant.property?.name ? ` · ${tenant.property.name}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContactInfoForm
              email={tenant.email}
              phone={tenant.phone}
              emergencyName={tenant.emergency_contact_name ?? null}
              emergencyPhone={tenant.emergency_contact_phone ?? null}
              emergencyRelationship={tenant.emergency_contact_relationship ?? null}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Household</CardTitle>
            <CardDescription>
              List everyone 12 and older who lives here, besides you, so maintenance knows who may
              answer the door. Your property manager is notified of changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HouseholdEditor
              members={(members as HouseholdMember[]) ?? []}
              addAction={addMyHouseholdMember}
              removeAction={removeMyHouseholdMember}
              emptyText="Just you so far."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
