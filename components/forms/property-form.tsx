"use client"

import { useEffect, useState } from "react"
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
import { Spinner } from "@/components/ui/spinner"
import { Building2, MapPin, Home, DollarSign, FileText, Info, UserRound } from "lucide-react"
import type { Property } from "@/lib/types"

interface PropertyFormProps {
  property?: Property
  userId: string
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

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
      <Info className="h-3 w-3" />
      {children}
    </p>
  )
}

export function PropertyForm({ property, userId }: PropertyFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [owners, setOwners] = useState<{ id: string; first_name: string; last_name: string; company_name: string | null }[]>([])
  const [ownerId, setOwnerId] = useState(property?.owner_id || "unassigned")
  useEffect(() => {
    let active = true
    createClient().from("property_owners").select("id,first_name,last_name,company_name").eq("user_id", userId).order("last_name").then(({data,error}) => {
      if (active) {
        if (error) setError("Unable to load property owners: " + error.message)
        else setOwners(data || [])
      }
    })
    return () => { active = false }
  }, [userId])

  const isEditing = !!property

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const data = {
      user_id: userId,
      owner_id: ownerId === "unassigned" ? null : ownerId,
      name: formData.get("name") as string,
      address: formData.get("address") as string,
      city: (formData.get("city") as string).trim(),
      state: (formData.get("state") as string).trim().toUpperCase(),
      zip_code: formData.get("zip_code") as string,
      property_type: formData.get("property_type") as string,
      bedrooms: Number(formData.get("bedrooms")),
      bathrooms: Number(formData.get("bathrooms")),
      square_feet: parseInt(formData.get("square_feet") as string) || null,
      monthly_rent: parseFloat(formData.get("monthly_rent") as string) || 0,
      status: formData.get("status") as string,
      notes: formData.get("notes") as string || null,
      updated_at: new Date().toISOString(),
    }

    if (data.city.toLowerCase() === "greencaslte") {
      setError("City appears misspelled. Use Greencastle.")
      setLoading(false)
      return
    }
    const supabase = createClient()

    if (isEditing) {
      const { error: updateError } = await supabase
        .from("properties")
        .update(data)
        .eq("id", property.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
    } else {
      const { error: insertError } = await supabase
        .from("properties")
        .insert(data)

      if (insertError) {
        setError(insertError.message)
        setLoading(false)
        return
      }
    }

    router.push("/dashboard/properties")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <datalist id="known-cities"><option value="Greencastle" /></datalist>
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>{isEditing ? "Edit Property" : "Add New Property"}</CardTitle>
              <CardDescription>
                {isEditing
                  ? "Update the property details below. Changes will be reflected across all reports."
                  : "Add a property to your portfolio. This will appear in your inventory and can be assigned to tenants."}
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

          {/* Property Identification */}
          <FormSection
            icon={Building2}
            title="Property Identification"
            description="Give your property a memorable name and select its type. This helps you quickly identify properties in lists and reports."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Property Name *</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g., Oak Street Apartment"
                  defaultValue={property?.name}
                  required
                />
                <FieldHint>Use a unique name like &quot;123 Oak St Unit A&quot; or &quot;Downtown Loft&quot;</FieldHint>
              </div>
              <div className="space-y-2">
                <Label htmlFor="property_type">Property Type *</Label>
                <Select name="property_type" defaultValue={property?.property_type || "apartment"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apartment">Apartment</SelectItem>
                    <SelectItem value="house">Single Family House</SelectItem>
                    <SelectItem value="condo">Condominium</SelectItem>
                    <SelectItem value="townhouse">Townhouse</SelectItem>
                    <SelectItem value="commercial">Commercial Space</SelectItem>
                  </SelectContent>
                </Select>
                <FieldHint>Property type affects reporting categories</FieldHint>
              </div>
            </div>
          </FormSection>

          {/* Property Ownership */}
          <FormSection icon={UserRound} title="Property Owner" description="Associate this property with an owner for management and reporting.">
            <div className="space-y-2">
              <Label htmlFor="owner_id">Assigned Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="owner_id"><SelectValue placeholder="Select owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {owners.map(owner => <SelectItem key={owner.id} value={owner.id}>{owner.first_name} {owner.last_name}{owner.company_name ? ` (${owner.company_name})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldHint>Create new owners from the Owners dashboard tab.</FieldHint>
            </div>
          </FormSection>

          {/* Location Details */}
          <FormSection
            icon={MapPin}
            title="Location Details"
            description="Enter the complete address for the property. This will be used for tenant communications, maintenance scheduling, and reports."
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="address">Street Address *</Label>
                <Input
                  id="address"
                  name="address"
                  placeholder="123 Main Street, Unit 4B"
                  defaultValue={property?.address}
                  required
                />
                <FieldHint>Include unit, suite, or apartment number if applicable</FieldHint>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="city">City *</Label>
                  <Input
                    id="city"
                    name="city"
                    placeholder="San Francisco"
                    autoComplete="address-level2"
                    list="known-cities"
                    defaultValue={property?.city}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State *</Label>
                  <Input
                    id="state"
                    name="state"
                    placeholder="CA"
                    defaultValue={property?.state}
                    required
                    maxLength={2}
                    pattern="[A-Za-z]{2}"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip_code">ZIP Code *</Label>
                  <Input
                    id="zip_code"
                    name="zip_code"
                    placeholder="94102"
                    pattern="[0-9]{5}(-[0-9]{4})?"
                    autoComplete="postal-code"
                    defaultValue={property?.zip_code}
                    required
                  />
                </div>
              </div>
            </div>
          </FormSection>

          {/* Property Specifications */}
          <FormSection
            icon={Home}
            title="Property Specifications"
            description="Enter the physical details of the property. These help calculate comparable rates and attract potential tenants."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="bedrooms">Bedrooms *</Label>
                <Input
                  id="bedrooms"
                  name="bedrooms"
                  type="number"
                  min="0"
                  defaultValue={property?.bedrooms || 1}
                  required
                />
                <FieldHint>Enter 0 for studio apartments</FieldHint>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bathrooms">Bathrooms *</Label>
                <Input
                  id="bathrooms"
                  name="bathrooms"
                  type="number"
                  min="0"
                  step="0.5"
                  defaultValue={property?.bathrooms || 1}
                  required
                />
                <FieldHint>Use .5 for half baths</FieldHint>
              </div>
              <div className="space-y-2">
                <Label htmlFor="square_feet">Square Feet</Label>
                <Input
                  id="square_feet"
                  name="square_feet"
                  type="number"
                  min="0"
                  placeholder="Optional"
                  defaultValue={property?.square_feet || ""}
                />
                <FieldHint>Total livable square footage</FieldHint>
              </div>
            </div>
          </FormSection>

          {/* Financial Details */}
          <FormSection
            icon={DollarSign}
            title="Financial Details"
            description="Set the monthly rent for this property. This is used to generate rent invoices and calculate expected revenue in reports."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="monthly_rent">Monthly Rent *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="monthly_rent"
                    name="monthly_rent"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="pl-7"
                    defaultValue={property?.monthly_rent || ""}
                    required
                  />
                </div>
                <FieldHint>Base monthly rent before utilities or fees</FieldHint>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Occupancy Status *</Label>
                <Select name="status" defaultValue={property?.status || "vacant"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacant">Vacant - Ready to Rent</SelectItem>
                    <SelectItem value="occupied">Occupied - Tenant Assigned</SelectItem>
                    <SelectItem value="maintenance">Under Maintenance</SelectItem>
                  </SelectContent>
                </Select>
                <FieldHint>Status updates automatically when tenants are assigned</FieldHint>
              </div>
            </div>
          </FormSection>

          {/* Additional Information */}
          <FormSection
            icon={FileText}
            title="Additional Information"
            description="Add any notes about the property such as amenities, parking details, HOA rules, or special considerations."
          >
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="e.g., Includes in-unit washer/dryer, 1 covered parking spot, HOA covers water..."
                defaultValue={property?.notes || ""}
                rows={4}
              />
              <FieldHint>These notes are visible only to you and help track important property details</FieldHint>
            </div>
          </FormSection>

          {/* Actions */}
          <div className="flex flex-wrap gap-4 pt-4 border-t">
            <Button type="submit" disabled={loading} size="lg">
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              {isEditing ? "Save Changes" : "Add Property"}
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
