"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { voidOwnerPayout } from "@/app/actions/owner-payouts"

export function VoidPayoutButton({ payoutId }: { payoutId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleVoid() {
    const reason = window.prompt("Why are you voiding this payout? It stays on record, marked void.")
    if (reason === null) return
    setBusy(true)
    const res = await voidOwnerPayout(payoutId, reason)
    setBusy(false)
    if (res.ok) {
      toast.success("Payout voided")
      router.refresh()
    } else {
      toast.error(res.error || "Could not void the payout.")
    }
  }

  return (
    <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-destructive" onClick={handleVoid} disabled={busy}>
      Void
    </Button>
  )
}
