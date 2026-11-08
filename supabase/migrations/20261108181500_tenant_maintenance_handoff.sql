-- Format staff messages from saved job facts, keeping tenant context with the
-- manager and operational details with maintenance. Existing history and queued
-- messages are not rewritten or replayed.
begin;

create function public.coordinator_work_order(p_user uuid,p_request uuid,p_update text default null) returns text
language sql stable security definer set search_path='' as $$
 select concat_ws(E'\n',
 '#'||m.job_number||' — '||coalesce(p.address,'Property address pending'),
 'Tenant: '||concat_ws(' ',t.first_name,t.last_name,t.phone_e164),
 'Repair: '||coalesce(nullif(m.description,''),m.title),
 'Urgency: '||case m.urgency when 'emergency' then 'emergency' when 'high' then 'priority' else 'routine' end,
 case m.coordinator_details->>'leakPattern'
  when 'only_when_used' then 'Leak reported only when used.'
  when 'continuous' then 'Continuing leak reported.'
  when 'uncertain' then 'Possible leak; inspection needed.' end,
 case m.coordinator_details->'entryPermission'
  when 'true'::jsonb then 'Permission to enter while nobody is home: granted.'
  when 'false'::jsonb then 'Permission to enter while nobody is home: not granted; arrange access with the tenant.'
  else 'Permission to enter while nobody is home: pending; do not enter unattended.' end,
 'Tenant availability: '||nullif(m.coordinator_details->>'availability',''),
 'Update: '||nullif(trim(p_update),''),
 case when m.scheduled_at is not null then 'Visit: '||to_char(m.scheduled_at at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||' ('||s.timezone||').' end)
 from public.maintenance_requests m
 left join public.tenants t on t.id=m.tenant_id and t.user_id=m.user_id
 left join public.properties p on p.id=m.property_id and p.user_id=m.user_id
 join public.triage_settings s on s.user_id=m.user_id
 where m.id=p_request and m.user_id=p_user;
$$;
revoke all on function public.coordinator_work_order(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.coordinator_work_order(uuid,uuid,text) to service_role;


create or replace function public.coordinator_form_intake() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings;t public.tenants;recipient text;phone text;body_text text;
begin
 if coalesce(new.source,'app')<>'app' or new.status='completed' then return new;end if;
 select * into s from public.triage_settings where user_id=new.user_id;
 -- No routing for this owner must never fall back to another owner's staff.
 if not found then return new;end if;
 perform public.coordinator_refresh_suggestions(new.user_id,new.id);
 recipient:=public.normalize_us_phone(case when new.urgency='emergency' then s.manager_phone else s.maintenance_phone end);
 if recipient is null then raise exception 'maintenance routing is not configured';end if;
 insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id,schedule_proposal)
 values(new.user_id,'app-maintenance:'||new.id::text,'form_staff',recipient,s.twilio_number,
  case when new.urgency='emergency' then 'EMERGENCY request'||E'\n'||public.coordinator_job_summary(new.user_id,new.id)
   else public.coordinator_work_order(new.user_id,new.id)||E'\n'||public.coordinator_scheduling_note(new.user_id,new.id) end,new.id,public.coordinator_suggestion_snapshot(new.user_id,new.id))
 on conflict(event_sid,action_key,to_number) do nothing;
 if new.urgency<>'emergency' and public.normalize_us_phone(s.manager_phone) is not null and public.normalize_us_phone(s.manager_phone)<>recipient then
  insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id)
  values(new.user_id,'app-maintenance:'||new.id::text,'form_manager',public.normalize_us_phone(s.manager_phone),s.twilio_number,
   'New request: '||new.description||E'\n'||public.coordinator_job_summary(new.user_id,new.id),new.id)
  on conflict(event_sid,action_key,to_number) do nothing;
 end if;
 select * into t from public.tenants where id=new.tenant_id and user_id=new.user_id;
 if not found then return new;end if;
 select c.phone into phone from public.coordinator_contacts c where c.user_id=new.user_id and c.tenant_id=t.id and not c.revoked order by c.verified_at desc nulls last limit 1;
 phone:=coalesce(phone,t.phone_e164);
 if phone is null or phone in (public.normalize_us_phone(s.maintenance_phone),public.normalize_us_phone(s.manager_phone)) or public.coordinator_tenant(new.user_id,phone) is distinct from t.id then return new;end if;
 body_text:='Hi '||t.first_name||', I’ve received your request about the '||public.coordinator_repair_label(new.title,new.coordinator_details)||'. Maintenance will reach out to schedule a visit.';
 if new.urgency='emergency' then body_text:=body_text||' If there is immediate danger, move to safety and contact emergency services. Do not wait for maintenance.';
 else body_text:=body_text||' Does maintenance have permission to enter if nobody is home?';end if;
 insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id,tenant_id)
 values(new.user_id,'app-maintenance:'||new.id::text,'form_tenant',phone,s.twilio_number,body_text,new.id,t.id)
 on conflict(event_sid,action_key,to_number) do nothing;
 return new;
end $$;

create or replace function public.coordinator_commit(p_user uuid,p_from text,p_sid text,p_version integer,p_message text,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings; conv public.coordinator_conversations; tid uuid; prop uuid;
 staff boolean; a jsonb; f jsonb; typ text; job public.maintenance_requests; ap public.coordinator_appointments;
 choice integer; opt jsonb; fact_patch jsonb; start_time timestamptz; end_time timestamptz; tenant_phone text; text_body text; tenant_text text;
 target uuid; target_phone text; prior jsonb; action_index integer:=0;
 facts_changed boolean; notify_maintenance boolean; maintenance_update text;
begin
 if p_sid is null or p_sid='' or length(p_message)>8000 then raise exception 'invalid event'; end if;
 p_from:=public.normalize_us_phone(p_from);
 if p_from is null then raise exception 'invalid phone'; end if;
 -- Serialize an account's job and appointment changes; also protects conflict checks.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into strict s from public.triage_settings where user_id=p_user;
 if right(public.normalize_us_phone(s.maintenance_phone),4)<>'9030' or right(public.normalize_us_phone(s.manager_phone),4)<>'6088' or s.maintenance_phone is null or s.manager_phone is null then raise exception 'staff configuration mismatch'; end if;
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
   select case when public.coordinator_tenant(p_user,coalesce(c.phone,t.phone_e164))=job.tenant_id then coalesce(c.phone,t.phone_e164) else null end into tenant_phone from public.tenants t left join lateral(select b.phone from public.coordinator_contacts b where b.user_id=p_user and b.tenant_id=t.id and not b.revoked order by b.verified_at desc limit 1)c on true where t.id=job.tenant_id and t.user_id=p_user;
   select exists(select 1 from jsonb_each(fact_patch) patch where job.coordinator_details->patch.key is distinct from patch.value) into facts_changed;
   -- Keep uncertain clarifications and repeated unchanged entry answers in the
   -- manager's context; they must not restart maintenance scheduling.
   if typ='add_details' and not coalesce(staff,false) then
    notify_maintenance:=not ((f->>'requestScheduling'='false' and fact_patch='{}'::jsonb)
     or (fact_patch ? 'entryPermission' and fact_patch-'entryPermission'='{}'::jsonb and not facts_changed));
    notify_maintenance:=coalesce(notify_maintenance,true);
   end if;
   if fact_patch<>'{}'::jsonb then update public.maintenance_requests set coordinator_details=coordinator_details||fact_patch where id=job.id and user_id=p_user returning * into job;end if;
   if typ='book_visit' then
    if (job.coordinator_details->>'entryPermission')::boolean is distinct from true then raise exception 'entry permission required';end if;
    if job.status in ('completed','cancelled') or jsonb_typeof(f->'options') is distinct from 'array' or jsonb_array_length(f->'options')<>1 then raise exception 'one exact visit required';end if;
    opt:=f->'options'->0;start_time:=(opt->>'start')::timestamptz;end_time:=(opt->>'end')::timestamptz;
    if start_time is null or end_time is null or start_time<=now() or end_time<=start_time or end_time-start_time>interval '8 hours' or coalesce((opt->>'flexible')::boolean,false) then raise exception 'invalid exact visit';end if;
    select * into ap from public.coordinator_appointments where request_id=job.id and user_id=p_user for update;
    if f->>'proposalVersion' is not null and (ap.stage is distinct from 'awaiting_staff' or ap.proposal_version is distinct from (f->>'proposalVersion')::integer or ap.options is distinct from f->'options') then raise exception 'stale suggestion';end if;
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
  if job.id is not null then
   maintenance_update:=case
    when typ='add_details' and (fact_patch='{}'::jsonb or fact_patch->'entryPermission'='false'::jsonb) then coalesce(f->>'description',p_message)
    when typ='request_alternatives' and fact_patch='{}'::jsonb then coalesce(f->>'description',p_message)
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
 insert into public.sms_messages(user_id,direction,channel,party,kind,from_number,to_number,body,twilio_sid,tenant_id,maintenance_request_id)
 values(p_user,'inbound','sms',case when staff then case when p_from=public.normalize_us_phone(s.manager_phone) then 'manager' else 'maintenance' end when tid is not null then 'tenant' else 'unknown' end,'message',p_from,s.twilio_number,p_message,p_sid,tid,job.id);
 -- Response record represents prepared TwiML, not proof of carrier delivery.
 insert into public.sms_messages(user_id,direction,channel,party,kind,from_number,to_number,body,tenant_id,maintenance_request_id,status)
 values(p_user,'outbound','sms',case when staff then case when p_from=public.normalize_us_phone(s.manager_phone) then 'manager' else 'maintenance' end when tid is not null then 'tenant' else 'unknown' end,'message',s.twilio_number,p_from,p_decision->>'reply',tid,job.id,'prepared');
 return jsonb_build_object('applied',true,'duplicate',false,'version',conv.version+1);
end $$;

commit;
