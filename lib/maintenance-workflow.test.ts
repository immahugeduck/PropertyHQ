import {describe,it,expect} from "vitest"
import {waitingSummary,clearSavedNote} from "./maintenance-workflow"

describe("request next action",()=>{
 it("preserves a newer draft while clearing the exact note that was saved",()=>{
  expect(clearSavedNote("The supplier has replied.","Waiting for the supplier.")).toBe("The supplier has replied.")
  expect(clearSavedNote("Waiting for the supplier.","Waiting for the supplier.")).toBe("")
 })
 it("distinguishes a stalled maintenance reply from an optional tenant reply and a future visit",()=>{
  const now=new Date("2026-11-18T15:00:00Z")
  expect(waitingSummary({status:"open",coordinator_waiting_on:"maintenance",coordinator_waiting_reason:"schedule_visit",coordinator_waiting_since:"2026-11-16T15:00:00Z"},{now}).stalled).toBe(true)
  const optional=waitingSummary({status:"open",coordinator_waiting_on:"tenant",coordinator_waiting_reason:"tenant_optional",coordinator_waiting_since:"2026-11-16T15:00:00Z"},{now})
  expect(optional.label).toBe("Waiting on tenant (optional)");expect(optional.stalled).toBe(false)
  expect(waitingSummary({status:"in_progress",coordinator_waiting_reason:"scheduled"},{now}).label).toBe("Visit scheduled")
 })
 it("does not mark paused, disabled, closed or invalid-clock requests overdue",()=>{
  const m={status:"open",coordinator_waiting_on:"manager",coordinator_waiting_reason:"manager_review",coordinator_waiting_since:"2026-11-01T12:00:00Z"}
  expect(waitingSummary({...m,coordinator_reminders_paused:true}).stalled).toBe(false)
  expect(waitingSummary(m,{enabled:false}).stalled).toBe(false)
  expect(waitingSummary({...m,status:"completed"}).label).toBe("No response pending")
  expect(waitingSummary({...m,coordinator_waiting_since:"invalid"}).since).toBe(null)
 })
})
