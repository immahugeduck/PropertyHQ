"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
export function DeletePaymentButton({ id }: { id: string }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  return <div><Button variant="destructive" size="sm" disabled={busy} onClick={async () => {
    if (!window.confirm("Delete this payment record? This removes it from financial totals.")) return
    setBusy(true)
    const { error } = await createClient().from("rent_payments").delete().eq("id",id)
    if (error) { setError(error.message); setBusy(false) } else router.refresh()
  }}>Delete</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>
}
