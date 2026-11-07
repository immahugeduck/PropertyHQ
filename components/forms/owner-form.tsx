"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import type { PropertyOwner } from "@/lib/types"

interface OwnerFormProps {
  owner?: PropertyOwner
  userId: string
}

export function OwnerForm({ owner, userId }: OwnerFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEditing = !!owner

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const fd = new FormData(e.currentTarget)
    const data = {
      user_id: userId,
      first_name: fd.get("first_name") as string,
      last_name: fd.get("last_name") as string,
      email: (fd.get("email") as string) || null,
      phone: (fd.get("phone") as string) || null,
      company_name: (fd.get("company_name") as string) || null,
      address: (fd.get("address") as string) || null,
      city: (fd.get("city") as string) || null,
      state: (fd.get("state") as string) || null,
      zip_code: (fd.get("zip_code") as string) || null,
      notes: (fd.get("notes") as string) || null,
      leasing_fee_pct: Number(fd.get("leasing_fee_pct")),
      management_fee_pct: Number(fd.get("management_fee_pct")),
      updated_at: new Date().toISOString(),
    }
    const pctOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100
    if (!pctOk(data.leasing_fee_pct) || !pctOk(data.management_fee_pct)) {
      setError("Fees must be between 0 and 100 percent.")
      setLoading(false)
      return
    }

    const supabase = createClient()

    if (isEditing) {
      const { error: updateError } = await supabase.from("property_owners").update(data).eq("id", owner.id)
      if (updateError) { setError(updateError.message); setLoading(false); return }
    } else {
      const { error: insertError } = await supabase.from("property_owners").insert(data)
      if (insertError) { setError(insertError.message); setLoading(false); return }
    }

    router.push("/dashboard/owners")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Owner" : "Add Property Owner"}</CardTitle>
          <CardDescription>
            {isEditing ? "Update owner details" : "Enter the owner's contact and company information"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 text-sm text-destructive-foreground bg-destructive/10 rounded-lg border border-destructive/20">
              {error}
            </div>
          )}

          {/* Name */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name</Label>
              <Input id="first_name" name="first_name" placeholder="John" defaultValue={owner?.first_name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input id="last_name" name="last_name" placeholder="Smith" defaultValue={owner?.last_name} required />
            </div>
          </div>

          {/* Company */}
          <div className="space-y-2">
            <Label htmlFor="company_name">Company / LLC Name (optional)</Label>
            <Input id="company_name" name="company_name" placeholder="Smith Properties LLC" defaultValue={owner?.company_name || ""} />
          </div>

          {/* Contact */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="owner@example.com" defaultValue={owner?.email || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" placeholder="(555) 123-4567" defaultValue={owner?.phone || ""} />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="address">Street Address</Label>
            <Input id="address" name="address" placeholder="123 Main Street" defaultValue={owner?.address || ""} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" placeholder="City" defaultValue={owner?.city || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" placeholder="State" defaultValue={owner?.state || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip_code">ZIP Code</Label>
              <Input id="zip_code" name="zip_code" placeholder="12345" defaultValue={owner?.zip_code || ""} />
            </div>
          </div>

          {/* Fees */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="leasing_fee_pct">Leasing fee (% of a new tenant&apos;s first month)</Label>
              <Input id="leasing_fee_pct" name="leasing_fee_pct" type="number" min="0" max="100" step="0.01" defaultValue={owner?.leasing_fee_pct ?? 50} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="management_fee_pct">Management fee (% of rent collected)</Label>
              <Input id="management_fee_pct" name="management_fee_pct" type="number" min="0" max="100" step="0.01" defaultValue={owner?.management_fee_pct ?? 10} required />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Used to suggest fees when you prepare a payout. You can change the amounts on any payout before recording it.
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" placeholder="Any notes about this owner..." defaultValue={owner?.notes || ""} rows={3} />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              {isEditing ? "Update Owner" : "Add Owner"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
