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
import { Receipt, Building2, DollarSign, FileText, Info, Tag, Store } from "lucide-react"
import type { Expense, Property } from "@/lib/types"

interface ExpenseFormProps {
  expense?: Expense
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
      <div className="pl-11">
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

const categories = [
  { value: "repairs", label: "Repairs & Maintenance", description: "Fixing things that break" },
  { value: "utilities", label: "Utilities", description: "Water, electric, gas, internet" },
  { value: "insurance", label: "Insurance", description: "Property or liability insurance" },
  { value: "taxes", label: "Property Taxes", description: "Annual or quarterly taxes" },
  { value: "management", label: "Management Fees", description: "Property management costs" },
  { value: "supplies", label: "Supplies", description: "Cleaning supplies, tools, etc." },
  { value: "landscaping", label: "Landscaping", description: "Lawn care, gardening" },
  { value: "cleaning", label: "Cleaning", description: "Professional cleaning services" },
  { value: "other", label: "Other", description: "Miscellaneous expenses" },
]

export function ExpenseForm({ expense, properties, userId, defaultPropertyId }: ExpenseFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!expense

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const propertyId = formData.get("property_id") as string
    
    const data = {
      user_id: userId,
      property_id: propertyId === "none" ? null : propertyId,
      category: formData.get("category") as string,
      description: formData.get("description") as string,
      amount: parseFloat(formData.get("amount") as string) || 0,
      date: formData.get("date") as string,
      vendor: (formData.get("vendor") as string) || null,
      notes: (formData.get("notes") as string) || null,
      paid_by: formData.get("paid_by") === "owner" ? "owner" : "manager",
      updated_at: new Date().toISOString(),
    }

    const supabase = createClient()

    if (isEditing) {
      const { error: updateError } = await supabase
        .from("expenses")
        .update(data)
        .eq("id", expense.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
    } else {
      const { error: insertError } = await supabase
        .from("expenses")
        .insert(data)

      if (insertError) {
        setError(insertError.message)
        setLoading(false)
        return
      }
    }

    router.push("/dashboard/expenses")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10">
              <Receipt className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>{isEditing ? "Edit Expense" : "Record Expense"}</CardTitle>
              <CardDescription>
                {isEditing
                  ? "Update the expense details. This will be reflected in your reports."
                  : "Track a property expense. This helps calculate net income and informs your reports."}
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

          {/* Expense Details */}
          <FormSection
            icon={FileText}
            title="Expense Details"
            description="Describe what you spent money on. Be specific enough to remember later."
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Input
                  id="description"
                  name="description"
                  placeholder="e.g., Replaced water heater, Quarterly pest control"
                  defaultValue={expense?.description}
                  required
                />
                <FieldHint>What was purchased or what service was performed</FieldHint>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="date">Date *</Label>
                  <Input
                    id="date"
                    name="date"
                    type="date"
                    defaultValue={expense?.date || new Date().toISOString().split("T")[0]}
                    required
                  />
                  <FieldHint>When the expense occurred or was invoiced</FieldHint>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="amount"
                      name="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-7"
                      defaultValue={expense?.amount || ""}
                      required
                    />
                  </div>
                  <FieldHint>Total cost including tax</FieldHint>
                </div>
              </div>
            </div>
          </FormSection>

          {/* Category */}
          <FormSection
            icon={Tag}
            title="Category"
            description="Categorize this expense for accurate reporting and tax purposes."
          >
            <div className="space-y-2">
              <Label htmlFor="category">Expense Category *</Label>
              <Select name="category" defaultValue={expense?.category || "repairs"}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex flex-col">
                        <span>{cat.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>Choose the category that best fits this expense</FieldHint>
            </div>
          </FormSection>

          {/* Property & Vendor */}
          <FormSection
            icon={Building2}
            title="Property & Vendor"
            description="Link this expense to a specific property and record the vendor for your records."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="property_id">Property</Label>
                <Select 
                  name="property_id" 
                  defaultValue={expense?.property_id || defaultPropertyId || "none"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General / Not Property-Specific</SelectItem>
                    {properties.map((property) => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldHint>Leave as general for business-wide expenses</FieldHint>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor / Payee</Label>
                <Input
                  id="vendor"
                  name="vendor"
                  placeholder="e.g., Home Depot, ABC Plumbing"
                  defaultValue={expense?.vendor || ""}
                />
                <FieldHint>Who you paid for this expense</FieldHint>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="paid_by">Who paid?</Label>
              <Select name="paid_by" defaultValue={expense?.paid_by || "manager"}>
                <SelectTrigger id="paid_by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">I paid it — deduct from the owner&apos;s payout</SelectItem>
                  <SelectItem value="owner">Owner paid the vendor directly — record only</SelectItem>
                </SelectContent>
              </Select>
              <FieldHint>Owner-paid expenses show on their statement but aren&apos;t deducted again</FieldHint>
            </div>
          </FormSection>

          {/* Notes */}
          <FormSection
            icon={Store}
            title="Additional Notes"
            description="Add any extra details like receipt numbers, warranty info, or follow-up items."
          >
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="e.g., Receipt #12345, 2-year warranty, scheduled for next year too..."
                defaultValue={expense?.notes || ""}
                rows={3}
              />
              <FieldHint>Optional details for your reference</FieldHint>
            </div>
          </FormSection>

          {/* Actions */}
          <div className="flex gap-4 pt-4 border-t">
            <Button type="submit" disabled={loading} size="lg">
              {loading && <Spinner className="mr-2 h-4 w-4" />}
              {isEditing ? "Save Changes" : "Record Expense"}
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
