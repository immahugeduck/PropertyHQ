"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Users, Mail, Building2, Calendar, DollarSign, FileText, Info, AlertCircle, KeyRound } from "lucide-react"
import type { Tenant, Property } from "@/lib/types"
import { notifyTenantAdded } from "@/app/actions/notify-tenant"
import { inviteTenant } from "@/app/actions/tenant-invites"

interface TenantFormProps {
  tenant?: Tenant
  properties: Property[]
  userId: string
  defaultPropertyId?: string
}

function FormSection({ 
  icon: Icon, 
  title, 
  description, 
  children 
}: { 
  icon: React.ElementType
  title: string
  description: string
  children: React.ReactNode 
}) {
  return (
    <div className="space-y-4 pb-6 border-b border-border last:border-b-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 mt-0.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="pl-0 sm:pl-11">
        {children}
      </div>
    </div>
  )
}

function FieldHint({ children, type = "info" }: { children: React.ReactNode, type?: "info" | "warning" }) {
  return (
    <p className={`text-xs mt-1 flex items-center gap-1 ${type === "warning" ? "text-amber-600" : "text-muted-foreground"}`}>
      {type === "warning" ? <AlertCircle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
      {children}
    </p>
  )
}

export function TenantForm({ tenant, properties, userId, defaultPropertyId }: TenantFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState(tenant?.property_id || defaultPropertyId || "none")
  const [sendInvite, setSendInvite] = useState(true)

  const isEditing = !!tenant

  // Get selected property to auto-fill rent amount
  const selectedProperty = properties.find(p => p.id === selectedPropertyId)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const propertyId = formData.get("property_id") as string
    
    if (!propertyId || propertyId === "none") {
      setError("Select a property for this tenant.")
      setLoading(false)
      return
    }
    const data = {
      user_id: userId,
      is_demo: formData.get("is_demo") === "on",
      property_id: propertyId === "none" ? null : propertyId,
      first_name: formData.get("first_name") as string,
      last_name: formData.get("last_name") as string,
      email: formData.get("email") as string,
      phone: (formData.get("phone") as string) || null,
      lease_start: (formData.get("lease_start") as string) || null,
      lease_end: (formData.get("lease_end") as string) || null,
      rent_amount: parseFloat(formData.get("rent_amount") as string) || 0,
      security_deposit: parseFloat(formData.get("security_deposit") as string) || 0,
      status: formData.get("status") as string,
      notes: (formData.get("notes") as string) || null,
      updated_at: new Date().toISOString(),
    }

    if (data.lease_start && data.lease_end && data.lease_end < data.lease_start) {
      setError("Lease end must be on or after lease start.")
      setLoading(false)
      return
    }
    const supabase = createClient()

    if (isEditing) {
      const { error: updateError } = await supabase
        .from("tenants")
        .update(data)
        .eq("id", tenant.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
    } else {
      const { data: newTenant, error: insertError } = await supabase
        .from("tenants")
        .insert(data)
        .select("id")
        .single()

      if (insertError) {
        setError(insertError.message)
        setLoading(false)
        return
      }

      // Update property status to occupied if a property is selected
      if (propertyId && propertyId !== "none") {
        await supabase
          .from("properties")
          .update({ status: "occupied", updated_at: new Date().toISOString() })
          .eq("id", propertyId)
      }

      // Notify manager of new tenant (non-critical, fires and forgets)
      const property = properties.find(p => p.id === propertyId)
      notifyTenantAdded({
        userId,
        tenantName: `${data.first_name} ${data.last_name}`,
        propertyName: property?.name || "No property assigned",
      })

      // Optionally send the portal invite immediately on creation.
      if (sendInvite && data.email && newTenant?.id) {
        const res = await inviteTenant(newTenant.id)
        if (res?.error) {
          // Tenant was created fine; surface invite issue but still continue
          // to the detail page where the manager can retry / copy the link.
          console.error("[v0] invite on create failed:", res.error)
        }
        router.push(`/dashboard/tenants/${newTenant.id}`)
        router.refresh()
        return
      }
    }

    router.push("/dashboard/tenants")
    router.refresh()
  }

  const vacantProperties = properties.filter(p => p.status === "vacant" || p.id === tenant?.property_id)
  const occupiedProperties = properties.filter(p => p.status === "occupied" && p.id !== tenant?.property_id)

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>{isEditing ? "Edit Tenant" : "Add New Tenant"}</CardTitle>
              <CardDescription>
                {isEditing
                  ? "Update tenant information. Changes to rent will be reflected in future invoices."
                  : "Add a tenant to your system. You can assign them to a property and set up their lease details."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-lg border border-red-500/20">
              {error}
            </div>
          )}

          {/* Personal Information */}
          <FormSection
            icon={Users}
            title="Personal Information"
            description="Enter the tenant's legal name as it appears on their ID or lease agreement."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name *</Label>
                <Input
                  id="first_name"
                  name="first_name"
                  placeholder="John"
                  defaultValue={tenant?.first_name}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name *</Label>
                <Input
                  id="last_name"
                  name="last_name"
                  placeholder="Doe"
                  defaultValue={tenant?.last_name}
                  required
                />
              </div>
            </div>
          </FormSection>

          {/* Contact Information */}
          <FormSection
            icon={Mail}
            title="Contact Information"
            description="Primary contact details for sending rent reminders, maintenance updates, and other communications."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="john.doe@example.com"
                  defaultValue={tenant?.email}
                  required
                />
                <FieldHint>Used for sending invoices and notifications</FieldHint>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  defaultValue={tenant?.phone || ""}
                />
                <FieldHint>For urgent communications and maintenance coordination</FieldHint>
              </div>
            </div>
          </FormSection>

          {/* Property Assignment */}
          <FormSection
            icon={Building2}
            title="Property Assignment"
            description="Assign this tenant to one of your properties. This links their lease and payments to the property."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="property_id">Assign to Property *</Label>
                <Select 
                  name="property_id" 
                  value={selectedPropertyId}
                  onValueChange={setSelectedPropertyId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No property assigned</SelectItem>
                    {vacantProperties.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
                          Available Properties
                        </div>
                        {vacantProperties.map((property) => (
                          <SelectItem key={property.id} value={property.id}>
                            {property.name} - ${property.monthly_rent}/mo
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {occupiedProperties.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
                          Occupied Properties
                        </div>
                        {occupiedProperties.map((property) => (
                          <SelectItem key={property.id} value={property.id} disabled>
                            {property.name} (Occupied)
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
                {selectedProperty && (
                  <FieldHint>
                    {selectedProperty.address}, {selectedProperty.city} - {selectedProperty.bedrooms}bd/{selectedProperty.bathrooms}ba
                  </FieldHint>
                )}
                {properties.length === 0 && (
                  <FieldHint type="warning">
                    No properties available. Add a property first to assign tenants.
                  </FieldHint>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Tenant Status *</Label>
                <Select name="status" defaultValue={tenant?.status || "active"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active - Currently Renting</SelectItem>
                    <SelectItem value="pending">Pending - Lease Not Started</SelectItem>
                    <SelectItem value="inactive">Inactive - Moved Out</SelectItem>
                  </SelectContent>
                </Select>
                <FieldHint>Active tenants appear in rent collection reports</FieldHint>
              </div>
            </div>
          </FormSection>

          {/* Lease Terms */}
          <FormSection
            icon={Calendar}
            title="Lease Terms"
            description="Set the lease duration. You'll receive alerts when the lease is approaching expiration."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="lease_start">Lease Start Date</Label>
                <Input
                  id="lease_start"
                  name="lease_start"
                  type="date"
                  defaultValue={tenant?.lease_start || ""}
                />
                <FieldHint>When the lease agreement begins</FieldHint>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lease_end">Lease End Date</Label>
                <Input
                  id="lease_end"
                  name="lease_end"
                  type="date"
                  defaultValue={tenant?.lease_end || ""}
                />
                <FieldHint>You&apos;ll get reminders 60 days before expiration</FieldHint>
              </div>
            </div>
          </FormSection>

          {/* Financial Terms */}
          <FormSection
            icon={DollarSign}
            title="Financial Terms"
            description="Set the monthly rent amount and security deposit. Rent amounts are used to generate recurring invoices."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rent_amount">Monthly Rent *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="rent_amount"
                    name="rent_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="pl-7"
                    defaultValue={tenant?.rent_amount || selectedProperty?.monthly_rent || ""}
                    required
                  />
                </div>
                {selectedProperty && !tenant?.rent_amount && (
                  <FieldHint>Pre-filled with property&apos;s listed rent of ${selectedProperty.monthly_rent}</FieldHint>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="security_deposit">Security Deposit</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="security_deposit"
                    name="security_deposit"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="pl-7"
                    defaultValue={tenant?.security_deposit || ""}
                  />
                </div>
                <FieldHint>Typically 1-2 months rent, held until move-out</FieldHint>
              </div>
            </div>
          </FormSection>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_demo" defaultChecked={tenant?.is_demo} />
            Test/demo tenant (can be hidden in Settings)
          </label>
          {/* Additional Notes */}
          <FormSection
            icon={FileText}
            title="Additional Notes"
            description="Record any important details about the tenant such as pets, vehicle info, emergency contacts, or special arrangements."
          >
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="e.g., 2 vehicles (Honda Civic, Ford F-150), 1 cat allowed per lease, emergency contact: Jane Doe (555-555-5555)..."
                defaultValue={tenant?.notes || ""}
                rows={4}
              />
              <FieldHint>Private notes visible only to you</FieldHint>
            </div>
          </FormSection>

          {/* Portal Access (create only) */}
          {!isEditing && (
            <FormSection
              icon={KeyRound}
              title="Portal Access"
              description="Invite this tenant to their online portal where they can view their lease, pay rent, see payment history, message you, and submit maintenance requests."
            >
              <label
                htmlFor="send_invite"
                className="flex items-start gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <Checkbox
                  id="send_invite"
                  checked={sendInvite}
                  onCheckedChange={(checked) => setSendInvite(checked === true)}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <span className="text-sm font-medium text-foreground block">
                    Send portal invite now
                  </span>
                  <span className="text-xs text-muted-foreground block">
                    An email invite is sent immediately after the tenant is created. Requires an email
                    address. You can also invite or resend later from the tenant&apos;s page.
                  </span>
                </div>
              </label>
            </FormSection>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-4 pt-4 border-t">
            <Button type="submit" disabled={loading} size="lg">
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              {isEditing ? "Save Changes" : "Add Tenant"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
