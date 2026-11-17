"use client"
import {useState} from "react"
import {useRouter} from "next/navigation"
import {createClient} from "@/lib/supabase/client"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card"

export function MaintenanceFollowupSettings({settings}:{settings:{enabled:boolean;reminder_hours:number}|null}) {
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("")
 return <Card><CardHeader><CardTitle>Maintenance follow-ups</CardTitle></CardHeader><CardContent>
  <form className="space-y-4" onSubmit={async e=>{
   e.preventDefault();const data=new FormData(e.currentTarget);setBusy(true);setMessage("")
   try {const {error}=await createClient().rpc("maintenance_save_followup_settings",{p_enabled:data.get("enabled")==="on",p_hours:Number(data.get("hours"))});if(error)throw error;setMessage("Maintenance follow-up settings saved.");router.refresh()}
   catch {setMessage("Could not save these settings. Please try again.")}
   finally {setBusy(false)}
  }}>
   <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={settings?.enabled??true}/>Send reminders when a required response stalls</label>
   <div className="space-y-2"><Label htmlFor="followup-hours">Waiting interval (hours)</Label><Input id="followup-hours" name="hours" type="number" min={1} max={168} required defaultValue={settings?.reminder_hours??24}/></div>
   <p className="text-sm text-muted-foreground">Only the person whose response is needed receives the reminder. Texts respect your configured working days, hours and time zone. A second reminder waits another full interval; there are never more than two for the same pending action.</p>
   <p className="text-sm text-muted-foreground">Pause reminders on a request when waiting for a part or an expected delay. Optional manager offers are followed up only when you mark “Tenant response needed.”</p>
   <Button disabled={busy}>Save maintenance follow-ups</Button><p role="status" className="text-sm">{message}</p>
  </form>
 </CardContent></Card>
}
