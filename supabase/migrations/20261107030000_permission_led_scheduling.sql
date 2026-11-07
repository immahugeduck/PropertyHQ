-- Private calendar suggestions; every actual booking still requires staff approval.
begin;
alter table public.coordinator_outbox add column schedule_proposal jsonb;
alter table public.coordinator_appointments drop constraint coordinator_stage;
alter table public.coordinator_appointments add constraint coordinator_stage check(stage in ('awaiting_options','awaiting_staff','awaiting_selection','confirmed','rescheduling','completed'));

create function public.coordinator_slot_free(p_user uuid,p_start timestamptz,p_end timestamptz,p_ignore uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.coordinator_appointments a join public.maintenance_requests m on m.id=a.request_id and m.user_id=a.user_id where a.user_id=p_user and m.status not in ('completed','cancelled') and a.request_id is distinct from p_ignore and a.stage<>'completed' and a.start_at<p_end and a.end_at>p_start)
 and not exists(select 1 from public.coordinator_staff_events e join public.triage_settings s on s.user_id=e.user_id where e.user_id=p_user and e.staff_phone=public.normalize_us_phone(s.maintenance_phone) and e.status='confirmed' and e.start_at<p_end and e.end_at>p_start)
 and not exists(select 1 from public.maintenance_requests m join public.triage_settings s on s.user_id=m.user_id where m.user_id=p_user and m.id is distinct from p_ignore and m.status not in ('completed','cancelled') and not exists(select 1 from public.coordinator_appointments a where a.request_id=m.id and a.start_at is not null and a.stage<>'completed') and ((m.scheduled_at is not null and m.scheduled_at<p_end and m.scheduled_at+interval '1 hour'>p_start) or (m.scheduled_at is null and m.scheduled_date is not null and m.scheduled_date between (p_start at time zone s.timezone)::date and ((p_end-interval '1 microsecond') at time zone s.timezone)::date)))
$$;
create function public.coordinator_free_slots(p_user uuid,p_ignore uuid default null,p_after timestamptz default now()) returns jsonb
language sql stable security definer set search_path='' as $$
 with candidates as (
 select (d.day::date+s.open_time+g.n*interval '1 hour') at time zone s.timezone as start_at,
 (d.day::date+s.open_time+(g.n+1)*interval '1 hour') at time zone s.timezone as end_at
 from public.triage_settings s cross join lateral generate_series((p_after at time zone s.timezone)::date::timestamp,((p_after at time zone s.timezone)::date+13)::timestamp,interval '1 day') d(day)
 cross join generate_series(0,23) g(n)
 where s.user_id=p_user and extract(isodow from d.day)::smallint=any(s.open_days) and s.open_time<s.close_time
 and (d.day::date+s.open_time+(g.n+1)*interval '1 hour')<=d.day::date+s.close_time
 ), free as(select * from candidates where start_at>=p_after+interval '1 hour' and public.coordinator_slot_free(p_user,start_at,end_at,p_ignore) order by start_at limit 3)
 select coalesce(jsonb_agg(jsonb_build_object('start',start_at,'end',end_at,'flexible',false) order by start_at),'[]'::jsonb) from free
$$;
create function public.coordinator_refresh_suggestions(p_user uuid,p_request uuid,p_force boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare j public.maintenance_requests;a public.coordinator_appointments;slots jsonb;need integer;
begin
 select * into strict j from public.maintenance_requests where id=p_request and user_id=p_user;
 if j.status in ('completed','cancelled') or j.scheduled_at is not null or j.urgency='emergency' then return;end if;
 if jsonb_typeof(j.coordinator_details->'entryPermission') is distinct from 'boolean' then return;end if;
 select * into a from public.coordinator_appointments where request_id=j.id and user_id=p_user;
 if not p_force and a.stage in ('awaiting_staff','awaiting_selection') and exists(select 1 from jsonb_array_elements(a.options) o where (o->>'start')::timestamptz>now()) then return;end if;
 need:=case when (j.coordinator_details->>'entryPermission')::boolean then 1 else 3 end;
 slots:=public.coordinator_free_slots(p_user,j.id);
 if need=1 then slots:=case when jsonb_array_length(slots)>0 then jsonb_build_array(slots->0) else '[]'::jsonb end;end if;
 insert into public.coordinator_appointments(request_id,user_id,options,proposal_version,stage) values(j.id,p_user,slots,1,'awaiting_staff') on conflict(request_id) do update set options=excluded.options,proposal_version=public.coordinator_appointments.proposal_version+1,stage='awaiting_staff';
end $$;
create function public.coordinator_scheduling_note(p_user uuid,p_request uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare j public.maintenance_requests;a public.coordinator_appointments;s public.triage_settings;o jsonb;body text;need integer;i integer:=0;
begin
 select * into strict j from public.maintenance_requests where id=p_request and user_id=p_user;
 if j.status in ('completed','cancelled') or j.scheduled_at is not null then return '';end if;
 if j.urgency='emergency' then return 'Urgent staff review required; normal scheduling suggestions are paused.';end if;
 if jsonb_typeof(j.coordinator_details->'entryPermission') is distinct from 'boolean' then return 'Entry permission is pending. I’ll follow up with suggested visit options after the tenant answers.';end if;
 select * into a from public.coordinator_appointments where request_id=j.id and user_id=p_user;
 if a.stage is distinct from 'awaiting_staff' then return '';end if;
 select * into strict s from public.triage_settings where user_id=p_user;
 need:=case when (j.coordinator_details->>'entryPermission')::boolean then 1 else 3 end;
 if jsonb_array_length(a.options)<need then return 'I could not find '||need||' free visit option(s) in the recorded calendar and working hours. Please provide suitable times; nothing has been booked.';end if;
 body:=case when need=1 then 'Entry is permitted while nobody is home. Suggested visit: ' else 'The tenant needs to be home. Suggested visit options: ' end;
 for o in select value from jsonb_array_elements(a.options) loop i:=i+1;body:=body||case when i>1 then '; ' else '' end||i||') '||to_char((o->>'start')::timestamptz at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM');end loop;
 return body||' ('||s.timezone||'). '||case when need=1 then 'Shall I book this visit?' else 'Shall I send these three visit options to the tenant?' end;
end $$;
create function public.coordinator_suggestion_snapshot(p_user uuid,p_request uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('jobId',j.id,'proposalVersion',a.proposal_version,'options',a.options) from public.coordinator_appointments a join public.maintenance_requests j on j.id=a.request_id and j.user_id=a.user_id
 where a.user_id=p_user and a.request_id=p_request and a.stage='awaiting_staff' and j.urgency<>'emergency'
$$;
create function public.coordinator_portal_calendar_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings;start_time timestamptz;end_time timestamptz;
begin
 if new.status in ('completed','cancelled') or (new.scheduled_at is null and new.scheduled_date is null) then return new;end if;
 if tg_op='UPDATE' and new.scheduled_at is not distinct from old.scheduled_at and new.scheduled_date is not distinct from old.scheduled_date and not(old.status in ('completed','cancelled') and new.status not in ('completed','cancelled')) then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 select * into s from public.triage_settings where user_id=new.user_id;if not found then return new;end if;
 start_time:=coalesce(new.scheduled_at,new.scheduled_date::timestamp at time zone s.timezone);
 end_time:=case when new.scheduled_at is not null then new.scheduled_at+interval '1 hour' else (new.scheduled_date+1)::timestamp at time zone s.timezone end;
 if not public.coordinator_slot_free(new.user_id,start_time,end_time,new.id) then raise exception 'appointment unavailable: maintenance calendar conflict';end if;
 return new;
end $$;
create trigger coordinator_portal_calendar_guard before insert or update of scheduled_at,scheduled_date,status on public.maintenance_requests for each row execute function public.coordinator_portal_calendar_guard();
revoke all on function public.coordinator_suggestion_snapshot(uuid,uuid),public.coordinator_portal_calendar_guard() from public,anon,authenticated;
revoke all on function public.coordinator_slot_free(uuid,timestamptz,timestamptz,uuid),public.coordinator_free_slots(uuid,uuid,timestamptz),public.coordinator_refresh_suggestions(uuid,uuid,boolean),public.coordinator_scheduling_note(uuid,uuid) from public,anon,authenticated;

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
 'availableSlots',case when is_staff then public.coordinator_free_slots(s.user_id) else '[]'::jsonb end,
 'staffEvents',case when is_staff then coalesce((select jsonb_agg(e) from (select id,title,start_at,end_at,status from public.coordinator_staff_events where user_id=s.user_id and status='confirmed' and end_at>=now() order by start_at limit 100)e),'[]'::jsonb) else '[]'::jsonb end,
 'jobs',coalesce((select jsonb_agg(x) from (select m.id,m.job_number,m.tenant_id,m.title,m.description,case when is_staff then m.notes else null end as notes,m.coordinator_category,m.coordinator_details,m.status,m.scheduled_at,a.stage,concat_ws(' ',t.first_name,t.last_name) as tenant_name,p.address,case when is_staff then t.phone_e164 else null end as contact_phone,case when is_staff or a.stage is distinct from 'awaiting_staff' then a.options else null end as options,a.proposal_version from public.maintenance_requests m left join public.tenants t on t.id=m.tenant_id and t.user_id=m.user_id left join public.properties p on p.id=m.property_id and p.user_id=m.user_id left join public.coordinator_appointments a on a.request_id=m.id and a.user_id=m.user_id where m.user_id=s.user_id and (is_staff or m.tenant_id=tid) and (p_job is null or m.job_number=p_job) order by (m.status='completed'),m.created_at desc limit 100) x),'[]')
 ) into result;
 return result;
end $$;


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
  case when new.urgency='emergency' then 'EMERGENCY request' else 'New maintenance request' end||E'\n'||public.coordinator_job_summary(new.user_id,new.id)||E'\n'||public.coordinator_scheduling_note(new.user_id,new.id),new.id,public.coordinator_suggestion_snapshot(new.user_id,new.id))
 on conflict(event_sid,action_key,to_number) do nothing;
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
    values(p_user,p_sid,'scheduling_followup',public.normalize_us_phone(s.maintenance_phone),s.twilio_number,'Tenant asked about a visit for #'||job.job_number||': '||coalesce(f->>'description',p_message)||E'\n'||public.coordinator_job_summary(p_user,job.id)||E'\n'||public.coordinator_scheduling_note(p_user,job.id),job.id,public.coordinator_suggestion_snapshot(p_user,job.id));
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
  elsif typ in ('add_details','offer_times','select_time','request_alternatives','start_work','report_progress','complete_work','book_visit') then
   select * into strict job from public.maintenance_requests where id=(a->>'jobId')::uuid and user_id=p_user and (coalesce(staff,false) or tenant_id=tid) for update;
   select case when public.coordinator_tenant(p_user,coalesce(c.phone,t.phone_e164))=job.tenant_id then coalesce(c.phone,t.phone_e164) else null end into tenant_phone from public.tenants t left join lateral(select b.phone from public.coordinator_contacts b where b.user_id=p_user and b.tenant_id=t.id and not b.revoked order by b.verified_at desc limit 1)c on true where t.id=job.tenant_id and t.user_id=p_user;
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
   if typ in ('select_time','request_alternatives','add_details','book_visit') and public.normalize_us_phone(s.maintenance_phone)<>p_from then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.maintenance_phone),s.twilio_number,text_body) on conflict do nothing;
   end if;
  else raise exception 'invalid action';
  end if;
  if job.id is not null and typ in ('new_request','add_details') and not coalesce(staff,false) then perform public.coordinator_refresh_suggestions(p_user,job.id,fact_patch ? 'entryPermission');end if;
  if job.id is not null then
   update public.coordinator_outbox set schedule_proposal=case when to_number=public.normalize_us_phone(s.maintenance_phone) then public.coordinator_suggestion_snapshot(p_user,job.id) else null end,body=body||E'\n'||public.coordinator_job_summary(p_user,job.id)||case when typ in ('new_request','add_details') and not coalesce(staff,false) and to_number=public.normalize_us_phone(s.maintenance_phone) then E'\n'||public.coordinator_scheduling_note(p_user,job.id) else '' end
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
