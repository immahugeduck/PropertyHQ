-- Compact maintenance requests, saved access notes and durable staff request focus.
-- Additive function replacements; existing messages are not replayed.
begin;

create or replace function public.coordinator_clean_facts(p_facts jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}';k text;
begin
 if p_facts is null or jsonb_typeof(p_facts)<>'object' then return result;end if;
 if p_facts->>'issue' in ('washer','screen_door','window_screen','sink_disposal','other') then result:=result||jsonb_build_object('issue',p_facts->>'issue');end if;
 if p_facts->>'leakPattern' in ('only_when_used','continuous','uncertain','none') then result:=result||jsonb_build_object('leakPattern',p_facts->>'leakPattern');end if;
 foreach k in array array['entryPermission','mainDoorSecure','updateWhenHome'] loop
  if jsonb_typeof(p_facts->k)='boolean' then result:=result||jsonb_build_object(k,p_facts->k);end if;
 end loop;
 if jsonb_typeof(p_facts->'availability')='string' and length(trim(p_facts->>'availability'))>0 then result:=result||jsonb_build_object('availability',left(trim(p_facts->>'availability'),500));end if;
 foreach k in array array['repairSummary','accessNotes'] loop
  if jsonb_typeof(p_facts->k)='string' and length(trim(p_facts->>k))>0 then result:=result||jsonb_build_object(k,left(regexp_replace(trim(p_facts->>k),'\s+',' ','g'),case when k='repairSummary' then 240 else 400 end));end if;
 end loop;
 return result;
end $$;

create function public.coordinator_merge_facts(p_saved jsonb,p_patch jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare prior_note text;incoming_note text;
begin
 prior_note:=nullif(trim(p_saved->>'accessNotes'),'');incoming_note:=nullif(trim(p_patch->>'accessNotes'),'');
 if prior_note is not null and incoming_note is not null then
  if strpos(lower(prior_note),lower(incoming_note))>0 then p_patch:=jsonb_set(p_patch,'{accessNotes}',to_jsonb(prior_note));
  elsif strpos(lower(incoming_note),lower(prior_note))=0 then p_patch:=jsonb_set(p_patch,'{accessNotes}',to_jsonb(prior_note||' '||incoming_note));end if;
 end if;
 return coalesce(p_saved,'{}'::jsonb)||coalesce(p_patch,'{}'::jsonb);
end $$;
revoke all on function public.coordinator_merge_facts(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.coordinator_merge_facts(jsonb,jsonb) to service_role;

create or replace function public.coordinator_context(p_to text,p_from text,p_job bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings; tid uuid; is_staff boolean; c public.coordinator_conversations; result jsonb;
begin
 select * into strict s from public.triage_settings where twilio_number=public.normalize_us_phone(p_to);
 p_from:=public.normalize_us_phone(p_from);
 if p_from is null then raise exception 'invalid phone'; end if;
 tid:=public.coordinator_tenant(s.user_id,p_from);
 is_staff:=p_from in (public.normalize_us_phone(s.manager_phone),public.normalize_us_phone(s.maintenance_phone));
 select * into c from public.coordinator_conversations where user_id=s.user_id and phone=p_from;
 select jsonb_build_object(
 'scope',jsonb_build_object('userId',s.user_id,'twilioNumber',s.twilio_number),
 'settings',jsonb_build_object('maintenance_phone',public.normalize_us_phone(s.maintenance_phone),'manager_phone',public.normalize_us_phone(s.manager_phone),'timezone',s.timezone,'open_time',s.open_time,'close_time',s.close_time),
 'state',coalesce(c.state,'{}'), 'version',coalesce(c.version,0),
 'binding',(select to_jsonb(b) from public.coordinator_contacts b where b.user_id=s.user_id and b.phone=p_from),
 'tenants',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'property_id',t.property_id,'first_name',t.first_name,'status',t.status)) from public.tenants t where t.user_id=s.user_id and t.id=tid),'[]'),
 'messages',coalesce((select jsonb_agg(x) from (select case when m.direction='inbound' then m.body end as message,case when m.direction='outbound' then m.body end as reply,m.maintenance_request_id as "jobId",m.created_at,case when is_staff then (select o.schedule_proposal from public.coordinator_outbox o where m.status like 'outbox:'||o.id::text||':%' limit 1) else null end as "scheduleProposal" from public.sms_messages m where m.user_id=s.user_id and (m.from_number=p_from or m.to_number=p_from) and (is_staff or m.tenant_id is not distinct from tid) and (m.direction='inbound' or m.status in ('prepared','queued','sent','delivered') or m.status like 'outbox:%:sent') order by m.created_at desc,(m.direction='outbound') desc,m.id desc limit 12) x),'[]'),
 'staffFocus',case when is_staff then (select jsonb_build_object('jobId',m.id,'scheduleProposal',o.schedule_proposal) from public.coordinator_outbox o join public.maintenance_requests m on m.id=o.request_id and m.user_id=o.user_id where o.user_id=s.user_id and o.to_number=p_from and o.status='sent' and m.status not in ('completed','cancelled') and not coalesce(m.coordinator_review_status in ('awaiting_manager_response','awaiting_tenant_response'),false) order by o.created_at desc,o.id desc limit 1) else null end,
 'availableSlots',case when is_staff then public.coordinator_free_slots(s.user_id) else '[]'::jsonb end,
 'staffEvents',case when is_staff then coalesce((select jsonb_agg(e) from (select id,title,start_at,end_at,status from public.coordinator_staff_events where user_id=s.user_id and status='confirmed' and end_at>=now() order by start_at limit 100)e),'[]'::jsonb) else '[]'::jsonb end,
 'jobs',coalesce((select jsonb_agg(x) from (select m.id,m.job_number,m.tenant_id,m.title,m.description,case when is_staff then m.notes else null end as notes,m.coordinator_category,m.coordinator_details,m.coordinator_review_status,m.coordinator_manager_reply,m.status,m.scheduled_at,a.stage,concat_ws(' ',t.first_name,t.last_name) as tenant_name,p.address,case when is_staff then t.phone_e164 else null end as contact_phone,case when is_staff or a.stage is distinct from 'awaiting_staff' then a.options else null end as options,a.proposal_version from public.maintenance_requests m left join public.tenants t on t.id=m.tenant_id and t.user_id=m.user_id left join public.properties p on p.id=m.property_id and p.user_id=m.user_id left join public.coordinator_appointments a on a.request_id=m.id and a.user_id=m.user_id where m.user_id=s.user_id and (is_staff or m.tenant_id=tid) and (p_job is null or m.job_number=p_job) order by (m.status='completed'),m.created_at desc limit 100) x),'[]')
 ) into result;
 return result;
end $$;

create or replace function public.coordinator_refresh_suggestions(p_user uuid,p_request uuid,p_force boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare j public.maintenance_requests;a public.coordinator_appointments;slots jsonb;
begin
 select * into strict j from public.maintenance_requests where id=p_request and user_id=p_user;
 if j.status in ('completed','cancelled') or j.scheduled_at is not null or j.urgency='emergency' or j.coordinator_review_status in ('awaiting_manager_response','awaiting_tenant_response') then return;end if;
 select * into a from public.coordinator_appointments where request_id=j.id and user_id=p_user;
 if not p_force and a.stage='awaiting_selection' and exists(select 1 from jsonb_array_elements(a.options) o where (o->>'start')::timestamptz>now()) then return;end if;
 if not p_force and a.stage='awaiting_staff' and jsonb_array_length(a.options)=3 and not exists(select 1 from jsonb_array_elements(a.options) o where (o->>'start')::timestamptz<=now() or not public.coordinator_slot_free(p_user,(o->>'start')::timestamptz,(o->>'end')::timestamptz,j.id)) then return;end if;
 slots:=public.coordinator_free_slots(p_user,j.id);
 insert into public.coordinator_appointments(request_id,user_id,options,proposal_version,stage) values(j.id,p_user,slots,1,'awaiting_staff') on conflict(request_id) do update set options=excluded.options,proposal_version=public.coordinator_appointments.proposal_version+1,stage='awaiting_staff';
end $$;

create or replace function public.coordinator_work_order(p_user uuid,p_request uuid,p_update text default null) returns text
language sql stable security definer set search_path='' as $$
 select concat_ws(E'\n',
 'New maintenance request #'||m.job_number||' from '||trim(regexp_replace(concat_ws(' ',t.first_name,t.last_name),'\s+',' ','g'))||' at '||trim(coalesce(p.address,'Property address pending'))||'.',
 'Requesting maintenance repair for: '||coalesce(nullif(m.coordinator_details->>'repairSummary',''),left(regexp_replace(coalesce(nullif(m.description,''),m.title),'\s+',' ','g'),240)),
 'You have permission to enter while nobody is home: '||case m.coordinator_details->'entryPermission' when 'true'::jsonb then 'YES' when 'false'::jsonb then 'NO; arrange access with the tenant' else 'TBD' end||'.',
 'Access note: '||nullif(m.coordinator_details->>'accessNotes',''),
 case m.coordinator_review_status when 'inspection_authorized' then 'Scope: inspection only; installation requires separate manager work approval.' when 'work_authorized' then 'Scope: work approved by the manager.' end,
 case m.urgency when 'emergency' then 'Urgency: emergency.' when 'high' then 'Urgency: priority.' end,
 case m.coordinator_details->>'leakPattern' when 'only_when_used' then 'Leak reported only when used.' when 'continuous' then 'Continuing leak reported.' when 'uncertain' then 'Possible leak; inspection needed.' end,
 'Tenant availability: '||nullif(m.coordinator_details->>'availability',''),
 'Repair update: '||left(nullif(trim(p_update),''),240),
 case when m.scheduled_at is not null then 'Visit: '||to_char(m.scheduled_at at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||' ('||s.timezone||').' end)
 from public.maintenance_requests m left join public.tenants t on t.id=m.tenant_id and t.user_id=m.user_id
 left join public.properties p on p.id=m.property_id and p.user_id=m.user_id
 join public.triage_settings s on s.user_id=m.user_id where m.id=p_request and m.user_id=p_user;
$$;

create or replace function public.coordinator_scheduling_note(p_user uuid,p_request uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare j public.maintenance_requests;a public.coordinator_appointments;s public.triage_settings;o jsonb;body text;i integer:=0;
begin
 select * into strict j from public.maintenance_requests where id=p_request and user_id=p_user;
 if j.status in ('completed','cancelled') or j.scheduled_at is not null or j.coordinator_review_status in ('awaiting_manager_response','awaiting_tenant_response') then return '';end if;
 if j.urgency='emergency' then return 'Urgent staff review required; normal scheduling suggestions are paused.';end if;
 select * into a from public.coordinator_appointments where request_id=j.id and user_id=p_user;
 if a.stage is distinct from 'awaiting_staff' then return '';end if;
 if jsonb_array_length(a.options)=0 then return 'Potential schedule times based on your schedule: TBD. No free slots were found; please provide suitable times.';end if;
 select * into strict s from public.triage_settings where user_id=p_user;
 body:='Potential schedule times based on your schedule: ';
 for o in select value from jsonb_array_elements(a.options) loop i:=i+1;body:=body||case when i>1 then '; ' else '' end||i||') '||to_char((o->>'start')::timestamptz at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM');end loop;
 return body||' ('||s.timezone||'). '||case when j.coordinator_details->'entryPermission'='true'::jsonb then 'Reply 1, 2 or 3, or send another exact visit time to book.' when j.coordinator_details->'entryPermission'='false'::jsonb then 'The tenant needs to be home. Shall I send these three visit options to the tenant?' else 'Entry permission is TBD; these are tentative options, not a booking.' end;
end $$;

create or replace function public.coordinator_commit(p_user uuid,p_from text,p_sid text,p_version integer,p_message text,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings; conv public.coordinator_conversations; tid uuid; prop uuid;
 staff boolean; a jsonb; f jsonb; typ text; job public.maintenance_requests; ap public.coordinator_appointments;
 choice integer; opt jsonb; fact_patch jsonb; start_time timestamptz; end_time timestamptz; tenant_phone text; text_body text; tenant_text text;
 target uuid; reply_job uuid; target_phone text; prior jsonb; action_index integer:=0;
 facts_changed boolean; notify_maintenance boolean; maintenance_update text;
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
 insert into public.coordinator_events(user_id,phone,sid,tenant_id,message,decision) values(p_user,p_from,p_sid,tid,p_message,p_decision);
 for a in select value from jsonb_array_elements(p_decision->'actions') loop
  action_index:=action_index+1; typ:=a->>'type';f:=coalesce(a->'fields','{}');
  fact_patch:=public.coordinator_clean_facts(f->'facts');
  facts_changed:=false;notify_maintenance:=true;
  if coalesce(staff,false) then fact_patch:=fact_patch-'entryPermission'-'availability'; end if;
  manager_only:=p_from=public.normalize_us_phone(s.manager_phone);
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
   if job.status<>'completed' and job.scheduled_at is null and not exists(select 1 from public.coordinator_appointments a where a.request_id=job.id and a.user_id=p_user and a.stage='awaiting_selection' and exists(select 1 from jsonb_array_elements(a.options) as offered(value) where (case when (offered.value->>'flexible')::boolean is true then (offered.value->>'end')::timestamptz else (offered.value->>'start')::timestamptz end)>now())) and not exists(select 1 from public.coordinator_outbox where user_id=p_user and request_id=job.id and action_key='scheduling_followup' and (created_at at time zone s.timezone)::date=(now() at time zone s.timezone)::date and status<>'cancelled') then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id,schedule_proposal)
    values(p_user,p_sid,'scheduling_followup',public.normalize_us_phone(s.maintenance_phone),s.twilio_number,public.coordinator_work_order(p_user,job.id)||E'\nScheduling requested.\n'||public.coordinator_scheduling_note(p_user,job.id),job.id,public.coordinator_suggestion_snapshot(p_user,job.id));
   end if;
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
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id,schedule_proposal)
    values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.maintenance_phone),s.twilio_number,public.coordinator_work_order(p_user,job.id)||E'\n'||public.coordinator_scheduling_note(p_user,job.id),job.id,public.coordinator_suggestion_snapshot(p_user,job.id));
    tenant_text:=case command[2] when 'inspection' then 'Your property manager approved an inspection only. Maintenance will coordinate a visit.' else 'Your property manager approved the work. Maintenance will coordinate a visit.' end;
    if jsonb_typeof(job.coordinator_details->'entryPermission') is distinct from 'boolean' then tenant_text:=tenant_text||' Does maintenance have permission to enter if nobody is home?';end if;
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
    update public.maintenance_requests set coordinator_review_status='awaiting_manager_response',scheduled_at=null,scheduled_date=null,status='open',coordinator_details=case when coordinator_details->'entryPermission'='true'::jsonb then coordinator_details-'entryPermission' else coordinator_details end where id=job.id and user_id=p_user;
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id)
    values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,public.coordinator_review_prompt(p_user,job.id,coalesce(f->>'description',p_message)),job.id);
    if tenant_phone is not null then
     insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,tenant_id,request_id)
     values(p_user,p_sid,action_index::text,tenant_phone,s.twilio_number,'Maintenance has completed the inspection. Your property manager will review the findings before any work is arranged.',job.tenant_id,job.id);
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
   insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(case when typ='emergency' then s.manager_phone else s.maintenance_phone end),s.twilio_number,
    case when typ='emergency' then 'EMERGENCY' else 'New request' end||coalesce(' #'||job.job_number::text,'')||' from '||coalesce((select concat_ws(' ',t.first_name,t.last_name) from public.tenants t where t.id=tid and t.user_id=p_user),'unverified contact')||' '||p_from||coalesce(' at '||(select p.address from public.properties p where p.id=prop and p.user_id=p_user),'')||': '||left(p_message,1000));
   if typ='new_request' and public.normalize_us_phone(s.manager_phone)<>public.normalize_us_phone(s.maintenance_phone) then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body)
    values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,
     'New request #'||job.job_number||': '||left(p_message,1000)) on conflict do nothing;
   end if;
  elsif typ in ('add_details','offer_times','select_time','request_alternatives','start_work','report_progress','complete_work','book_visit') then
   select * into strict job from public.maintenance_requests where id=(a->>'jobId')::uuid and user_id=p_user and (coalesce(staff,false) or tenant_id=tid) for update;
   if job.coordinator_review_status in ('awaiting_manager_response','awaiting_tenant_response') then raise exception 'manager review and approval required';end if;
   if typ='complete_work' and job.coordinator_review_status='inspection_authorized' then raise exception 'record inspection completion for manager review';end if;
   select case when public.coordinator_tenant(p_user,coalesce(c.phone,t.phone_e164))=job.tenant_id then coalesce(c.phone,t.phone_e164) else null end into tenant_phone from public.tenants t left join lateral(select b.phone from public.coordinator_contacts b where b.user_id=p_user and b.tenant_id=t.id and not b.revoked order by b.verified_at desc limit 1)c on true where t.id=job.tenant_id and t.user_id=p_user;
   select public.coordinator_merge_facts(job.coordinator_details,fact_patch) is distinct from job.coordinator_details into facts_changed;
   -- Keep uncertain clarifications and repeated unchanged entry answers in the
   -- manager's context; they must not restart maintenance scheduling.
   if typ='add_details' and not coalesce(staff,false) then
    notify_maintenance:=not ((f->>'notifyMaintenance'='false' and fact_patch='{}'::jsonb)
     or (fact_patch ? 'entryPermission' and fact_patch-array['entryPermission','accessNotes']='{}'::jsonb and not facts_changed));
    notify_maintenance:=coalesce(notify_maintenance,true);
   end if;
   if fact_patch<>'{}'::jsonb then update public.maintenance_requests set coordinator_details=public.coordinator_merge_facts(coordinator_details,fact_patch) where id=job.id and user_id=p_user returning * into job;end if;
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
    update public.maintenance_requests set scheduled_at=start_time,scheduled_date=(start_time at time zone s.timezone)::date where id=job.id and user_id=p_user;
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
    update public.maintenance_requests set scheduled_at=start_time,scheduled_date=(start_time at time zone s.timezone)::date where id=job.id and user_id=p_user;
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
    when 'complete_work' then 'Maintenance has finished the '||public.coordinator_repair_label(job.title,job.coordinator_details)||' work. Please let me know if anything still needs attention.'
    when 'report_progress' then 'Here’s the latest on the '||public.coordinator_repair_label(job.title,job.coordinator_details)||': '||regexp_replace(coalesce(f->>'description',p_message),'^\s*#?'||job.job_number::text||'([[:space:]]*[:—-][[:space:]]*|[[:space:]]+|$)','','i')
    else null end;
   if typ in ('offer_times','start_work','report_progress','complete_work','book_visit') and tenant_phone is not null then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,tenant_id) values(p_user,p_sid,action_index::text,tenant_phone,s.twilio_number,tenant_text,job.tenant_id) on conflict do nothing;
   end if;
   if typ<>'offer_times' and public.normalize_us_phone(s.manager_phone)<>p_from then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,text_body) on conflict do nothing;
   end if;
   if typ in ('select_time','request_alternatives','add_details','book_visit') and notify_maintenance and public.normalize_us_phone(s.maintenance_phone)<>p_from then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.maintenance_phone),s.twilio_number,text_body) on conflict do nothing;
   end if;
  else raise exception 'invalid action';
  end if;
  if job.id is not null and typ in ('new_request','add_details') and not coalesce(staff,false) then perform public.coordinator_refresh_suggestions(p_user,job.id,fact_patch ? 'entryPermission' and facts_changed);end if;
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

commit;
