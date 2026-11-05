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
import { Spinner } from "@/components/ui/spinner"
import type { Tenant, RentPayment } from "@/lib/types"
import { notifyPaymentRecorded } from "@/app/actions/notify-payment"

interface PaymentFormProps {
  payment?: RentPayment
  tenants: Tenant[]
  userId: string
  defaultTenantId?: string
}

export function PaymentForm({ tenants, userId, defaultTenantId, payment }: PaymentFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTenantId, setSelectedTenantId] = useState(payment?.tenant_id || defaultTenantId || "")

  // Get selected tenant info
  const selectedTenant = tenants.find(t => t.id === selectedTenantId)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const tenantId = formData.get("tenant_id") as string
    const tenant = tenants.find(t => t.id === tenantId)

    if (!tenant || !tenant.property_id) {
      setError("Selected tenant must be assigned to a property")
      setLoading(false)
      return
    }

    const status = formData.get("status") as string

    const data = {
      user_id: userId,
      tenant_id: tenantId,
      property_id: tenant.property_id,
      amount: parseFloat(formData.get("amount") as string),
      due_date: formData.get("due_date") as string,
      paid_date: (status === "paid" || Number(formData.get("amount_paid")) > 0) ? (formData.get("paid_date") as string) || new Date().toISOString().split("T")[0] : null,
      status: status,
      amount_paid: status === "paid" ? Number(formData.get("amount")) : Number(formData.get("amount_paid") || 0),
      payment_method: (formData.get("payment_method") as string) || null,
      notes: (formData.get("notes") as string) || null,
    }

    const supabase = createClient()

    const query = payment
      ? supabase.from("rent_payments").update(data).eq("id", payment.id).eq("user_id", userId)
      : supabase.from("rent_payments").insert(data)
    const { error: insertError } = await query

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
      return
    }

    // Notify manager of payment received (non-critical, fires and forgets)
    if (!payment && status === "paid" && tenant) {
      notifyPaymentRecorded({
        userId,
        tenantName: `${tenant.first_name} ${tenant.last_name}`,
        amount: parseFloat(formData.get("amount") as string),
        propertyName: tenant.property?.name || "Property",
      })
    }

    router.push("/dashboard/payments")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{payment ? "Edit Payment" : "Record Payment"}</CardTitle>
          <CardDescription>
            Log a rent payment from a tenant
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
              {error}
            </div>
          )}

          {/* Tenant Selection */}
          <div className="space-y-2">
            <Label htmlFor="tenant_id">Tenant</Label>
            <Select
              name="tenant_id"
              value={selectedTenantId}
              onValueChange={setSelectedTenantId}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.filter(t => t.property_id).map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.first_name} {tenant.last_name} - ${tenant.rent_amount}/mo
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTenant && !selectedTenant.property_id && (
              <p className="text-sm text-red-500">
                This tenant is not assigned to a property
              </p>
            )}
          </div>

          {/* Amount and Due Date */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount ($)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                key={selectedTenantId}
                defaultValue={payment?.amount ?? selectedTenant?.rent_amount ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due_date">Due Date</Label>
              <Input
                id="due_date"
                name="due_date"
                type="date"
                defaultValue={payment?.due_date ?? new Date(new Date().getFullYear(), new Date().getMonth(), selectedTenant?.rent_due_day || 1, 12).toISOString().slice(0, 10)}
                key={selectedTenantId}
                required
              />
            </div>
          </div>

          {/* Status and Payment Method */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={payment?.status ?? "paid"}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="overdue">Overdue (calculated)</SelectItem>

                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment_method">Payment Method</Label>
              <Select name="payment_method" defaultValue={payment?.payment_method ?? "bank_transfer"}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount_paid">Amount received (for partial payments)</Label>
            <Input id="amount_paid" name="amount_paid" type="number" min="0" step="0.01" defaultValue={payment?.amount_paid ?? 0} />
            <p className="text-sm text-muted-foreground">Overdue status is calculated from the due date and your grace period. Due dates default to the tenant’s lease billing day.</p>
          </div>
          {/* Paid Date */}
          <div className="space-y-2">
            <Label htmlFor="paid_date">Paid Date (if applicable)</Label>
            <Input
              id="paid_date"
              name="paid_date"
              type="date"
              defaultValue={payment?.paid_date ?? new Date().toISOString().slice(0, 10)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Additional notes..."
              defaultValue={payment?.notes ?? ""}
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <Button type="submit" disabled={loading}>
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              {payment ? "Save Changes" : "Record Payment"}
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
