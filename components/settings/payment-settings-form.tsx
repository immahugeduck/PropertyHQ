"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
export function PaymentSettingsForm({ userId, settings }: { userId: string; settings: { grace_days: number; timezone: string; hide_demo_data: boolean } | null }) {
  const router = useRouter()
  const [message,setMessage] = useState("")
  const [busy,setBusy] = useState(false)
  return <Card><CardHeader><CardTitle>Rent payment rules</CardTitle></CardHeader><CardContent>
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setMessage("")
      const data = new FormData(e.currentTarget)
      const { error } = await createClient().from("payment_settings").upsert({ user_id:userId, grace_days:Number(data.get("grace_days")), timezone:String(data.get("timezone")), hide_demo_data:data.get("hide_demo_data")==="on" })
      setMessage(error?.message ?? "Saved. Dashboard, payments and reports now use these rules.")
      setBusy(false); if (!error) router.refresh()
    }}>
      <div className="space-y-2"><Label htmlFor="grace_days">Grace period (days)</Label><Input id="grace_days" name="grace_days" type="number" min="0" max="30" required defaultValue={settings?.grace_days ?? 0} /></div>
      <p className="text-sm text-muted-foreground">With 0 days, rent due October 1 becomes overdue October 2. With 5 days, it becomes overdue October 7.</p>
      <div className="space-y-2"><Label htmlFor="payment_timezone">Billing time zone</Label><select className="w-full rounded-md border p-2 bg-background" id="payment_timezone" name="timezone" defaultValue={settings?.timezone ?? "America/Indiana/Indianapolis"}>
        {["America/Indiana/Indianapolis","America/New_York","America/Chicago","America/Denver","America/Los_Angeles","UTC"].map(t => <option key={t}>{t}</option>)}
      </select></div>
      <label className="flex items-center gap-2 text-sm"><input name="hide_demo_data" type="checkbox" defaultChecked={settings?.hide_demo_data ?? false} />Hide test/demo tenants and their payments from lists, dashboard and financial reports</label>
      <p className="text-sm text-muted-foreground">Demo records are preserved. Turn this off to review or delete them. Late fees are not charged automatically; record only fees permitted by the lease.</p>
      <Button disabled={busy}>Save payment rules</Button><p role="status" className="text-sm">{message}</p>
    </form>
  </CardContent></Card>
}
