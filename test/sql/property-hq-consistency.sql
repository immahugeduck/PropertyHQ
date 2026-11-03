-- Run inside BEGIN/ROLLBACK, after loading the migration in a clean schema or staging transaction.
set local role authenticated;
select set_config('request.jwt.claim.sub','6df9170c-7964-4a77-9b6c-f2349c46c5a0',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
declare u uuid := '6df9170c-7964-4a77-9b6c-f2349c46c5a0';
 o uuid; p uuid; t uuid; l uuid; r uuid; e uuid; m uuid; v uuid; msg uuid; f uuid; n integer;
begin
 if public.payment_status('pending','2026-10-01','2026-10-25',0) <> 'overdue' then raise exception 'Past due regression'; end if;
 if public.payment_status('pending','2026-10-01','2026-10-06',5) <> 'pending' then raise exception 'Grace boundary regression'; end if;
 if public.payment_status('partial','2026-10-01','2026-10-07',5) <> 'overdue' then raise exception 'Partial overdue regression'; end if;
 if public.payment_status('paid','2026-10-01','2026-10-25',0) <> 'paid' then raise exception 'Paid regression'; end if;
 if public.payment_status('overdue','2026-11-01','2026-10-25',0) <> 'pending' then raise exception 'Rescheduled date regression'; end if;
 insert into public.property_owners(user_id,first_name,last_name) values(u,'QA','Rollback') returning id into o;
 update public.property_owners set last_name='Edited' where id=o;
 if not exists(select 1 from public.property_owners where id=o and last_name='Edited') then raise exception 'Owner update failed'; end if;
 insert into public.properties(user_id,owner_id,name,address,city,state,zip_code,monthly_rent) values(u,o,'QA rollback property','1 Test St','Greencastle','in','46135',800) returning id into p;
 update public.properties set name='QA edited property',bedrooms=0 where id=p;
 if not exists(select 1 from public.properties where id=p and state='IN' and bedrooms=0) then raise exception 'Property edit failed'; end if;
 begin
  update public.properties set city='Greencaslte' where id=p;
  raise exception 'Misspelled city was accepted';
 exception when raise_exception then
  if sqlerrm='Misspelled city was accepted' then raise; end if;
 end;
 insert into public.tenants(user_id,property_id,first_name,last_name,email,is_demo) values(u,p,'QA','Rollback','qa@example.invalid',true) returning id into t;
 update public.tenants set last_name='Edited' where id=t;
 begin
  update public.tenants set property_id=null where id=t;
  raise exception 'Missing property was accepted';
 exception when raise_exception then
  if sqlerrm='Missing property was accepted' then raise; end if;
 end;
 insert into public.leases(user_id,tenant_id,property_id,title,starts_on,ends_on,monthly_rent,rent_due_day) values(u,t,p,'QA rollback lease','2026-10-01','2027-09-30',800,1) returning id into l;
 update public.leases set monthly_rent=825 where id=l;
 update public.leases set status='signed' where id=l;
 if not exists(select 1 from public.rent_schedules where lease_id=l and amount=825 and active) then raise exception 'Lease schedule sync failed'; end if;
 insert into public.rent_payments(user_id,tenant_id,property_id,lease_id,amount,due_date) values(u,t,p,l,825,'2026-10-01') returning id into r;
 update public.rent_payments set amount_paid=300,paid_date='2026-10-20' where id=r;
 if not exists(select 1 from public.payment_balances where id=r and status='overdue' and balance_due=525 and amount_paid=300) then raise exception 'Partial balance regression'; end if;
 insert into public.payment_settings(user_id,hide_demo_data) values(u,true) on conflict(user_id) do update set hide_demo_data=true;
 if exists(select 1 from public.payment_balances where id=r) or exists(select 1 from public.visible_tenants where id=t) then raise exception 'Demo hiding failed'; end if;
 update public.payment_settings set hide_demo_data=false where user_id=u;
 if not exists(select 1 from public.payment_balances where id=r) then raise exception 'Demo restore failed'; end if;
 insert into public.expenses(user_id,property_id,description,amount) values(u,p,'QA rollback expense',20) returning id into e;
 update public.expenses set amount=25 where id=e;
 insert into public.vendors(user_id,name) values(u,'QA rollback vendor') returning id into v;
 update public.vendors set name='QA edited vendor' where id=v;
 insert into public.maintenance_requests(user_id,property_id,tenant_id,title,description,vendor_id) values(u,p,t,'QA rollback maintenance','QA only',v) returning id into m;
 update public.maintenance_requests set title='QA edited maintenance' where id=m;
 insert into public.messages(user_id,tenant_id,property_id,subject,body) values(u,t,p,'QA rollback message','QA only') returning id into msg;
 update public.messages set body='QA edited body' where id=msg;
 insert into public.files(user_id,tenant_id,property_id,file_name,storage_path) values(u,t,p,'QA rollback.txt',u||'/qa-rollback.txt') returning id into f;
 update public.files set file_name='QA edited.txt' where id=f;
 -- Foreign-manager records must remain invisible through both new views.
 if exists(select 1 from public.payment_balances where user_id<>u) or exists(select 1 from public.visible_tenants where user_id<>u) then raise exception 'RLS leak'; end if;
 delete from public.files where id=f;
 delete from public.messages where id=msg;
 delete from public.maintenance_requests where id=m;
 delete from public.vendors where id=v;
 delete from public.expenses where id=e;
 delete from public.rent_payments where id=r;
 update public.leases set status='voided' where id=l;
 delete from public.rent_schedules where lease_id=l;
 delete from public.leases where id=l;
 delete from public.tenants where id=t;
 delete from public.properties where id=p;
 delete from public.property_owners where id=o;
 if exists(select 1 from public.properties where id=p) then raise exception 'Delete failed'; end if;
end $$;
select 'PASS: ten entity database CRUD, lease billing, status/grace/partial, demo filters and manager RLS' as result;
