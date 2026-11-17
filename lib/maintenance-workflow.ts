export interface RequestWaiting {
 status: string
 coordinator_waiting_on?: string|null
 coordinator_waiting_reason?: string|null
 coordinator_waiting_since?: string|null
 coordinator_reminders_paused?: boolean
}
const actions: Record<string,string>={
 entry_permission:"Confirm permission to enter while nobody is home.",
 schedule_visit:"Confirm a visit time or offer current openings.",
 visit_options:"Choose or confirm one of the offered visit times.",
 manager_review:"Review the request and send a decision.",
 tenant_optional:"The manager has replied. The tenant may send new information when ready.",
 tenant_response:"Reply to the manager’s message.",
 access_plan:"Arrange an attended visit with the tenant.",
 contact_verification:"Confirm the tenant’s contact details before messaging.",
 emergency_followup:"Follow up on the emergency report.",
 visit_update:"Send a progress update or confirm completion.",
 scheduled:"The visit is scheduled. Maintenance will receive its visit check-in.",
}
export function waitingSummary(request: RequestWaiting,{now=new Date(),hours=24,enabled=true}:{now?:Date;hours?:number;enabled?:boolean}={}) {
 const closed=["completed","cancelled"].includes(request.status)
 const reason=closed?"closed":request.coordinator_waiting_reason
 const actor=closed?null:request.coordinator_waiting_on
 const parsed=Date.parse(request.coordinator_waiting_since??"")
 const since=actor&&Number.isFinite(parsed)?new Date(parsed).toISOString():null
 const label=closed?"No response pending":reason==="scheduled"?"Visit scheduled":reason==="tenant_optional"?"Waiting on tenant (optional)":actor?`Waiting on ${actor}`:"Next action not recorded"
 const stalled=Boolean(actor&&since&&reason!=="tenant_optional"&&!request.coordinator_reminders_paused&&enabled&&now.getTime()-parsed>=hours*3600000)
 return {label,nextAction:closed?"This request is closed.":actions[reason??""]??"Review this request to determine the next action.",since,stalled}
}
