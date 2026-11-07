"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { updateMyContactInfo } from "@/app/actions/household"

interface ContactInfoFormProps {
  email: string
  phone: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  emergencyRelationship: string | null
}

export function ContactInfoForm({
  email,
  phone,
  emergencyName,
  emergencyPhone,
  emergencyRelationship,
}: ContactInfoFormProps) {
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const res = await updateMyContactInfo(new FormData(e.currentTarget))
    setSaving(false)
    if (res.ok) toast.success("Your information was saved.")
    else toast.error(res.error || "Could not save your information.")
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} disabled readOnly />
        <p className="text-xs text-muted-foreground">
          This is your sign-in email. Contact your property manager to change it.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" type="tel" defaultValue={phone ?? ""} required maxLength={40} />
        <p className="text-xs text-muted-foreground">
          Text maintenance requests from this number so we know it&apos;s you.
        </p>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-sm font-medium">Emergency contact</p>
        <div className="space-y-1.5">
          <Label htmlFor="emergency_contact_name">Name</Label>
          <Input
            id="emergency_contact_name"
            name="emergency_contact_name"
            defaultValue={emergencyName ?? ""}
            maxLength={120}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emergency_contact_phone">Phone</Label>
            <Input
              id="emergency_contact_phone"
              name="emergency_contact_phone"
              type="tel"
              defaultValue={emergencyPhone ?? ""}
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergency_contact_relationship">Relationship</Label>
            <Input
              id="emergency_contact_relationship"
              name="emergency_contact_relationship"
              defaultValue={emergencyRelationship ?? ""}
              maxLength={60}
            />
          </div>
        </div>
      </div>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save
      </Button>
    </form>
  )
}
