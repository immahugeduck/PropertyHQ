"use client"

import { useState, useRef } from "react"
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
import { Paperclip, X, Image as ImageIcon } from "lucide-react"
import type { MaintenanceRequest, Property, Tenant } from "@/lib/types"
import { notifyMaintenanceCreated } from "@/app/actions/notify-maintenance"

interface MaintenanceFormProps {
  request?: MaintenanceRequest
  properties: Property[]
  tenants: Tenant[]
  userId: string
  defaultPropertyId?: string
  defaultTenantId?: string
}

export function MaintenanceForm({
  request,
  properties,
  tenants,
  userId,
  defaultPropertyId,
  defaultTenantId,
}: MaintenanceFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState(
    request?.property_id || defaultPropertyId || ""
  )
  // "Reported by" can be a tenant, "none", or "other" (a free-text name).
  const [reportedBy, setReportedBy] = useState(
    request?.reported_by_name ? "other" : request?.tenant_id || defaultTenantId || "none"
  )
  const [reportedByName, setReportedByName] = useState(request?.reported_by_name || "")
  // Photos: existing storage paths (when editing) plus newly picked files.
  const [existingPhotos, setExistingPhotos] = useState<string[]>(request?.photo_paths || [])
  const [newPhotos, setNewPhotos] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEditing = !!request

  // Filter tenants by selected property
  const filteredTenants = selectedPropertyId
    ? tenants.filter((t) => t.property_id === selectedPropertyId)
    : tenants

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (images.length !== files.length) setError("Only image files are supported.")
    setNewPhotos((prev) => [...prev, ...images].slice(0, 5))
    e.target.value = ""
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const propertyId = formData.get("property_id") as string

    const supabase = createClient()

    // Upload any newly added photos to storage, then keep existing + new paths.
    const uploadedPaths: string[] = []
    for (const photo of newPhotos) {
      const ext = photo.name.split(".").pop()
      const path = `${userId}/maintenance/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from("property-files")
        .upload(path, photo)
      if (uploadError) {
        setError(`Failed to upload ${photo.name}: ${uploadError.message}`)
        setLoading(false)
        return
      }
      uploadedPaths.push(path)
    }

    const isOther = reportedBy === "other"
    const isTenant = reportedBy !== "none" && reportedBy !== "other"

    const data = {
      user_id: userId,
      property_id: propertyId,
      tenant_id: isTenant ? reportedBy : null,
      reported_by_name: isOther ? reportedByName.trim() || null : null,
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      category: formData.get("category") as string,
      urgency: formData.get("urgency") as string,
      status: formData.get("status") as string,
      actual_cost: parseFloat(formData.get("actual_cost") as string) || null,
      scheduled_date: (formData.get("scheduled_date") as string) || null,
      completed_date: (formData.get("completed_date") as string) || null,
      ...(!isEditing?{notes:(formData.get("notes") as string)||null}:{}),
      photo_paths: [...existingPhotos, ...uploadedPaths],
      updated_at: new Date().toISOString(),
    }

    if (isEditing) {
      const { error: updateError } = await supabase
        .from("maintenance_requests")
        .update(data)
        .eq("id", request.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
    } else {
      const { error: insertError } = await supabase
        .from("maintenance_requests")
        .insert(data)

      if (insertError) {
        setError(insertError.message)
        setLoading(false)
        return
      }

      // Notify manager of new maintenance request (non-critical, fires and forgets)
      const property = properties.find(p => p.id === propertyId)
      if (property) {
        notifyMaintenanceCreated({
          userId,
          propertyName: property.name,
          title: data.title,
          urgency: data.urgency,
        })
      }
    }

    router.push("/dashboard/maintenance")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Request" : "New Maintenance Request"}</CardTitle>
          <CardDescription>
            {isEditing
              ? "Update the maintenance request details"
              : "Enter the details of the maintenance issue"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              placeholder="Brief description of the issue"
              defaultValue={request?.title}
              required
            />
          </div>

          {/* Summary */}
          <div className="space-y-2">
            <Label htmlFor="description">Summary</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Where, how, and when it was noticed (e.g. 'Tenant heard a leak under the kitchen sink this morning')..."
              defaultValue={request?.description}
              rows={4}
              required
            />
          </div>

          {/* Property and Tenant */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="property_id">Property</Label>
              <Select
                name="property_id"
                defaultValue={selectedPropertyId}
                onValueChange={setSelectedPropertyId}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select property" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reported_by">Reported By</Label>
              <Select value={reportedBy} onValueChange={setReportedBy}>
                <SelectTrigger id="reported_by">
                  <SelectValue placeholder="Who reported this?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No one assigned</SelectItem>
                  {filteredTenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.first_name} {tenant.last_name}
                    </SelectItem>
                  ))}
                  <SelectItem value="other">Other…</SelectItem>
                </SelectContent>
              </Select>
              {reportedBy === "other" && (
                <Input
                  aria-label="Name of person who reported the issue"
                  placeholder="e.g. maintenance worker, lawn crew, neighbor"
                  value={reportedByName}
                  onChange={(e) => setReportedByName(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
          </div>

          {/* Category and Urgency */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select name="category" defaultValue={request?.category || "general"}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plumbing">Plumbing</SelectItem>
                  <SelectItem value="electrical">Electrical</SelectItem>
                  <SelectItem value="hvac">HVAC</SelectItem>
                  <SelectItem value="appliance">Appliances</SelectItem>
                  <SelectItem value="structural">Structural</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="urgency">Urgency</Label>
              <Select name="urgency" defaultValue={request?.urgency || "medium"}>
                <SelectTrigger>
                  <SelectValue placeholder="Select urgency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low - Can wait</SelectItem>
                  <SelectItem value="medium">Medium - Soon</SelectItem>
                  <SelectItem value="high">High - Urgent</SelectItem>
                  <SelectItem value="emergency">Emergency - Immediate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select name="status" defaultValue={request?.status || "open"}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Cost (actual billed amount; estimates are handled separately) */}
          <div className="space-y-2">
            <Label htmlFor="actual_cost">Actual Cost ($)</Label>
            <Input
              id="actual_cost"
              name="actual_cost"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              defaultValue={request?.actual_cost || ""}
            />
          </div>

          {/* Dates */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="scheduled_date">Scheduled Date</Label>
              <Input
                id="scheduled_date"
                name="scheduled_date"
                type="date"
                defaultValue={request?.scheduled_date || ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="completed_date">Completed Date</Label>
              <Input
                id="completed_date"
                name="completed_date"
                type="date"
                defaultValue={request?.completed_date || ""}
              />
            </div>
          </div>

          {/* Notes */}
          {!isEditing&&<div className="space-y-2">
            <Label htmlFor="notes">Internal Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Additional notes for reference..."
              defaultValue=""
              maxLength={8000}
              rows={3}
            />
          </div>}
          {isEditing&&<p className="text-sm text-muted-foreground">Add internal notes from the request’s Notes and activity section. Existing history is preserved when you save these details.</p>}

          {/* Photos */}
          <div className="space-y-2">
            <Label>Photos (optional, up to 5)</Label>
            <div className="flex flex-wrap gap-2">
              {existingPhotos.map((path, idx) => (
                <div
                  key={`existing-${idx}`}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
                >
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[120px] truncate">{path.split("/").pop()}</span>
                  <button
                    type="button"
                    onClick={() => setExistingPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    className="ml-1 rounded hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {newPhotos.map((photo, idx) => (
                <div
                  key={`new-${idx}`}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
                >
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[120px] truncate">{photo.name}</span>
                  <button
                    type="button"
                    onClick={() => setNewPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    className="ml-1 rounded hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {existingPhotos.length + newPhotos.length < 5 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Add photo
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              {isEditing ? "Update Request" : "Create Request"}
            </Button>
            <Button
              type="button"
              variant="outline"
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
