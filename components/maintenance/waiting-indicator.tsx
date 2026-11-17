import {Badge} from "@/components/ui/badge"
import {waitingSummary,type RequestWaiting} from "@/lib/maintenance-workflow"

export function WaitingIndicator({request,hours=24,enabled=true}:{request:RequestWaiting;hours?:number;enabled?:boolean}) {
 const next=waitingSummary(request,{hours,enabled})
 return <div className="mt-2 space-y-1">
  <div className="flex flex-wrap items-center gap-2">
   <Badge variant="outline" className={next.stalled?"border-orange-500/40 text-orange-600 dark:text-orange-400":"text-muted-foreground"}>{next.label}</Badge>
   {next.stalled&&<span className="text-xs text-orange-600 dark:text-orange-400">Needs follow-up</span>}
   {request.coordinator_reminders_paused&&<span className="text-xs text-muted-foreground">Reminders paused</span>}
  </div>
  <p className="text-xs text-muted-foreground">{next.nextAction}</p>
 </div>
}
