"use client"
import { useState } from "react"
import { saveLeaseBilling } from "@/app/actions/lease-billing"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Lease } from "@/lib/types"
export function LeaseBillingForm({ lease }: { lease:Lease }) {
  const router=useRouter()
  const [message,setMessage]=useState("")
  const [busy,setBusy]=useState(false)
  return <form className="rounded-xl border p-4 space-y-4" onSubmit={async e=>{
    e.preventDefault();setBusy(true)
    const result=await saveLeaseBilling(lease.id,new FormData(e.currentTarget))
    setMessage(result.error || "Billing terms saved. Signing this lease creates its recurring rent schedule.")
    setBusy(false); if (!result.error) router.refresh()
  }}>
    <h2 className="font-semibold">Lease billing terms</h2>
    <p className="text-sm text-muted-foreground">Match these terms to the lease document before sending. Signed leases generate rent only within these dates.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="starts_on">Lease start</Label><Input id="starts_on" name="starts_on" type="date" required defaultValue={lease.starts_on ?? ""} disabled={lease.status!=="draft"} /></div>
      <div><Label htmlFor="ends_on">Lease end</Label><Input id="ends_on" name="ends_on" type="date" required defaultValue={lease.ends_on ?? ""} disabled={lease.status!=="draft"} /></div>
      <div><Label htmlFor="monthly_rent">Monthly rent ($)</Label><Input id="monthly_rent" name="monthly_rent" type="number" min="0.01" step="0.01" required defaultValue={lease.monthly_rent ?? ""} disabled={lease.status!=="draft"} /></div>
      <div><Label htmlFor="rent_due_day">Rent due day (1–28)</Label><Input id="rent_due_day" name="rent_due_day" type="number" min="1" max="28" required defaultValue={lease.rent_due_day ?? 1} disabled={lease.status!=="draft"} /></div>
    </div>
    {lease.status==="draft" && <Button disabled={busy}>Save billing terms</Button>}
    <p role="status" className="text-sm">{message}</p>
  </form>
}
