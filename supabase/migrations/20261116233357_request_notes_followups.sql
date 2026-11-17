-- Internal request history, a shared next-action state and capped follow-ups.
-- Existing requests start their follow-up clock at rollout; no historical SMS.
begin;
alter table public.maintenance_requests
 add column coordinator_waiting_on text check(coordinator_waiting_on in ('tenant','maintenance','manager')),
 add column coordinator_waiting_reason text,
 add column coordinator_waiting_since timestamptz,
 add column coordinator_waiting_token uuid,
 add column coordinator_reminders_paused boolean not null default false,
 add column coordinator_tenant_reply_required boolean not null default false,
 add column coordinator_legacy_notes text;
update public.maintenance_requests set coordinator_legacy_notes=notes;

create table public.maintenance_request_activity(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null references public.maintenance_requests(id) on delete cascade,
 author_role text not null check(author_role in ('tenant','maintenance','manager','bot')),
 source text not null check(source in ('sms','dashboard','system')),
 kind text not null,body text not null check(length(btrim(body)) between 1 and 8000),
 event_key text,created_at timestamptz not null default now(),
 unique(user_id,request_id,event_key)
);
create index maintenance_request_activity_history on public.maintenance_request_activity(user_id,request_id,created_at,id);
alter table public.maintenance_request_activity enable row level security;
create policy maintenance_request_activity_read on public.maintenance_request_activity for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.maintenance_request_activity from anon,authenticated;
grant select on public.maintenance_request_activity to authenticated;
grant all on public.maintenance_request_activity to service_role;

create table public.maintenance_followup_settings(
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 reminder_hours integer not null default 24 check(reminder_hours between 1 and 168)
);
alter table public.maintenance_followup_settings enable row level security;
create policy maintenance_followup_settings_read on public.maintenance_followup_settings for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.maintenance_followup_settings from anon,authenticated;
grant select on public.maintenance_followup_settings to authenticated;
grant all on public.maintenance_followup_settings to service_role;

create function public.coordinator_refresh_waiting(p_user uuid,p_request uuid,p_now timestamptz default now(),p_progress boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare m public.maintenance_requests;a public.coordinator_appointments;actor text;reason text;since_at timestamptz;
begin
 select * into m from public.maintenance_requests where user_id=p_user and id=p_request for update;
 if not found then return;end if;
 select * into a from public.coordinator_appointments where user_id=p_user and request_id=p_request;
 if m.status in ('completed','cancelled') then reason:='closed';
 elsif m.coordinator_review_status='awaiting_manager_response' then actor:='manager';reason:='manager_review';
 elsif m.coordinator_review_status='awaiting_tenant_response' then actor:='tenant';reason:=case when m.coordinator_tenant_reply_required then 'tenant_response' else 'tenant_optional' end;
 elsif a.stage='awaiting_selection' and exists(select 1 from jsonb_array_elements(a.options) o where (o->>'start')::timestamptz>p_now) then actor:='tenant';reason:='visit_options';
 elsif m.tenant_id is null or public.coordinator_review_tenant_phone(p_user,p_request) is null then actor:='manager';reason:='contact_verification';
 elsif m.urgency='emergency' and (m.scheduled_at is null or a.stage is distinct from 'confirmed') then actor:='manager';reason:='emergency_followup';
 elsif m.coordinator_details->'entryPermission'='false'::jsonb and not m.coordinator_attended_access then actor:='manager';reason:='access_plan';
 elsif m.coordinator_details->'entryPermission' is distinct from 'true'::jsonb and not m.coordinator_attended_access then actor:='tenant';reason:='entry_permission';
 elsif a.stage in ('rescheduling','awaiting_selection') then actor:='maintenance';reason:='schedule_visit';
 -- Property HQ can save an exact visit directly without an SMS appointment row.
 elsif m.scheduled_at>p_now then reason:='scheduled';
 elsif m.status='in_progress' or m.scheduled_at<=p_now then actor:='maintenance';reason:='visit_update';
 else actor:='maintenance';reason:='schedule_visit';end if;
 if m.coordinator_waiting_token is null or m.coordinator_waiting_on is distinct from actor or m.coordinator_waiting_reason is distinct from reason
  or (p_progress and actor is not null and reason<>'tenant_optional') then
  since_at:=case when reason='visit_update' and m.coordinator_waiting_reason='scheduled' then greatest(m.scheduled_at,m.coordinator_waiting_since) else p_now end;
  update public.maintenance_requests set coordinator_waiting_on=actor,coordinator_waiting_reason=reason,
   coordinator_waiting_since=case when actor is null then null else since_at end,coordinator_waiting_token=gen_random_uuid()
   where user_id=p_user and id=p_request;
 end if;
end $$;
revoke all on function public.coordinator_refresh_waiting(uuid,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.coordinator_refresh_waiting(uuid,uuid,timestamptz,boolean) to service_role;

create function public.coordinator_waiting_request_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.coordinator_manager_reply is distinct from old.coordinator_manager_reply then
  new.coordinator_tenant_reply_required:=false;
 end if;
 if tg_op='INSERT' then new.coordinator_legacy_notes:=new.notes;end if;
 return new;
end $$;
create trigger coordinator_waiting_before_request before insert or update of coordinator_manager_reply on public.maintenance_requests for each row execute function public.coordinator_waiting_request_trigger();

create function public.coordinator_waiting_after_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and auth.uid()=new.user_id and (old.status is distinct from new.status or old.scheduled_at is distinct from new.scheduled_at or old.scheduled_date is distinct from new.scheduled_date) then
  insert into public.maintenance_request_activity(user_id,request_id,author_role,source,kind,body)
  values(new.user_id,new.id,'manager','dashboard','request_update',case when old.status is distinct from new.status then 'Status changed to '||replace(new.status,'_',' ')||'. ' else '' end||case when old.scheduled_at is distinct from new.scheduled_at or old.scheduled_date is distinct from new.scheduled_date then 'Visit schedule updated.' else '' end);
 end if;
 perform public.coordinator_refresh_waiting(new.user_id,new.id);
 return new;
end $$;
create trigger coordinator_waiting_after_request after insert or update of status,scheduled_at,scheduled_date,coordinator_review_status,coordinator_details,coordinator_attended_access,tenant_id,coordinator_tenant_reply_required on public.maintenance_requests for each row execute function public.coordinator_waiting_after_request();
create function public.coordinator_waiting_after_appointment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.coordinator_refresh_waiting(coalesce(new.user_id,old.user_id),coalesce(new.request_id,old.request_id));return coalesce(new,old);
end $$;
-- Portal inspection guards update appointments inside a request BEFORE trigger.
-- Refresh only after that enclosing request write has completed.
create constraint trigger coordinator_waiting_after_appointment after insert or update or delete on public.coordinator_appointments deferrable initially deferred for each row execute function public.coordinator_waiting_after_appointment();
revoke all on function public.coordinator_waiting_request_trigger(),public.coordinator_waiting_after_request(),public.coordinator_waiting_after_appointment() from public,anon,authenticated;

create function public.coordinator_record_activity(p_user uuid,p_request uuid,p_from text,p_event text,p_index integer,p_kind text,p_body text,p_progress boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings;role_name text;
begin
 select * into strict s from public.triage_settings where user_id=p_user;
 if not exists(select 1 from public.maintenance_requests where user_id=p_user and id=p_request) then raise exception 'request unavailable';end if;
 role_name:=case when public.normalize_us_phone(p_from)=public.normalize_us_phone(s.manager_phone) then 'manager' when public.normalize_us_phone(p_from)=public.normalize_us_phone(s.maintenance_phone) then 'maintenance' else 'tenant' end;
 insert into public.maintenance_request_activity(user_id,request_id,author_role,source,kind,body,event_key)
 values(p_user,p_request,role_name,'sms',p_kind,left(p_body,8000),p_event||':'||p_index::text) on conflict(user_id,request_id,event_key) do nothing;
 if found then perform public.coordinator_refresh_waiting(p_user,p_request,now(),p_progress);end if;
end $$;
revoke all on function public.coordinator_record_activity(uuid,uuid,text,text,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.coordinator_record_activity(uuid,uuid,text,text,integer,text,text,boolean) to service_role;

create function public.maintenance_add_note(p_request uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();note_id uuid;
begin
 if owner_id is null or not exists(select 1 from public.maintenance_requests where id=p_request and user_id=owner_id) then raise exception 'request unavailable';end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 4000 then raise exception 'note must contain 1 to 4000 characters';end if;
 insert into public.maintenance_request_activity(user_id,request_id,author_role,source,kind,body) values(owner_id,p_request,'manager','dashboard','internal_note',btrim(p_body)) returning id into note_id;
 return note_id;
end $$;
create function public.maintenance_pause_followups(p_request uuid,p_paused boolean) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();m public.maintenance_requests;
begin
 select * into m from public.maintenance_requests where id=p_request and user_id=owner_id for update;
 if not found or p_paused is null then raise exception 'request unavailable';end if;
 if m.coordinator_reminders_paused is distinct from p_paused then
  update public.maintenance_requests set coordinator_reminders_paused=p_paused,coordinator_waiting_since=case when coordinator_waiting_on is not null then now() else null end,coordinator_waiting_token=gen_random_uuid() where id=p_request and user_id=owner_id;
  insert into public.maintenance_request_activity(user_id,request_id,author_role,source,kind,body) values(owner_id,p_request,'manager','dashboard','reminder_control',case when p_paused then 'Follow-up reminders paused.' else 'Follow-up reminders resumed. The waiting interval starts again now.' end);
 end if;
end $$;
create function public.maintenance_require_tenant_reply(p_request uuid,p_required boolean) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();m public.maintenance_requests;
begin
 select * into m from public.maintenance_requests where id=p_request and user_id=owner_id for update;
 if not found or p_required is null or m.coordinator_review_status is distinct from 'awaiting_tenant_response' then raise exception 'request unavailable or no manager reply';end if;
 update public.maintenance_requests set coordinator_tenant_reply_required=p_required where id=p_request and user_id=owner_id;
end $$;
create function public.maintenance_save_followup_settings(p_enabled boolean,p_hours integer) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
 if owner_id is null then raise exception 'signed-in owner required';end if;
 if p_enabled is null or p_hours is null or p_hours not between 1 and 168 then raise exception 'reminder interval must be 1 to 168 hours';end if;
 insert into public.maintenance_followup_settings(user_id,enabled,reminder_hours) values(owner_id,p_enabled,p_hours) on conflict(user_id) do update set enabled=excluded.enabled,reminder_hours=excluded.reminder_hours;
end $$;
revoke all on function public.maintenance_add_note(uuid,text),public.maintenance_pause_followups(uuid,boolean),public.maintenance_require_tenant_reply(uuid,boolean),public.maintenance_save_followup_settings(boolean,integer) from public,anon;
grant execute on function public.maintenance_add_note(uuid,text),public.maintenance_pause_followups(uuid,boolean),public.maintenance_require_tenant_reply(uuid,boolean),public.maintenance_save_followup_settings(boolean,integer) to authenticated;

create or replace function public.coordinator_commit(p_user uuid,p_from text,p_sid text,p_version integer,p_message text,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings; conv public.coordinator_conversations; tid uuid; prop uuid;
 staff boolean; a jsonb; f jsonb; typ text; job public.maintenance_requests; ap public.coordinator_appointments;
 choice integer; opt jsonb; fact_patch jsonb; start_time timestamptz; end_time timestamptz; tenant_phone text; text_body text; tenant_text text;
 target uuid; reply_job uuid; target_phone text; prior jsonb; action_index integer:=0;
 facts_changed boolean; entry_changed boolean; unchanged_entry boolean; dispatch_kind text; notify_maintenance boolean; maintenance_update text;
 command text[]; candidate_count integer; manager_only boolean;
begin
 if p_sid is null or p_sid='' or length(p_message)>8000 then raise exception 'invalid event'; end if;
 p_from:=public.normalize_us_phone(p_from);
 if p_from is null then raise exception 'invalid phone'; end if;
 -- Serialize an account's job and appointment changes; also protects conflict checks.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into strict s from public.triage_settings where user_id=p_user;
 if public.normalize_us_phone(s.maintenance_phone) is null or public.normalize_us_phone(s.manager_phone) is null or right(public.normalize_us_phone(s.maintenance_phone),4)<>'9030' or right(public.normalize_us_phone(s.manager_phone),4)<>'6088' then raise exception 'staff configuration mismatch'; end if;
 select decision into prior from public.coordinator_events where sid=p_sid and user_id=p_user and phone=p_from;
 if found then return jsonb_build_object('duplicate',true); end if;
 insert into public.coordinator_conversations(user_id,phone) values(p_user,p_from) on conflict do nothing;
 select * into strict conv from public.coordinator_conversations where user_id=p_user and phone=p_from for update;
 if conv.version<>p_version then raise exception 'conversation changed; retry' using errcode='40001'; end if;
 tid:=public.coordinator_tenant(p_user,p_from);
 select property_id into prop from public.tenants where id=tid and user_id=p_user;
 staff:=p_from in (public.normalize_us_phone(s.maintenance_phone),public.normalize_us_phone(s.manager_phone));
 if jsonb_typeof(p_decision->'actions')<>'array' or jsonb_array_length(p_decision->'actions')>2 then raise exception 'invalid actions'; end if;
 -- Quietly discard malformed completion attempts before any alternate action.
 -- Preserve genuine emergency escalation and retain only audit/version records.
 if coalesce(staff,false)
  and public.coordinator_completion_command(p_message) is null
  and btrim(p_message,E' \t\r\n')~*'^(?:done|finished|complete(?:d)?|fixed|resolved|all set)(?:\y|(?=[0-9_]))|^(?:(?:job|request)\s+)?#?[0-9]+[ \t]+(?:is[ \t]+)?(?:done|finished|complete(?:d)?|fixed|resolved)(?:\y|(?=[0-9_]))'
  and not exists(select 1 from jsonb_array_elements(p_decision->'actions') as pending_action(value) where pending_action.value->>'type'='emergency') then
  p_decision:=jsonb_build_object('reply','','actions','[]'::jsonb,'nextState',coalesce(conv.state,'{}'::jsonb),'ignoredCompletion',true);
 end if;
 insert into public.coordinator_events(user_id,phone,sid,tenant_id,message,decision) values(p_user,p_from,p_sid,tid,p_message,p_decision);
 for a in select value from jsonb_array_elements(p_decision->'actions') loop
  action_index:=action_index+1; typ:=a->>'type';f:=coalesce(a->'fields','{}');
  fact_patch:=public.coordinator_clean_facts(f->'facts');
  facts_changed:=false;entry_changed:=false;unchanged_entry:=false;notify_maintenance:=true;
  if coalesce(staff,false) then fact_patch:=fact_patch-'entryPermission'-'availability'; end if;
  manager_only:=p_from=public.normalize_us_phone(s.manager_phone);
  -- Staff notes retain their author; a manager comment is never a tenant preference.
  if typ='add_details' and coalesce(manager_only,false) then typ:='manager_review_note';fact_patch:='{}'::jsonb;end if;
  if typ in ('send_manager_reply','authorize_manager_request','manager_review_note') and not coalesce(manager_only,false) then raise exception 'manager only';end if;
  if typ='complete_inspection' and not coalesce(staff,false) then raise exception 'staff only';end if;
  if typ in ('approve_contact','unlink_contact','offer_times','start_work','report_progress','complete_work','book_visit') and not coalesce(staff,false) then raise exception 'staff only'; end if;
  if typ='staff_event' then
   if not coalesce(staff,false) then raise exception 'staff only';end if;
   start_time:=(f->>'appointmentStart')::timestamptz;end_time:=(f->>'appointmentEnd')::timestamptz;
   if length(trim(coalesce(f->>'eventTitle','')))=0 or length(f->>'eventTitle')>1500 or start_time is null or end_time is null or start_time<=now() or end_time<=start_time or end_time-start_time>interval '24 hours' then raise exception 'invalid staff event';end if;
   if exists(select 1 from public.coordinator_staff_events where user_id=p_user and staff_phone=p_from and status='confirmed' and start_at<end_time and end_at>start_time)
    or (p_from=public.normalize_us_phone(s.maintenance_phone) and exists(select 1 from public.coordinator_appointments where user_id=p_user and stage<>'completed' and start_at<end_time and end_at>start_time)) then raise exception 'calendar conflict';end if;
   insert into public.coordinator_staff_events(user_id,staff_phone,title,start_at,end_at) values(p_user,p_from,trim(f->>'eventTitle'),start_time,end_time);
  elsif typ='request_scheduling' then
   select * into strict job from public.maintenance_requests where id=(a->>'jobId')::uuid and user_id=p_user and (coalesce(staff,false) or tenant_id=tid);
   if job.coordinator_review_status in ('awaiting_manager_response','awaiting_tenant_response') then raise exception 'manager review and approval required';end if;
   perform public.coordinator_refresh_suggestions(p_user,job.id);
   perform public.coordinator_queue_maintenance(p_user,job.id,p_sid);
  elsif typ in ('approve_contact','unlink_contact') then
   target_phone:=public.normalize_us_phone(f->>'phone');target:=(f->>'tenantId')::uuid;
   if target_phone is null or target_phone in (public.normalize_us_phone(s.manager_phone),public.normalize_us_phone(s.maintenance_phone)) then raise exception 'invalid contact';end if;
   if typ='approve_contact' then
    if not exists(select 1 from public.tenants where id=target and user_id=p_user and status='active') then raise exception 'tenant not found';end if;
    if not exists(select 1 from public.coordinator_conversations where user_id=p_user and phone=target_phone and state ? 'name' and state ? 'address') then raise exception 'no pending contact';end if;
    insert into public.coordinator_contacts(user_id,phone,tenant_id,verified_by,verified_at) values(p_user,target_phone,target,p_from,now()) on conflict(user_id,phone) do update set tenant_id=excluded.tenant_id,revoked=false,verified_by=excluded.verified_by,verified_at=now();
    update public.coordinator_events set tenant_id=target where user_id=p_user and phone=target_phone and tenant_id is null;
    update public.sms_messages set tenant_id=target where user_id=p_user and (from_number=target_phone or to_number=target_phone) and tenant_id is null;
   else
    insert into public.coordinator_contacts(user_id,phone,revoked,verified_by,verified_at) values(p_user,target_phone,true,p_from,now()) on conflict(user_id,phone) do update set tenant_id=null,revoked=true,verified_by=p_from,verified_at=now();
   end if;
   update public.coordinator_outbox set status='cancelled' where user_id=p_user and to_number=target_phone and tenant_id is not null and status='queued';
  elsif typ in ('pending_note','request_link_approval') then
   insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,
    case when typ='request_link_approval' then 'Contact approval needed: '||p_from||'. Name: '||coalesce(f->>'name','')||'. Address: '||coalesce(f->>'address','')||'. Confirm identity in PropertyHQ, then reply: approve '||p_from||' tenant <tenant UUID>.' else 'Pending contact '||p_from||': '||left(p_message,1000) end);
  elsif typ='request_manager_review' then
   if tid is null or prop is null or coalesce(staff,false) then raise exception 'verified tenant required';end if;
   insert into public.maintenance_requests(user_id,property_id,tenant_id,title,description,coordinator_category,coordinator_details,category,urgency,status,source,coordinator_review_status)
   values(p_user,prop,tid,'Property change request (SMS)',coalesce(f->>'description',p_message),'manager_review',fact_patch,'general','medium','open','sms','awaiting_manager_response') returning * into job;
   insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id)
   values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,public.coordinator_review_prompt(p_user,job.id),job.id);
  elsif typ in ('send_manager_reply','authorize_manager_request','manager_review_note','review_followup','complete_inspection') then
   select * into strict job from public.maintenance_requests where id=(a->>'jobId')::uuid and user_id=p_user and (coalesce(staff,false) or tenant_id=tid) for update;
   if typ in ('complete_work','complete_inspection') then
    command:=public.coordinator_completion_command(p_message);
    if command is null or (command[1] is not null and command[1] is distinct from job.job_number::text) then continue;end if;
   end if;
   if job.status in ('completed','cancelled') then raise exception 'request is closed';end if;
   tenant_phone:=public.coordinator_review_tenant_phone(p_user,job.id);
   if typ in ('send_manager_reply','authorize_manager_request') then
    if typ='send_manager_reply' then
     command:=regexp_match(p_message,'^\s*SEND(?:\s+#([0-9]{4,}))?:[ \t]?(.*)$','is');
     if command is null or command[2]!~'\S' or length(command[2])>1600 or f->>'body' is distinct from command[2] then raise exception 'exact reply wording/payload required within 1600 characters';end if;
    else
     command:=regexp_match(p_message,'^\s*APPROVE\s+(INSPECTION|WORK)(?:\s+#([0-9]{4,}))?[.! ]*$','i');
     if command is null or lower(command[1]) is distinct from f->>'scope' or job.coordinator_review_status is null then raise exception 'explicit manager approval command required';end if;
     command:=array[command[2],lower(command[1])];
    end if;
    if command[1] is not null and command[1]<>job.job_number::text then raise exception 'request number mismatch';end if;
    if command[1] is null then
     select count(*) into candidate_count from public.maintenance_requests where user_id=p_user and status not in ('completed','cancelled');
     if candidate_count<>1 then raise exception 'ambiguous reply; include request number';end if;
    end if;
    if tenant_phone is null then raise exception 'verified tenant contact required';end if;
   end if;
   if typ='send_manager_reply' then
    update public.maintenance_requests set coordinator_manager_reply=command[2],coordinator_review_status=case when coordinator_review_status in ('awaiting_manager_response','awaiting_tenant_response') then 'awaiting_tenant_response' else coordinator_review_status end where id=job.id and user_id=p_user;
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,tenant_id,request_id)
    values(p_user,p_sid,action_index::text,tenant_phone,s.twilio_number,command[2],job.tenant_id,job.id);
   elsif typ='authorize_manager_request' then
    update public.maintenance_requests set coordinator_review_status=case command[2] when 'inspection' then 'inspection_authorized' else 'work_authorized' end where id=job.id and user_id=p_user returning * into job;
    perform public.coordinator_refresh_suggestions(p_user,job.id,true);
    perform public.coordinator_queue_maintenance(p_user,job.id,p_sid,'scope');
    tenant_text:=case command[2] when 'inspection' then 'Your property manager approved an inspection only. Maintenance will coordinate a visit.' else 'Your property manager approved the work. Maintenance will coordinate a visit.' end;
    if job.coordinator_details->'entryPermission'='false'::jsonb then tenant_text:=case command[2] when 'inspection' then 'Your property manager approved an inspection only.' else 'Your property manager approved the work.' end||' Your property manager will help arrange access before maintenance is notified.';end if;
    if jsonb_typeof(job.coordinator_details->'entryPermission') is distinct from 'boolean' then tenant_text:=case command[2] when 'inspection' then 'Your property manager approved an inspection only.' else 'Your property manager approved the work.' end||' Before I send it to maintenance, does maintenance have permission to enter if nobody is home?';end if;
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,tenant_id,request_id)
    values(p_user,p_sid,action_index::text,tenant_phone,s.twilio_number,tenant_text,job.tenant_id,job.id);
   elsif typ='review_followup' then
    if coalesce(staff,false) or tid is distinct from job.tenant_id or job.coordinator_review_status not in ('awaiting_manager_response','awaiting_tenant_response') or job.coordinator_review_status is null then raise exception 'tenant follow-up requires pending manager review';end if;
    update public.maintenance_requests set coordinator_details=public.coordinator_merge_facts(coordinator_details,fact_patch) where id=job.id and user_id=p_user;
    if f->'notifyManager' is distinct from 'false'::jsonb then
     update public.maintenance_requests set coordinator_review_status='awaiting_manager_response' where id=job.id and user_id=p_user;
     insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id)
     values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,public.coordinator_review_prompt(p_user,job.id,p_message),job.id);
    end if;
   elsif typ='complete_inspection' then
    if job.coordinator_review_status is distinct from 'inspection_authorized' then raise exception 'inspection authorization required';end if;
    update public.coordinator_appointments set stage='completed',options='[]'::jsonb,selected=null,proposal_version=proposal_version+1 where request_id=job.id and user_id=p_user;
    update public.maintenance_requests set coordinator_review_status='awaiting_manager_response',scheduled_at=null,scheduled_date=null,coordinator_attended_access=false,status='open',coordinator_details=case when coordinator_details->'entryPermission'='true'::jsonb then coordinator_details-'entryPermission' else coordinator_details end where id=job.id and user_id=p_user;
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id)
    values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,public.coordinator_review_prompt(p_user,job.id,coalesce(f->>'description',p_message)),job.id);
    if tenant_phone is not null then
     insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,tenant_id,request_id)
     values(p_user,p_sid,action_index::text,tenant_phone,s.twilio_number,'Maintenance has completed the inspection. Your property manager will review the findings before any work is arranged. If anything else comes up let us know, thank you. Have a good day!',job.tenant_id,job.id);
    end if;
   end if;
   update public.maintenance_requests set notes=concat_ws(E'\n',notes,'['||now()::text||'] '||typ||': '||p_message) where id=job.id and user_id=p_user;
  elsif typ in ('new_request','emergency') then
   if typ='new_request' and (tid is null or prop is null or staff) then raise exception 'verified tenant required';end if;
   if typ='emergency' and a->>'jobId' is not null then
    select * into strict job from public.maintenance_requests where id=(a->>'jobId')::uuid and user_id=p_user and tenant_id=tid and status<>'completed' and coordinator_category=f->>'category';
    update public.maintenance_requests set urgency='emergency',notes=concat_ws(E'\n',notes,p_message) where id=job.id and user_id=p_user;
   elsif tid is not null and prop is not null and not coalesce(staff,false) then
    insert into public.maintenance_requests(user_id,property_id,tenant_id,title,description,coordinator_category,coordinator_details,category,urgency,status,source)
    values(p_user,prop,tid,case when typ='emergency' then 'Emergency report (SMS)' else 'Maintenance request (SMS)' end,coalesce(f->>'description',p_message),f->>'category',fact_patch,'general',case when typ='emergency' then 'emergency' else 'medium' end,'open','sms') returning * into job;
   end if;
   insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,
    case when typ='emergency' then 'EMERGENCY' else 'New request' end||coalesce(' #'||job.job_number::text,'')||' from '||coalesce((select concat_ws(' ',t.first_name,t.last_name) from public.tenants t where t.id=tid and t.user_id=p_user),'unverified contact')||' '||p_from||coalesce(' at '||(select p.address from public.properties p where p.id=prop and p.user_id=p_user),'')||': '||left(p_message,1000));
  elsif typ in ('add_details','offer_times','select_time','request_alternatives','start_work','report_progress','complete_work','book_visit') then
   select * into strict job from public.maintenance_requests where id=(a->>'jobId')::uuid and user_id=p_user and (coalesce(staff,false) or tenant_id=tid) for update;
   if typ in ('complete_work','complete_inspection') then
    command:=public.coordinator_completion_command(p_message);
    if command is null or (command[1] is not null and command[1] is distinct from job.job_number::text) then continue;end if;
   end if;
   -- A repeated completion with a new inbound SID must not notify again.
   if typ='complete_work' and job.status='completed' then continue;end if;
   if job.coordinator_review_status in ('awaiting_manager_response','awaiting_tenant_response') then raise exception 'manager review and approval required';end if;
   if typ='complete_work' and job.coordinator_review_status='inspection_authorized' then raise exception 'record inspection completion for manager review';end if;
   select case when public.coordinator_tenant(p_user,coalesce(c.phone,t.phone_e164))=job.tenant_id then coalesce(c.phone,t.phone_e164) else null end into tenant_phone from public.tenants t left join lateral(select b.phone from public.coordinator_contacts b where b.user_id=p_user and b.tenant_id=t.id and not b.revoked order by b.verified_at desc limit 1)c on true where t.id=job.tenant_id and t.user_id=p_user;
   select public.coordinator_merge_facts(job.coordinator_details,fact_patch) is distinct from job.coordinator_details into facts_changed;
   entry_changed:=fact_patch ? 'entryPermission' and job.coordinator_details->'entryPermission' is distinct from fact_patch->'entryPermission';
   -- Keep uncertain clarifications and repeated unchanged entry answers in the
   -- manager's context; they must not restart maintenance scheduling.
   if typ='add_details' and not coalesce(staff,false) then
    unchanged_entry:=fact_patch ? 'entryPermission' and fact_patch-array['entryPermission','accessNotes']='{}'::jsonb and not facts_changed;
    notify_maintenance:=not ((f->>'notifyMaintenance'='false' and fact_patch='{}'::jsonb)
     or (fact_patch ? 'entryPermission' and fact_patch-array['entryPermission','accessNotes']='{}'::jsonb and not facts_changed));
    notify_maintenance:=coalesce(notify_maintenance,true);
   end if;
   if fact_patch<>'{}'::jsonb then update public.maintenance_requests set coordinator_details=public.coordinator_merge_facts(coordinator_details,fact_patch),coordinator_attended_access=case when entry_changed and fact_patch->'entryPermission'='false'::jsonb then false else coordinator_attended_access end where id=job.id and user_id=p_user returning * into job;end if;
   if typ='book_visit' then
    if (job.coordinator_details->>'entryPermission')::boolean is distinct from true then raise exception 'entry permission required';end if;
    if job.status in ('completed','cancelled') or jsonb_typeof(f->'options') is distinct from 'array' or jsonb_array_length(f->'options')<>1 then raise exception 'one exact visit required';end if;
    opt:=f->'options'->0;start_time:=(opt->>'start')::timestamptz;end_time:=(opt->>'end')::timestamptz;
    if start_time is null or end_time is null or start_time<=now() or end_time<=start_time or end_time-start_time>interval '8 hours' or coalesce((opt->>'flexible')::boolean,false) then raise exception 'invalid exact visit';end if;
    select * into ap from public.coordinator_appointments where request_id=job.id and user_id=p_user for update;
    if f->>'proposalVersion' is not null and (ap.stage is distinct from 'awaiting_staff' or ap.proposal_version is distinct from (f->>'proposalVersion')::integer or ap.options is distinct from coalesce(f->'proposalOptions',f->'options') or (ap.options @> (f->'options')) is distinct from true) then raise exception 'stale suggestion';end if;
    if not public.coordinator_slot_free(p_user,start_time,end_time,job.id) then raise exception 'appointment unavailable';end if;
    insert into public.coordinator_appointments(request_id,user_id,options,proposal_version,selected,stage,start_at,end_at) values(job.id,p_user,f->'options',1,1,'confirmed',start_time,end_time)
    on conflict(request_id) do update set options=excluded.options,proposal_version=public.coordinator_appointments.proposal_version+1,selected=1,stage='confirmed',start_at=excluded.start_at,end_at=excluded.end_at;
    update public.maintenance_requests set scheduled_at=start_time,scheduled_date=(start_time at time zone s.timezone)::date,coordinator_attended_access=false where id=job.id and user_id=p_user;
    text_body:='Confirmed #'||job.job_number||' for '||to_char(start_time at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||' ('||s.timezone||'). Entry permitted while nobody is home.';
   elsif typ='offer_times' then
    if f->>'proposalVersion' is not null then
     select * into ap from public.coordinator_appointments where request_id=job.id and user_id=p_user for update;
     if ap.stage is distinct from 'awaiting_staff' or ap.proposal_version is distinct from (f->>'proposalVersion')::integer or ap.options is distinct from f->'options' then raise exception 'stale suggestion';end if;
     for opt in select value from jsonb_array_elements(f->'options') loop if not public.coordinator_slot_free(p_user,(opt->>'start')::timestamptz,(opt->>'end')::timestamptz,job.id) then raise exception 'appointment unavailable';end if;end loop;
    end if;
    if jsonb_typeof(f->'options')<>'array' or jsonb_array_length(f->'options') not in (1,2,3) then raise exception 'one to three options required';end if;
    for opt in select value from jsonb_array_elements(f->'options') loop
     start_time:=(opt->>'start')::timestamptz;end_time:=(opt->>'end')::timestamptz;
     if start_time is null or end_time is null or start_time<=now() or end_time<=start_time or end_time-start_time>(case when (opt->>'flexible')::boolean is true then interval '24 hours' else interval '8 hours' end) then raise exception 'invalid option';end if;
    end loop;
    insert into public.coordinator_appointments(request_id,user_id,options,proposal_version,stage) values(job.id,p_user,f->'options',1,'awaiting_selection') on conflict(request_id) do update set options=excluded.options,proposal_version=public.coordinator_appointments.proposal_version+1,stage='awaiting_selection';
    -- Keep prior confirmed slot occupied until rescheduling is confirmed.
    select * into ap from public.coordinator_appointments where request_id=job.id;
    text_body:='Maintenance can stop by for the '||public.coordinator_repair_label(job.title,job.coordinator_details)||'. Which time works for you? ';
    choice:=0;
    for opt in select value from jsonb_array_elements(ap.options) loop
     choice:=choice+1;
     text_body:=text_body||choice::text||') '||case when (opt->>'flexible')::boolean is true and opt->>'label' is not null then left(opt->>'label',200)||'. ' else to_char((opt->>'start')::timestamptz at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||'–'||to_char((opt->>'end')::timestamptz at time zone s.timezone,'HH12:MI AM')||' ('||s.timezone||'). ' end;
    end loop;
    text_body:=text_body||case when choice=1 then 'Let me know if that works for you' else 'Let me know which works best' end||', or if we should find another time.'||case when job.coordinator_details->'entryPermission' is null then ' Does maintenance have permission to enter if nobody is home?' else '' end;
   elsif typ='select_time' then
    if coalesce(staff,false) then raise exception 'tenant selection required';end if;
    select * into strict ap from public.coordinator_appointments where request_id=job.id and user_id=p_user for update;
    choice:=(f->>'choice')::integer;
    if ap.stage<>'awaiting_selection' or ap.proposal_version is distinct from (f->>'proposalVersion')::integer or choice is null or choice<1 or choice>jsonb_array_length(ap.options) then raise exception 'stale choice';end if;
    opt:=ap.options->(choice-1);start_time:=(opt->>'start')::timestamptz;end_time:=(opt->>'end')::timestamptz;
    if (opt->>'flexible')::boolean is true then
     if f->>'appointmentStart' is null or f->>'appointmentEnd' is null then raise exception 'exact time required for broad availability';end if;
     if (f->>'appointmentStart')::timestamptz<start_time or (f->>'appointmentEnd')::timestamptz>end_time or (f->>'appointmentEnd')::timestamptz<=(f->>'appointmentStart')::timestamptz then raise exception 'outside offered availability';end if;
     start_time:=(f->>'appointmentStart')::timestamptz;end_time:=(f->>'appointmentEnd')::timestamptz;
    elsif (f->>'appointmentStart' is not null and (f->>'appointmentStart')::timestamptz<>start_time) or (f->>'appointmentEnd' is not null and (f->>'appointmentEnd')::timestamptz<>end_time) then raise exception 'cannot change exact offered time';
    end if;
    if start_time<=now() or not public.coordinator_slot_free(p_user,start_time,end_time,job.id) then raise exception 'appointment unavailable';end if;
    update public.coordinator_appointments set selected=choice,stage='confirmed',start_at=start_time,end_at=end_time where request_id=job.id;
    update public.maintenance_requests set scheduled_at=start_time,scheduled_date=(start_time at time zone s.timezone)::date,coordinator_attended_access=coordinator_details->'entryPermission' is distinct from 'true'::jsonb where id=job.id and user_id=p_user;
    text_body:='Confirmed #'||job.job_number||' for '||to_char(start_time at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||' ('||s.timezone||').';
   elsif typ='request_alternatives' then
    update public.coordinator_appointments set stage='rescheduling',options='[]'::jsonb,selected=null,proposal_version=proposal_version+1 where request_id=job.id and user_id=p_user;
    text_body:='New options needed for #'||job.job_number||': '||coalesce(f->>'description',p_message);
   elsif typ in ('start_work','complete_work') then
    update public.maintenance_requests set status=case when typ='start_work' then 'in_progress' else 'completed' end where id=job.id and user_id=p_user;
    if typ='complete_work' then update public.coordinator_appointments set stage='completed' where request_id=job.id and user_id=p_user;end if;
    text_body:='Request #'||job.job_number||case when typ='start_work' then ': work is now in progress.' else ' is completed. Please reply if anything still needs attention.' end;
   else
    text_body:='Update for #'||job.job_number||': '||coalesce(f->>'description',p_message);
   end if;
   update public.maintenance_requests set notes=concat_ws(E'\n',notes,'['||now()::text||'] '||typ||': '||coalesce(f->>'description',p_message)) where id=job.id and user_id=p_user;
   -- Keep staff audit references separate from the tenant conversation.
   tenant_text:=case typ
    when 'book_visit' then 'You’re scheduled for '||to_char(start_time at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||' ('||s.timezone||') for the '||public.coordinator_repair_label(job.title,job.coordinator_details)||'. You’ve given maintenance permission to enter while nobody is home. I’ll keep you updated here.'
    when 'offer_times' then text_body
    when 'start_work' then 'Maintenance is getting started on the '||public.coordinator_repair_label(job.title,job.coordinator_details)||'. I’ll keep you updated here.'
    when 'complete_work' then 'Maintenance has finished the '||public.coordinator_repair_label(job.title,job.coordinator_details)||' work. If anything else comes up let us know, thank you. Have a good day!'
    when 'report_progress' then 'Here’s the latest on the '||public.coordinator_repair_label(job.title,job.coordinator_details)||': '||regexp_replace(coalesce(f->>'description',p_message),'^\s*#?'||job.job_number::text||'([[:space:]]*[:—-][[:space:]]*|[[:space:]]+|$)','','i')
    else null end;
   if typ in ('offer_times','start_work','report_progress','complete_work','book_visit') and tenant_phone is not null then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,tenant_id) values(p_user,p_sid,action_index::text,tenant_phone,s.twilio_number,tenant_text,job.tenant_id) on conflict do nothing;
   end if;
   if typ<>'offer_times' and not unchanged_entry and public.normalize_us_phone(s.manager_phone)<>p_from then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,text_body) on conflict do nothing;
   end if;
  else raise exception 'invalid action';
  end if;
  if job.id is not null and typ in ('new_request','add_details') and not coalesce(staff,false) then perform public.coordinator_refresh_suggestions(p_user,job.id,entry_changed);end if;
  if job.id is not null and typ in ('new_request','add_details','select_time','request_alternatives','book_visit') and notify_maintenance and public.normalize_us_phone(s.maintenance_phone)<>p_from then
   dispatch_kind:=case when typ in ('select_time','book_visit') then 'confirmed' when typ='request_alternatives' then 'schedule'
    when typ='add_details' and fact_patch ?| array['entryPermission','accessNotes','availability'] and fact_patch-array['entryPermission','accessNotes','availability']='{}'::jsonb then 'access'
    when typ='add_details' then 'repair' else 'request' end;
   perform public.coordinator_queue_maintenance(p_user,job.id,p_sid,dispatch_kind,case when dispatch_kind in ('repair','schedule') then p_message end);
  end if;
  if job.id is not null and typ not in ('request_manager_review','send_manager_reply','authorize_manager_request','manager_review_note','review_followup','complete_inspection') then
   maintenance_update:=case
    when typ='add_details' and (fact_patch='{}'::jsonb or fact_patch-array['entryPermission','accessNotes','availability']<>'{}'::jsonb) then coalesce(f->>'description',p_message)
    when typ='request_alternatives' then coalesce(f->>'description',p_message)
    else null end;
   update public.coordinator_outbox set
    schedule_proposal=case when to_number=public.normalize_us_phone(s.maintenance_phone) then public.coordinator_suggestion_snapshot(p_user,job.id) else null end,
    body=case when to_number=public.normalize_us_phone(s.maintenance_phone) then
     public.coordinator_work_order(p_user,job.id,maintenance_update)
     ||case when typ in ('new_request','add_details') and not coalesce(staff,false) then E'\n'||public.coordinator_scheduling_note(p_user,job.id)
       when typ='request_alternatives' then E'\nNew visit times needed.'
       when typ in ('select_time','book_visit') then E'\nVisit confirmed. Please keep us updated.' else '' end
     else body||E'\n'||public.coordinator_job_summary(p_user,job.id) end
    where event_sid=p_sid and user_id=p_user and action_key=action_index::text and to_number in (public.normalize_us_phone(s.manager_phone),public.normalize_us_phone(s.maintenance_phone));
  end if;
  if job.id is not null then update public.coordinator_outbox set request_id=job.id where event_sid=p_sid and user_id=p_user and action_key=action_index::text; end if;
  if job.id is not null and typ in ('new_request','request_manager_review','emergency','add_details','send_manager_reply','authorize_manager_request','manager_review_note','review_followup','complete_inspection','offer_times','select_time','request_alternatives','start_work','report_progress','complete_work','book_visit') then
   perform public.coordinator_record_activity(p_user,job.id,p_from,p_sid,action_index,typ,p_message,
    typ in ('start_work','report_progress','request_alternatives','select_time','book_visit','authorize_manager_request','complete_inspection') or (typ='review_followup' and coalesce((f->>'notifyManager')::boolean,false)));
  end if;
 end loop;
 update public.coordinator_conversations set version=version+1,state=coalesce(p_decision->'nextState','{}') || case when job.id is not null then jsonb_build_object('activeJobId',job.id) else '{}'::jsonb end where user_id=p_user and phone=p_from;
 reply_job:=job.id;
 if reply_job is null and p_decision->>'replyJobId' is not null then
  select id into reply_job from public.maintenance_requests where id=(p_decision->>'replyJobId')::uuid and user_id=p_user and (coalesce(staff,false) or tenant_id=tid);
  if reply_job is null then raise exception 'reply request unavailable';end if;
 end if;
 insert into public.sms_messages(user_id,direction,channel,party,kind,from_number,to_number,body,twilio_sid,tenant_id,maintenance_request_id)
 values(p_user,'inbound','sms',case when staff then case when p_from=public.normalize_us_phone(s.manager_phone) then 'manager' else 'maintenance' end when tid is not null then 'tenant' else 'unknown' end,'message',p_from,s.twilio_number,p_message,p_sid,tid,reply_job);
 -- Response record represents prepared TwiML, not proof of carrier delivery.
 insert into public.sms_messages(user_id,direction,channel,party,kind,from_number,to_number,body,tenant_id,maintenance_request_id,status)
 values(p_user,'outbound','sms',case when staff then case when p_from=public.normalize_us_phone(s.manager_phone) then 'manager' else 'maintenance' end when tid is not null then 'tenant' else 'unknown' end,'message',s.twilio_number,p_from,p_decision->>'reply',tid,reply_job,'prepared');
 return jsonb_build_object('applied',true,'duplicate',false,'version',conv.version+1);
end $$;

-- Initialize current requests without a historical reminder backlog.
do $$declare m record;begin for m in select user_id,id from public.maintenance_requests loop perform public.coordinator_refresh_waiting(m.user_id,m.id);end loop;end$$;
alter table public.coordinator_outbox
 add column followup_token uuid,
 add column followup_number integer check(followup_number between 1 and 2),
 add column followup_attempted_at timestamptz,
 add constraint coordinator_followup_identity check((followup_token is null and followup_number is null) or (followup_token is not null and followup_number is not null));
create unique index coordinator_followup_once on public.coordinator_outbox(user_id,request_id,followup_token,followup_number) where followup_token is not null;

create function public.coordinator_followup_hours(p_user uuid,p_now timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((
  extract(isodow from ((p_now at time zone s.timezone)-case when s.close_time<=s.open_time and (p_now at time zone s.timezone)::time<s.close_time then interval '1 day' else interval '0 day' end))::integer=any(s.open_days)
  and case when s.close_time>s.open_time then (p_now at time zone s.timezone)::time>=s.open_time and (p_now at time zone s.timezone)::time<s.close_time
   else (p_now at time zone s.timezone)::time>=s.open_time or (p_now at time zone s.timezone)::time<s.close_time end
 ),false) from public.triage_settings s where s.user_id=p_user;
$$;

create function public.coordinator_followup_valid(p_user uuid,p_outbox uuid,p_now timestamptz default now(),p_delivery boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select
  o.status='queued' and m.status in ('open','in_progress') and o.followup_token=m.coordinator_waiting_token
  and m.coordinator_waiting_on is not null and m.coordinator_waiting_reason not in ('tenant_optional','scheduled','closed')
  and not m.coordinator_reminders_paused and coalesce(fs.enabled,true)
  and p_now>=m.coordinator_waiting_since+make_interval(hours=>coalesce(fs.reminder_hours,24))
  and o.from_number=s.twilio_number
  and o.to_number=case m.coordinator_waiting_on when 'manager' then public.normalize_us_phone(s.manager_phone) when 'maintenance' then public.normalize_us_phone(s.maintenance_phone) else public.coordinator_review_tenant_phone(p_user,m.id) end
  and (m.coordinator_waiting_on<>'tenant' or (o.tenant_id=m.tenant_id and public.coordinator_tenant(p_user,o.to_number)=m.tenant_id))
  and (not p_delivery or public.coordinator_followup_hours(p_user,p_now))
  -- An unsent original prompt must not be followed by another prompt in one batch.
  and not exists(select 1 from public.coordinator_outbox original where original.user_id=p_user and original.request_id=m.id and original.to_number=o.to_number and original.followup_token is null and original.status in ('queued','sending'))
  -- If an original prompt was delivered late, give its recipient a full interval.
  and not exists(select 1 from public.coordinator_outbox original join public.sms_messages sent on sent.user_id=original.user_id and sent.twilio_sid=original.provider_sid and sent.direction='outbound'
   where original.user_id=p_user and original.request_id=m.id and original.to_number=o.to_number and original.followup_token is null and sent.created_at>p_now-make_interval(hours=>coalesce(fs.reminder_hours,24)))
  and (o.followup_number=1 or exists(select 1 from public.coordinator_outbox first_prompt where first_prompt.user_id=p_user and first_prompt.request_id=m.id and first_prompt.followup_token=o.followup_token and first_prompt.followup_number=1 and first_prompt.status in ('sent','uncertain') and first_prompt.followup_attempted_at<=p_now-make_interval(hours=>coalesce(fs.reminder_hours,24))))
 from public.coordinator_outbox o join public.maintenance_requests m on m.id=o.request_id and m.user_id=o.user_id
 join public.triage_settings s on s.user_id=m.user_id left join public.maintenance_followup_settings fs on fs.user_id=m.user_id
 where o.id=p_outbox and o.user_id=p_user and o.followup_token is not null),false);
$$;

create function public.coordinator_followup_attempt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.followup_token is not null and new.status in ('sending','sent','uncertain') and old.status='queued' then new.followup_attempted_at:=coalesce(new.followup_attempted_at,now());end if;
 return new;
end $$;
create trigger coordinator_followup_attempt before update of status on public.coordinator_outbox for each row execute function public.coordinator_followup_attempt();

create function public.coordinator_enqueue_followups(p_user uuid,p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare m public.maintenance_requests;s public.triage_settings;fs public.maintenance_followup_settings;first_prompt public.coordinator_outbox;
 request_row record;n integer;recipient text;body_text text;label_text text;reminder_event text;out_id uuid;affected integer:=0;hours_wait integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into s from public.triage_settings where user_id=p_user;if not found then return 0;end if;
 select * into fs from public.maintenance_followup_settings where user_id=p_user;hours_wait:=coalesce(fs.reminder_hours,24);
 for request_row in select id from public.maintenance_requests where user_id=p_user and status in ('open','in_progress') loop perform public.coordinator_refresh_waiting(p_user,request_row.id,p_now);end loop;
 update public.coordinator_outbox o set status='cancelled' where o.user_id=p_user and o.status='queued' and o.followup_token is not null and not public.coordinator_followup_valid(p_user,o.id,p_now);
 if not coalesce(fs.enabled,true) or not coalesce(public.coordinator_followup_hours(p_user,p_now),false) then return 0;end if;
 for m in select * from public.maintenance_requests where user_id=p_user and status in ('open','in_progress') and coordinator_waiting_on is not null and coordinator_waiting_reason<>'tenant_optional' and not coordinator_reminders_paused and coordinator_waiting_since<=p_now-make_interval(hours=>hours_wait) order by coordinator_waiting_since,id loop
  recipient:=case m.coordinator_waiting_on when 'manager' then public.normalize_us_phone(s.manager_phone) when 'maintenance' then public.normalize_us_phone(s.maintenance_phone) else public.coordinator_review_tenant_phone(p_user,m.id) end;
  if recipient is null then continue;end if;
  select * into first_prompt from public.coordinator_outbox where user_id=p_user and request_id=m.id and followup_token=m.coordinator_waiting_token and followup_number=1;
  if not found or (first_prompt.status in ('queued','cancelled') and first_prompt.provider_sid is null and first_prompt.followup_attempted_at is null) then n:=1;
  elsif first_prompt.status in ('sent','uncertain') and first_prompt.followup_attempted_at<=p_now-make_interval(hours=>hours_wait) then n:=2;
  else continue;end if;
  label_text:=public.coordinator_repair_label(m.title,m.coordinator_details);
  body_text:=case m.coordinator_waiting_reason
   when 'entry_permission' then 'Following up on the '||label_text||': does maintenance have permission to enter if nobody is home?'
   when 'visit_options' then 'Following up on the '||label_text||': which of the visit options we sent works for you? Reply with the option number, or ask for different times.'
   when 'tenant_response' then 'Following up on the '||label_text||': your property manager is waiting for your answer to their last message. Please reply here when you can.'
   when 'manager_review' then 'Reminder: '||public.coordinator_review_prompt(p_user,m.id)
   when 'access_plan' then 'Reminder #'||m.job_number||': an attended access plan is needed for '||label_text||'. Please coordinate visit options with the tenant. Unattended entry is not granted.'
   when 'contact_verification' then 'Reminder #'||m.job_number||': confirm the tenant contact in Property HQ before further messaging.'
   when 'emergency_followup' then 'Follow-up #'||m.job_number||': please review the emergency request and record the next action in Property HQ.'
   when 'visit_update' then 'Visit follow-up #'||m.job_number||' for '||label_text||': please send a progress update, or reply DONE #'||m.job_number||' when finished.'
   else 'Scheduling follow-up #'||m.job_number||' for '||label_text||': please send a confirmed visit time or current openings.' end;
  reminder_event:='followup:'||m.id::text||':'||m.coordinator_waiting_token::text||':'||n::text;
  out_id:=null;
  insert into public.coordinator_outbox(user_id,request_id,event_sid,action_key,to_number,from_number,body,tenant_id,followup_token,followup_number)
  values(p_user,m.id,reminder_event,'followup',recipient,s.twilio_number,body_text,case when m.coordinator_waiting_on='tenant' then m.tenant_id end,m.coordinator_waiting_token,n)
  on conflict(user_id,request_id,followup_token,followup_number) where followup_token is not null
  do update set status='queued',body=excluded.body,to_number=excluded.to_number,from_number=excluded.from_number,tenant_id=excluded.tenant_id
   where public.coordinator_outbox.status in ('queued','cancelled') and public.coordinator_outbox.provider_sid is null and public.coordinator_outbox.followup_attempted_at is null
    and (public.coordinator_outbox.status='cancelled' or public.coordinator_outbox.body is distinct from excluded.body or public.coordinator_outbox.to_number is distinct from excluded.to_number or public.coordinator_outbox.from_number is distinct from excluded.from_number)
  returning id into out_id;
  if out_id is not null then
   if public.coordinator_followup_valid(p_user,out_id,p_now) then
    affected:=affected+1;
    insert into public.maintenance_request_activity(user_id,request_id,author_role,source,kind,body,event_key)
    values(p_user,m.id,'bot','system','reminder','Follow-up reminder queued for '||m.coordinator_waiting_on||'.',reminder_event) on conflict(user_id,request_id,event_key) do nothing;
   else update public.coordinator_outbox set status='cancelled' where id=out_id;end if;
  end if;
 end loop;
 return affected;
end $$;
revoke all on function public.coordinator_followup_hours(uuid,timestamptz),public.coordinator_followup_valid(uuid,uuid,timestamptz,boolean),public.coordinator_followup_attempt(),public.coordinator_enqueue_followups(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.coordinator_followup_hours(uuid,timestamptz),public.coordinator_followup_valid(uuid,uuid,timestamptz,boolean),public.coordinator_enqueue_followups(uuid,timestamptz) to service_role;

create or replace function public.coordinator_claim_outbox(p_user uuid) returns setof public.coordinator_outbox
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 -- Drop obsolete check-ins before discovering current due visits.
 update public.coordinator_outbox o set status='cancelled' where o.user_id=p_user and o.status='queued' and o.visit_checkin_at is not null
  and not exists(select 1 from public.triage_settings s where s.user_id=p_user and o.to_number=public.normalize_us_phone(s.maintenance_phone) and o.from_number=s.twilio_number and public.coordinator_visit_checkin_valid(p_user,o.request_id,o.visit_checkin_at,now()));
 perform public.coordinator_enqueue_visit_checkins(p_user);
 perform public.coordinator_enqueue_followups(p_user);
 update public.coordinator_outbox set status='cancelled' where user_id=p_user and status='queued' and tenant_id is not null and public.coordinator_tenant(p_user,to_number) is distinct from tenant_id;
 return query update public.coordinator_outbox set status='sending' where id in (
  select o.id from public.coordinator_outbox o where o.user_id=p_user and o.status='queued'
   and (o.followup_token is null or public.coordinator_followup_valid(p_user,o.id,now(),true))
   and not exists(
    select 1 from public.maintenance_requests m join public.triage_settings s on s.user_id=m.user_id
    where m.id=o.request_id and m.user_id=p_user and o.to_number=public.normalize_us_phone(s.maintenance_phone)
     and m.urgency is distinct from 'emergency' and m.coordinator_details->'entryPermission' is distinct from 'true'::jsonb
     and not (m.coordinator_attended_access and exists(select 1 from public.coordinator_appointments a where a.request_id=m.id and a.user_id=p_user and a.stage='confirmed' and a.start_at=m.scheduled_at))
     and not exists(select 1 from public.coordinator_outbox prior where prior.user_id=p_user and prior.request_id=m.id and prior.to_number=o.to_number and prior.status in ('sent','sending','uncertain'))
   )
  order by o.created_at,o.id limit 2 for update of o skip locked
 ) returning *;
end $$;
commit;
