"use client"
import {useState} from "react"
import {useRouter} from "next/navigation"
import {createClient} from "@/lib/supabase/client"
import {Button} from "@/components/ui/button"
import {Label} from "@/components/ui/label"
import {Textarea} from "@/components/ui/textarea"
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card"
import {WaitingIndicator} from "./waiting-indicator"
import type {MaintenanceRequest} from "@/lib/types"
import {waitingSummary,clearSavedNote} from "@/lib/maintenance-workflow"

export interface RequestActivityEntry {id:string;author_role:string;source:string;kind:string;body:string;created_at:string}
const authors:Record<string,string>={manager:"Management",maintenance:"Maintenance",tenant:"Tenant",bot:"Property HQ"}
const kinds:Record<string,string>={internal_note:"Internal note",request_update:"Request updated",new_request:"Issue reported",request_manager_review:"Manager review requested",add_details:"Details updated",manager_review_note:"Internal manager note",review_followup:"Review follow-up",send_manager_reply:"Manager reply",authorize_manager_request:"Approval recorded",complete_inspection:"Inspection completed",offer_times:"Visit options offered",select_time:"Visit confirmed",request_alternatives:"New visit times requested",start_work:"Work started",report_progress:"Progress update",complete_work:"Work completed",book_visit:"Visit booked",reminder:"Reminder queued",reminder_control:"Reminder preference",emergency:"Emergency report"}
export function RequestActivity({request,entries,timezone="America/Indiana/Indianapolis",hours=24,enabled=true}:{request:MaintenanceRequest;entries:RequestActivityEntry[];timezone?:string;hours?:number;enabled?:boolean}) {
 const router=useRouter(),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("")
 const closed=["completed","cancelled"].includes(request.status)
 const next=waitingSummary(request,{hours,enabled})
 const legacy=request.coordinator_legacy_notes===undefined?request.notes:request.coordinator_legacy_notes
 const time=(value:string)=>new Intl.DateTimeFormat("en-US",{timeZone:timezone,dateStyle:"medium",timeStyle:"short"}).format(new Date(value))
 async function control(name:string,args:Record<string,unknown>) {
  setBusy(true);setMessage("")
  try {const {error}=await createClient().rpc(name,args);if(error)throw error;setMessage("Saved.");router.refresh()}
  catch {setMessage("Could not save this change. Please try again.")}
  finally {setBusy(false)}
 }
 return <div className="space-y-6">
  <Card><CardHeader><CardTitle>Next action</CardTitle></CardHeader><CardContent className="space-y-4">
   <WaitingIndicator request={request} hours={hours} enabled={enabled}/>
   {next.since&&<p className="text-sm text-muted-foreground">Waiting since {time(next.since)} ({timezone})</p>}
   {!closed&&<>
    <p className="text-sm text-muted-foreground">{enabled?`Follow-up interval: ${hours} hours, during working hours. No more than two reminders for the same pending action.`:"Automatic follow-up reminders are off in Settings."}</p>
    <Button variant="outline" disabled={busy} onClick={()=>control("maintenance_pause_followups",{p_request:request.id,p_paused:!request.coordinator_reminders_paused})}>{request.coordinator_reminders_paused?"Resume reminders":"Pause reminders"}</Button>
    {request.coordinator_review_status==="awaiting_tenant_response"&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={request.coordinator_tenant_reply_required??false} disabled={busy} onChange={e=>control("maintenance_require_tenant_reply",{p_request:request.id,p_required:e.target.checked})}/><span>Tenant response needed<span className="block text-xs text-muted-foreground">Turn this on to follow up on a required answer. Leave it off for optional offers or quotes.</span></span></label>}
   </>}
   <p role="status" className="text-sm">{message}</p>
  </CardContent></Card>
  <Card><CardHeader><CardTitle>Notes and activity</CardTitle></CardHeader><CardContent className="space-y-6">
   <form className="space-y-3" onSubmit={async e=>{
    e.preventDefault();if(!note.trim())return;setBusy(true);setMessage("")
    try {const {error}=await createClient().rpc("maintenance_add_note",{p_request:request.id,p_body:note});if(error)throw error;setNote(current=>clearSavedNote(current,note));setMessage("Internal note saved.");router.refresh()}
    catch {setMessage("Could not save the note. Your text is still here; please try again.")}
    finally {setBusy(false)}
   }}>
    <Label htmlFor="request-note">Add an internal note</Label>
    <Textarea id="request-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={4000} rows={3} placeholder="Record a decision, repair detail, part needed or next step…" required/>
    <p className="text-xs text-muted-foreground">Visible to management. Saving a note does not send a text.</p>
    <Button disabled={busy||!note.trim()}>Save note</Button>
   </form>
   <ol className="space-y-5" aria-label="Request activity">
    {entries.map(entry=><li key={entry.id} className="border-l-2 border-border pl-4">
     <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm"><span className="font-medium">{authors[entry.author_role]??"Property HQ"}</span><span className="text-muted-foreground">{kinds[entry.kind]??"Request update"}</span></div>
     <time dateTime={entry.created_at} className="text-xs text-muted-foreground">{time(entry.created_at)}</time>
     <p className="mt-1 whitespace-pre-wrap break-words text-sm">{entry.body}</p>
    </li>)}
   </ol>
   {!entries.length&&!legacy&&<p className="text-sm text-muted-foreground">No notes recorded yet.</p>}
   {entries.length===100&&<p className="text-xs text-muted-foreground">Showing the latest 100 entries.</p>}
   {legacy&&<details className="border-t pt-4"><summary className="cursor-pointer text-sm text-muted-foreground">Earlier notes</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{legacy}</p></details>}
  </CardContent></Card>
 </div>
}
