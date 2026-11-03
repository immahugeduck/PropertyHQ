import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Printer,
  Edit,
  DollarSign,
} from "lucide-react"
import { MarkPaidButton } from "@/components/invoices/mark-paid-button"

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(dateString: string | null) {
  if (!dateString) return "—"
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function invoiceNumber(id: string, createdAt: string) {
  const year = new Date(createdAt).getFullYear()
  const seq = id.replace(/-/g, "").slice(-4).toUpperCase()
  return `PHQ-${year}-${seq}`
}

function invoicePeriod(dueDate: string) {
  const d = new Date(dueDate)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

const statusConfig = {
  paid: { label: "Paid", className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", icon: CheckCircle },
  pending: { label: "Pending", className: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10", icon: Clock },
  overdue: { label: "Overdue", className: "border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/10", icon: AlertCircle },
  partial: { label: "Partial", className: "border-orange-500/30 text-orange-600 dark:text-orange-400 bg-orange-500/10", icon: DollarSign },
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: invoice, error } = await supabase
    .from("payment_balances")
    .select("*, tenant:tenants(id, first_name, last_name, email, phone, lease_start, lease_end), property:properties(id, name, address, city, state, zip_code)")
    .eq("id", id)
    .single()

  if (error || !invoice) notFound()

  const invNum = invoiceNumber(invoice.id, invoice.created_at)
  const period = invoicePeriod(invoice.due_date)
  const cfg = statusConfig[invoice.status as keyof typeof statusConfig] || statusConfig.pending
  const StatusIcon = cfg.icon

  return (
    <div className="space-y-6 pt-12 lg:pt-0 max-w-3xl">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/invoices"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
        <div className="flex gap-2">
          {invoice.status !== "paid" && (
            <MarkPaidButton invoiceId={id} />
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/payments/record?payment=${id}`}>
              <Edit className="mr-1.5 h-4 w-4" />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      {/* Invoice Card */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden print:border-0">
        {/* Invoice Header */}
        <div className="bg-primary px-8 py-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="h-5 w-5 text-primary-foreground/80" />
                <span className="text-primary-foreground font-bold text-lg">Property HQ</span>
              </div>
              <p className="text-primary-foreground/70 text-sm">Professional Property Management</p>
            </div>
            <div className="text-right">
              <p className="text-primary-foreground/70 text-sm uppercase tracking-wide">Invoice</p>
              <p className="text-primary-foreground font-mono font-bold text-xl">{invNum}</p>
              {invoice.is_recurring && (
                <div className="flex items-center gap-1 justify-end mt-1">
                  <RefreshCw className="h-3.5 w-3.5 text-primary-foreground/60" />
                  <span className="text-xs text-primary-foreground/60">Recurring</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Invoice Body */}
        <div className="px-8 py-6 space-y-6">
          {/* Status & Dates */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Badge variant="outline" className={`${cfg.className} px-3 py-1 text-sm`}>
              <StatusIcon className="mr-1.5 h-4 w-4" />
              {cfg.label}
            </Badge>
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Invoice Date</p>
                <p className="font-medium">{formatDate(invoice.created_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Due Date</p>
                <p className="font-medium">{formatDate(invoice.due_date)}</p>
              </div>
              {invoice.paid_date && (
                <div>
                  <p className="text-muted-foreground text-xs">Paid On</p>
                  <p className="font-medium text-emerald-500">{formatDate(invoice.paid_date)}</p>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Bill To / Property */}
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Bill To</p>
              {invoice.tenant ? (
                <div className="space-y-0.5">
                  <p className="font-semibold">{invoice.tenant.first_name} {invoice.tenant.last_name}</p>
                  <p className="text-sm text-muted-foreground">{invoice.tenant.email}</p>
                  {invoice.tenant.phone && <p className="text-sm text-muted-foreground">{invoice.tenant.phone}</p>}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No tenant assigned</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Property</p>
              {invoice.property ? (
                <div className="space-y-0.5">
                  <p className="font-semibold">{invoice.property.name}</p>
                  <p className="text-sm text-muted-foreground">{invoice.property.address}</p>
                  <p className="text-sm text-muted-foreground">{invoice.property.city}, {invoice.property.state} {invoice.property.zip_code}</p>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No property assigned</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Line Items */}
          <div>
            <div className="grid grid-cols-[1fr_120px_120px] gap-4 pb-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Description</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Amount</span>
            </div>
            <div className="grid grid-cols-[1fr_120px_120px] gap-4 py-4 border-b border-border text-sm items-center">
              <div>
                <p className="font-medium">Monthly Rent — {period}</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {invoice.tenant ? `${invoice.tenant.first_name} ${invoice.tenant.last_name}` : "Tenant"} · {invoice.property?.name || "Property"}
                </p>
              </div>
              <p className="text-right">{formatCurrency(invoice.amount)}</p>
              <p className="text-right font-medium">{formatCurrency(invoice.amount)}</p>
            </div>
          </div>

          {/* Total */}
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatCurrency(invoice.amount)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Tax</span>
                <span>$0.00</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(invoice.amount)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Notes</p>
                <p className="text-sm text-muted-foreground">{invoice.notes}</p>
              </div>
            </>
          )}

          {/* Payment method */}
          {invoice.payment_method && (
            <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <span className="text-sm">Paid via <strong>{invoice.payment_method}</strong></span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-8 py-4 bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">
            Generated by Property HQ · Invoice {invNum} · Thank you for your payment.
          </p>
        </div>
      </div>

      {/* Quick nav */}
      <div className="flex gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/tenants/${invoice.tenant_id}`}>
            View Tenant
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/properties/${invoice.property_id}`}>
            View Property
          </Link>
        </Button>
      </div>
    </div>
  )
}
