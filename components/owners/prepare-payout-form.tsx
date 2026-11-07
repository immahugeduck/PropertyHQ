"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { recordOwnerPayout } from "@/app/actions/owner-payouts"
import { netPayout, type Settlement } from "@/lib/owner-settlement"

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? 0 : Number(v))

export function PreparePayoutForm({
  ownerId,
  settlement,
  today,
}: {
  ownerId: string
  settlement: Settlement
  today: string
}) {
  const router = useRouter()
  const [leasingFee, setLeasingFee] = useState(String(settlement.leasingFee))
  const [managementFee, setManagementFee] = useState(String(settlement.managementFee))
  const [adjustment, setAdjustment] = useState("0")
  const [busy, setBusy] = useState(false)

  const net = netPayout(settlement, {
    leasingFee: num(leasingFee),
    managementFee: num(managementFee),
    adjustment: num(adjustment),
  })
  const changed = net !== settlement.suggestedPayout

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    const res = await recordOwnerPayout(new FormData(form))
    setBusy(false)
    if (res.ok) {
      toast.success(`Payout of ${money(net)} recorded`)
      router.refresh()
    } else {
      toast.error(res.error || "Could not record the payout.")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="owner_id" value={ownerId} />
      <input type="hidden" name="through_date" value={settlement.through} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="leasing_fee">Leasing fee ($)</Label>
          <Input id="leasing_fee" name="leasing_fee" type="number" min="0" step="0.01"
            value={leasingFee} onChange={(e) => setLeasingFee(e.target.value)} />
          <p className="text-xs text-muted-foreground">Suggested {money(settlement.leasingFee)}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="management_fee">Management fee ($)</Label>
          <Input id="management_fee" name="management_fee" type="number" min="0" step="0.01"
            value={managementFee} onChange={(e) => setManagementFee(e.target.value)} />
          <p className="text-xs text-muted-foreground">Suggested {money(settlement.managementFee)}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="adjustment">Adjustment (+/−)</Label>
          <Input id="adjustment" name="adjustment" type="number" step="0.01"
            value={adjustment} onChange={(e) => setAdjustment(e.target.value)} />
          <p className="text-xs text-muted-foreground">Needs a note below</p>
        </div>
      </div>

      <div className="rounded-lg bg-muted/50 p-3">
        <p className="text-sm text-muted-foreground">Amount to pay the owner</p>
        <p className="text-2xl font-bold tabular-nums">{money(net)}</p>
        {changed && (
          <p className="text-xs text-muted-foreground">
            {net > settlement.suggestedPayout ? "More" : "Less"} than suggested by{" "}
            {money(Math.abs(net - settlement.suggestedPayout))}. This is saved with the payout.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="payout_date">Date paid</Label>
          <Input required id="payout_date" name="payout_date" type="date" defaultValue={today} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payment_method">Payment method</Label>
          <Input required id="payment_method" name="payment_method" placeholder="Check / ACH / cash" maxLength={80} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="reference_number">Reference (optional)</Label>
          <Input id="reference_number" name="reference_number" placeholder="Check # or transaction reference (no account numbers)" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" placeholder="Why anything differs from the suggestion" />
      </div>

      <p className="text-xs text-muted-foreground">
        Record this after you&apos;ve actually sent the money. Property HQ doesn&apos;t move funds. Recorded payouts
        can&apos;t be edited; void and re-record to fix a mistake.
      </p>
      <Button type="submit" disabled={busy || net <= 0}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Record payout of {money(net)}
      </Button>
    </form>
  )
}
