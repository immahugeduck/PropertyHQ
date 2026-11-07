-- Deleting a maintenance job failed (409) once the text coordinator had queued
-- or sent a message for it, because coordinator_outbox and
-- coordinator_appointments referenced the job with no ON DELETE rule.
-- Match sms_messages: texts are history, so keep them and clear the link; an
-- appointment only exists for its job, so it goes with the job.

alter table public.coordinator_outbox
  drop constraint if exists coordinator_outbox_request_id_fkey,
  add constraint coordinator_outbox_request_id_fkey
    foreign key (request_id) references public.maintenance_requests(id) on delete set null;

alter table public.coordinator_appointments
  drop constraint if exists coordinator_appointments_request_id_fkey,
  add constraint coordinator_appointments_request_id_fkey
    foreign key (request_id) references public.maintenance_requests(id) on delete cascade;
