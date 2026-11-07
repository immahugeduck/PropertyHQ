-- Review and apply separately. All entry points are service-role only.
begin;
alter table public.maintenance_requests add column coordinator_category text;
create table public.coordinator_contacts (
 user_id uuid not null references auth.users(id), phone text not null,
 tenant_id uuid references public.tenants(id), revoked boolean not null default false,
 verified_by text, verified_at timestamptz, primary key(user_id,phone)
);
create table public.coordinator_conversations (
 user_id uuid not null references auth.users(id), phone text not null,
 version integer not null default 0, state jsonb not null default '{}',
 primary key(user_id,phone)
);
create table public.coordinator_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 phone text not null, sid text not null unique, tenant_id uuid references public.tenants(id),
 message text not null, decision jsonb not null, created_at timestamptz not null default now()
);
create index coordinator_events_contact on public.coordinator_events(user_id,phone,created_at desc);
create table public.coordinator_appointments (
 request_id uuid primary key references public.maintenance_requests(id), user_id uuid not null references auth.users(id),
 options jsonb not null default '[]', proposal_version integer not null default 0,
 selected integer, stage text not null default 'awaiting_options', start_at timestamptz, end_at timestamptz,
 constraint coordinator_stage check(stage in ('awaiting_options','awaiting_selection','confirmed','rescheduling','completed'))
);
create table public.coordinator_outbox (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 request_id uuid references public.maintenance_requests(id), event_sid text not null, action_key text not null, to_number text not null, from_number text not null,
 body text not null, status text not null default 'queued' check(status in ('queued','sending','sent','uncertain','cancelled')),
 tenant_id uuid references public.tenants(id), provider_sid text, created_at timestamptz not null default now(), unique(event_sid,action_key,to_number)
);
create index coordinator_outbox_pending on public.coordinator_outbox(user_id,status,created_at);
alter table public.coordinator_contacts enable row level security;
alter table public.coordinator_conversations enable row level security;
alter table public.coordinator_events enable row level security;
alter table public.coordinator_appointments enable row level security;
alter table public.coordinator_outbox enable row level security;
-- Dashboard owner can inspect records, but only service role mutates coordinator state.
create policy coordinator_contacts_read on public.coordinator_contacts for select to authenticated using(user_id=(select auth.uid()));
create policy coordinator_conversations_read on public.coordinator_conversations for select to authenticated using(user_id=(select auth.uid()));
create policy coordinator_events_read on public.coordinator_events for select to authenticated using(user_id=(select auth.uid()));
create policy coordinator_appointments_read on public.coordinator_appointments for select to authenticated using(user_id=(select auth.uid()));
create policy coordinator_outbox_read on public.coordinator_outbox for select to authenticated using(user_id=(select auth.uid()));

-- One tenant per phone; ambiguous legacy phone matches remain unresolved.
create function public.coordinator_tenant(p_user uuid,p_phone text) returns uuid
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.coordinator_contacts c where c.user_id=p_user and c.phone=p_phone)
 then (select c.tenant_id from public.coordinator_contacts c join public.tenants t on t.id=c.tenant_id and t.user_id=c.user_id where c.user_id=p_user and c.phone=p_phone and not c.revoked)
 else (select case when count(*)=1 then (array_agg(t.id))[1] else null end from public.tenants t where t.user_id=p_user and t.phone_e164=p_phone and t.status='active') end;
$$;
create function public.coordinator_context(p_to text,p_from text,p_job bigint default null) returns jsonb
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
 'settings',jsonb_build_object('maintenance_phone',public.normalize_us_phone(s.maintenance_phone),'manager_phone',public.normalize_us_phone(s.manager_phone),'timezone',s.timezone),
 'state',coalesce(c.state,'{}'), 'version',coalesce(c.version,0),
 'binding',(select to_jsonb(b) from public.coordinator_contacts b where b.user_id=s.user_id and b.phone=p_from),
 'tenants',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'user_id',t.user_id,'property_id',t.property_id,'first_name',t.first_name,'status',t.status)) from public.tenants t where t.user_id=s.user_id and t.id=tid),'[]'),
 'messages',coalesce((select jsonb_agg(x) from (select e.message,e.decision->>'reply' as reply from public.coordinator_events e where e.user_id=s.user_id and e.phone=p_from order by e.created_at desc limit 12) x),'[]'),
 'jobs',coalesce((select jsonb_agg(x) from (select m.id,m.job_number,m.tenant_id,m.title,m.description,m.notes,m.coordinator_category,m.status,m.scheduled_at,a.stage,concat_ws(' ',t.first_name,t.last_name) as tenant_name,p.address,case when is_staff then t.phone_e164 else null end as contact_phone,a.options,a.proposal_version from public.maintenance_requests m left join public.tenants t on t.id=m.tenant_id and t.user_id=m.user_id left join public.properties p on p.id=m.property_id and p.user_id=m.user_id left join public.coordinator_appointments a on a.request_id=m.id and a.user_id=m.user_id where m.user_id=s.user_id and (is_staff or m.tenant_id=tid) and (p_job is null or m.job_number=p_job) order by (m.status='completed'),m.created_at desc limit 100) x),'[]')
 ) into result;
 return result;
end $$;

create function public.coordinator_commit(p_user uuid,p_from text,p_sid text,p_version integer,p_message text,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.triage_settings; conv public.coordinator_conversations; tid uuid; prop uuid;
 staff boolean; a jsonb; f jsonb; typ text; job public.maintenance_requests; ap public.coordinator_appointments;
 choice integer; opt jsonb; start_time timestamptz; end_time timestamptz; tenant_phone text; text_body text;
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
  if typ in ('approve_contact','unlink_contact','offer_times','start_work','report_progress','complete_work') and not coalesce(staff,false) then raise exception 'staff only'; end if;
  if typ in ('approve_contact','unlink_contact') then
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
    insert into public.maintenance_requests(user_id,property_id,tenant_id,title,description,coordinator_category,category,urgency,status,source)
    values(p_user,prop,tid,case when typ='emergency' then 'Emergency report (SMS)' else 'Maintenance request (SMS)' end,coalesce(f->>'description',p_message),f->>'category','general',case when typ='emergency' then 'emergency' else 'medium' end,'open','sms') returning * into job;
   end if;
   insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(case when typ='emergency' then s.manager_phone else s.maintenance_phone end),s.twilio_number,
    case when typ='emergency' then 'EMERGENCY' else 'New request' end||coalesce(' #'||job.job_number::text,'')||' from '||coalesce((select concat_ws(' ',t.first_name,t.last_name) from public.tenants t where t.id=tid and t.user_id=p_user),'unverified contact')||' '||p_from||coalesce(' at '||(select p.address from public.properties p where p.id=prop and p.user_id=p_user),'')||': '||left(p_message,1000));
  elsif typ in ('add_details','offer_times','select_time','request_alternatives','start_work','report_progress','complete_work') then
   select * into strict job from public.maintenance_requests where id=(a->>'jobId')::uuid and user_id=p_user and (coalesce(staff,false) or tenant_id=tid) for update;
   select case when public.coordinator_tenant(p_user,coalesce(c.phone,t.phone_e164))=job.tenant_id then coalesce(c.phone,t.phone_e164) else null end into tenant_phone from public.tenants t left join lateral(select b.phone from public.coordinator_contacts b where b.user_id=p_user and b.tenant_id=t.id and not b.revoked order by b.verified_at desc limit 1)c on true where t.id=job.tenant_id and t.user_id=p_user;
   if typ='offer_times' then
    if jsonb_typeof(f->'options')<>'array' or jsonb_array_length(f->'options') not in (2,3) then raise exception 'two or three options required';end if;
    for opt in select value from jsonb_array_elements(f->'options') loop
     start_time:=(opt->>'start')::timestamptz;end_time:=(opt->>'end')::timestamptz;
     if start_time is null or end_time is null or start_time<=now() or end_time<=start_time or end_time-start_time>interval '8 hours' then raise exception 'invalid option';end if;
    end loop;
    insert into public.coordinator_appointments(request_id,user_id,options,proposal_version,stage) values(job.id,p_user,f->'options',1,'awaiting_selection') on conflict(request_id) do update set options=excluded.options,proposal_version=public.coordinator_appointments.proposal_version+1,stage='awaiting_selection';
    -- Keep prior confirmed slot occupied until rescheduling is confirmed.
    select * into ap from public.coordinator_appointments where request_id=job.id;
    text_body:='For request #'||job.job_number||', which works best? ';
    choice:=0;
    for opt in select value from jsonb_array_elements(ap.options) loop
     choice:=choice+1;
     text_body:=text_body||choice::text||') '||to_char((opt->>'start')::timestamptz at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||'–'||to_char((opt->>'end')::timestamptz at time zone s.timezone,'HH12:MI AM')||' ('||s.timezone||'). ';
    end loop;
    text_body:=text_body||'Reply 1, 2'||case when choice=3 then ' or 3' else '' end||', or tell us if none work.';
   elsif typ='select_time' then
    if coalesce(staff,false) then raise exception 'tenant selection required';end if;
    select * into strict ap from public.coordinator_appointments where request_id=job.id and user_id=p_user for update;
    choice:=(f->>'choice')::integer;
    if ap.stage<>'awaiting_selection' or ap.proposal_version is distinct from (f->>'proposalVersion')::integer or choice is null or choice<1 or choice>jsonb_array_length(ap.options) then raise exception 'stale choice';end if;
    opt:=ap.options->(choice-1);start_time:=(opt->>'start')::timestamptz;end_time:=(opt->>'end')::timestamptz;
    if start_time<=now() or exists(select 1 from public.coordinator_appointments where user_id=p_user and request_id<>job.id and stage<>'completed' and start_at<end_time and end_at>start_time) then raise exception 'appointment unavailable';end if;
    update public.coordinator_appointments set selected=choice,stage='confirmed',start_at=start_time,end_at=end_time where request_id=job.id;
    update public.maintenance_requests set scheduled_at=start_time,scheduled_date=(start_time at time zone s.timezone)::date where id=job.id and user_id=p_user;
    text_body:='Confirmed #'||job.job_number||' for '||to_char(start_time at time zone s.timezone,'Dy Mon DD YYYY HH12:MI AM')||' ('||s.timezone||').';
   elsif typ='request_alternatives' then
    update public.coordinator_appointments set stage='rescheduling' where request_id=job.id and user_id=p_user;
    text_body:='New options needed for #'||job.job_number||': '||coalesce(f->>'description',p_message);
   elsif typ in ('start_work','complete_work') then
    update public.maintenance_requests set status=case when typ='start_work' then 'in_progress' else 'completed' end where id=job.id and user_id=p_user;
    if typ='complete_work' then update public.coordinator_appointments set stage='completed' where request_id=job.id and user_id=p_user;end if;
    text_body:='Request #'||job.job_number||case when typ='start_work' then ': work is now in progress.' else ' is completed. Please reply if anything still needs attention.' end;
   else
    text_body:='Update for #'||job.job_number||': '||coalesce(f->>'description',p_message);
   end if;
   update public.maintenance_requests set notes=concat_ws(E'\n',notes,'['||now()::text||'] '||typ||': '||coalesce(f->>'description',p_message)) where id=job.id and user_id=p_user;
   if typ in ('offer_times','start_work','report_progress','complete_work') and tenant_phone is not null then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,tenant_id) values(p_user,p_sid,action_index::text,tenant_phone,s.twilio_number,text_body,job.tenant_id) on conflict do nothing;
   end if;
   if typ<>'offer_times' then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.manager_phone),s.twilio_number,text_body) on conflict do nothing;
   end if;
   if typ='select_time' or typ='request_alternatives' then
    insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body) values(p_user,p_sid,action_index::text,public.normalize_us_phone(s.maintenance_phone),s.twilio_number,text_body) on conflict do nothing;
   end if;
  else raise exception 'invalid action';
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

create function public.coordinator_delivery_log() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  insert into public.sms_messages(user_id,direction,channel,party,kind,from_number,to_number,body,tenant_id,maintenance_request_id,status)
  values(new.user_id,'outbound','sms',case when new.tenant_id is not null then 'tenant' when exists(select 1 from public.triage_settings where user_id=new.user_id and public.normalize_us_phone(manager_phone)=new.to_number) then 'manager' else 'maintenance' end,'message',new.from_number,new.to_number,new.body,new.tenant_id,new.request_id,'outbox:'||new.id::text||':'||new.status);
 else
  update public.sms_messages set twilio_sid=new.provider_sid,maintenance_request_id=new.request_id,status='outbox:'||new.id::text||':'||new.status where user_id=new.user_id and status like 'outbox:'||new.id::text||':%';
 end if;
 return new;
end $$;
create trigger coordinator_delivery_log after insert or update on public.coordinator_outbox for each row execute function public.coordinator_delivery_log();
revoke all on function public.coordinator_delivery_log() from public,anon,authenticated;

create function public.coordinator_claim_outbox(p_user uuid) returns setof public.coordinator_outbox
language plpgsql security definer set search_path='' as $$
begin
 update public.coordinator_outbox set status='cancelled' where user_id=p_user and status='queued' and tenant_id is not null and public.coordinator_tenant(p_user,to_number) is distinct from tenant_id;
 return query update public.coordinator_outbox set status='sending' where id in (select id from public.coordinator_outbox where user_id=p_user and status='queued' order by created_at limit 2 for update skip locked) returning *;
end $$;
create function public.coordinator_finish_outbox(p_user uuid,p_id uuid,p_status text,p_sid text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('sent','uncertain') then raise exception 'invalid delivery status';end if;
 update public.coordinator_outbox set status=p_status,provider_sid=p_sid where id=p_id and user_id=p_user and status='sending';
end $$;
revoke all on function public.coordinator_tenant(uuid,text) from public,anon,authenticated;
revoke all on function public.coordinator_context(text,text,bigint) from public,anon,authenticated;
revoke all on function public.coordinator_commit(uuid,text,text,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public.coordinator_claim_outbox(uuid) from public,anon,authenticated;
revoke all on function public.coordinator_finish_outbox(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.coordinator_tenant(uuid,text),public.coordinator_context(text,text,bigint),public.coordinator_commit(uuid,text,text,integer,text,jsonb),public.coordinator_claim_outbox(uuid),public.coordinator_finish_outbox(uuid,uuid,text,text) to service_role;
commit;
