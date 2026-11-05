-- Read-time status is authoritative; cron only persists it for external consumers.
create or replace function public.payment_status(stored_status text, due_date date, as_of date, grace_days integer default 0)
returns text language sql immutable security invoker set search_path = public as $$
 select case when stored_status = 'paid' then 'paid'
   when due_date + greatest(grace_days,0) < as_of then 'overdue'
   when stored_status = 'overdue' then 'pending' else stored_status end
$$;

create table public.payment_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 grace_days integer not null default 0 check (grace_days between 0 and 30),
 timezone text not null default 'America/Indiana/Indianapolis' check (timezone in ('America/Indiana/Indianapolis','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','UTC')),
 hide_demo_data boolean not null default false
);
alter table public.payment_settings enable row level security;
create policy payment_settings_owner on public.payment_settings for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.payment_settings to authenticated;
grant all on public.payment_settings to service_role;
-- Tenants may read their manager's billing rules so portal and dashboard agree.
create policy payment_settings_tenant_read on public.payment_settings for select to authenticated
 using (exists(select 1 from public.tenants t where t.user_id=payment_settings.user_id and t.auth_user_id=(select auth.uid())));

alter table public.tenants add column is_demo boolean not null default false;
alter table public.tenants add column rent_due_day integer not null default 1 check (rent_due_day between 1 and 28);
alter table public.rent_payments add column lease_id uuid references public.leases(id) on delete restrict;
-- Partial receipts require a separate recorded amount. Never infer a full receipt from 'partial'.
alter table public.rent_payments add column amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0 and amount_paid <= amount);
update public.rent_payments set amount_paid=amount where status='paid';
alter table public.leases add column starts_on date;
alter table public.leases add column ends_on date;
alter table public.leases add column monthly_rent numeric(12,2) check (monthly_rent > 0);
alter table public.leases add column rent_due_day integer check (rent_due_day between 1 and 28);
alter table public.leases add constraint lease_dates_order check (ends_on >= starts_on);

create or replace view public.payment_balances with (security_invoker = true) as
select p.id,p.user_id,p.tenant_id,p.property_id,p.amount,p.due_date,p.paid_date,
 public.payment_status(p.status,p.due_date,(now() at time zone coalesce(s.timezone,'America/Indiana/Indianapolis'))::date,coalesce(s.grace_days,0)) as status,
 p.payment_method,p.notes,p.created_at,p.updated_at,p.invoice_number,p.is_recurring,p.recurring_day,p.rent_schedule_id,p.stripe_session_id,p.stripe_payment_intent,p.receipt_number,p.lease_id,
 case when p.status='paid' then p.amount else p.amount_paid end as amount_paid,
 case when p.status='paid' then 0 else p.amount-p.amount_paid end as balance_due,
 t.is_demo
from public.rent_payments p join public.tenants t on t.id=p.tenant_id
left join public.payment_settings s on s.user_id=p.user_id
where not (coalesce(s.hide_demo_data,false) and t.is_demo);
grant select on public.payment_balances to authenticated, service_role;

-- Reject mismatched or cross-manager relationships even when the client is bypassed.
create or replace function public.validate_rental_relationships() returns trigger
language plpgsql security invoker set search_path = public as $$
declare t public.tenants; l public.leases;
begin
 if tg_table_name='tenants' then
   if new.property_id is null then raise exception 'Select a property for this tenant'; end if;
   if not exists(select 1 from public.properties where id=new.property_id and user_id=new.user_id) then raise exception 'Property must belong to this manager'; end if;
   if new.lease_end < new.lease_start then raise exception 'Lease end must be on or after lease start'; end if;
 else
   if tg_op='INSERT' or new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id or new.user_id is distinct from old.user_id then
   select * into t from public.tenants where id=new.tenant_id and user_id=new.user_id;
   if t.id is null or new.property_id is null or t.property_id is distinct from new.property_id then
     raise exception 'Tenant and property must belong to this manager and match';
   end if;
   end if;
   if tg_table_name='rent_payments' then
     if new.lease_id is not null then
       select * into l from public.leases where id=new.lease_id and user_id=new.user_id and tenant_id=new.tenant_id and property_id=new.property_id;
       if l.id is null then raise exception 'Payment lease must match tenant and property'; end if;
     end if;
     if new.status='paid' then new.amount_paid:=new.amount;
     elsif new.amount_paid >= new.amount and new.amount>0 then new.status:='paid';
     elsif new.amount_paid>0 then new.status:='partial'; end if;
   end if;
 end if;
 return new;
end $$;
create trigger validate_tenant_relationship before insert or update of property_id,user_id,lease_start,lease_end on public.tenants for each row execute function public.validate_rental_relationships();
create trigger validate_lease_relationship before insert or update of tenant_id,property_id,user_id,status on public.leases for each row execute function public.validate_rental_relationships();
create trigger validate_payment_relationship before insert or update on public.rent_payments for each row execute function public.validate_rental_relationships();

-- Protect existing links on deletion instead of silently detaching tenants/leases or deleting rent history.
alter table public.tenants drop constraint tenants_property_id_fkey;
alter table public.tenants add constraint tenants_property_id_fkey foreign key(property_id) references public.properties(id) on delete restrict;
alter table public.leases drop constraint leases_tenant_id_fkey;
alter table public.leases add constraint leases_tenant_id_fkey foreign key(tenant_id) references public.tenants(id) on delete restrict;
alter table public.leases drop constraint leases_property_id_fkey;
alter table public.leases add constraint leases_property_id_fkey foreign key(property_id) references public.properties(id) on delete restrict;

create or replace function public.normalize_property_address() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 new.city:=btrim(new.city); new.state:=upper(btrim(new.state)); new.zip_code:=btrim(new.zip_code);
 if lower(new.city)='greencaslte' then raise exception 'City appears misspelled. Use Greencastle.'; end if;
 if new.city='' or new.city !~ '[[:alpha:]]' then raise exception 'Enter a valid city name'; end if;
 if new.state !~ '^[A-Z]{2}$' then raise exception 'Use a two-letter state abbreviation'; end if;
 if new.zip_code !~ '^[0-9]{5}(-[0-9]{4})?$' then raise exception 'Enter a valid ZIP code'; end if;
 if new.owner_id is not null and not exists(select 1 from public.property_owners where id=new.owner_id and user_id=new.user_id) then raise exception 'Owner must belong to this manager'; end if;
 return new;
end $$;
create trigger validate_property_address before insert or update of city,state,zip_code,owner_id on public.properties for each row execute function public.normalize_property_address();

-- Only the account and records explicitly identified in the review.
update public.properties set city='Greencastle',updated_at=now() where id='51d3b3eb-e2aa-4150-9008-eafc083fb648' and user_id='6df9170c-7964-4a77-9b6c-f2349c46c5a0';
update public.files set file_name=replace(file_name,'Agreeent','Agreement'),updated_at=now() where id='6071b984-19bb-433a-a220-cc5fad958488' and user_id='6df9170c-7964-4a77-9b6c-f2349c46c5a0';
update public.tenants set is_demo=true where id='7abb01e8-edab-4773-b703-f9d00cf4c995' and user_id='6df9170c-7964-4a77-9b6c-f2349c46c5a0';
update public.rent_payments p set status=public.payment_status(p.status,p.due_date,(now() at time zone 'America/Indiana/Indianapolis')::date,0) where p.user_id='6df9170c-7964-4a77-9b6c-f2349c46c5a0' and p.status in ('pending','overdue','partial');
notify pgrst,'reload schema';

alter table public.rent_schedules add column lease_id uuid references public.leases(id) on delete restrict;
create unique index rent_schedule_active_lease on public.rent_schedules(lease_id) where active and lease_id is not null;
-- Concurrent cron/manual generation must not create the same scheduled charge twice.
create unique index rent_payment_schedule_period on public.rent_payments(rent_schedule_id,(date_trunc('month',due_date::timestamp))) where rent_schedule_id is not null;
create or replace function public.sync_signed_lease_billing() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.status='signed' and new.starts_on is not null and new.ends_on is not null and new.monthly_rent is not null and new.rent_due_day is not null then
   update public.tenants set lease_start=new.starts_on,lease_end=new.ends_on,rent_amount=new.monthly_rent,rent_due_day=new.rent_due_day where id=new.tenant_id;
   update public.rent_schedules set active=false where tenant_id=new.tenant_id and active and lease_id is distinct from new.id;
   insert into public.rent_schedules(user_id,tenant_id,property_id,amount,day_of_month,active,lease_id)
    values(new.user_id,new.tenant_id,new.property_id,new.monthly_rent,new.rent_due_day,true,new.id)
   on conflict (lease_id) where active and lease_id is not null do update set amount=excluded.amount,day_of_month=excluded.day_of_month,property_id=excluded.property_id;
 elsif new.status='voided' then
   update public.rent_schedules set active=false where lease_id=new.id;
 end if;
 return new;
end $$;
create trigger sync_signed_lease_billing after insert or update of status,starts_on,ends_on,monthly_rent,rent_due_day on public.leases for each row execute function public.sync_signed_lease_billing();

create or replace function public.refresh_payment_statuses() returns integer
language plpgsql security invoker set search_path=public as $$
declare changed integer;
begin
 update public.rent_payments p set status=public.payment_status(p.status,p.due_date,(now() at time zone coalesce(s.timezone,'America/Indiana/Indianapolis'))::date,coalesce(s.grace_days,0)),updated_at=now()
 from (select u.id,ps.timezone,ps.grace_days from auth.users u left join public.payment_settings ps on ps.user_id=u.id) s
 where p.user_id=s.id and p.status is distinct from public.payment_status(p.status,p.due_date,(now() at time zone coalesce(s.timezone,'America/Indiana/Indianapolis'))::date,coalesce(s.grace_days,0));
 get diagnostics changed=row_count;
 return changed;
end $$;
revoke all on function public.refresh_payment_statuses() from public,anon,authenticated;
grant execute on function public.refresh_payment_statuses() to service_role;

create or replace view public.visible_tenants with (security_invoker=true) as
 select t.* from public.tenants t left join public.payment_settings s on s.user_id=t.user_id
 where not(coalesce(s.hide_demo_data,false) and t.is_demo);
grant select on public.visible_tenants to authenticated,service_role;

create or replace view public.rental_data_issues with (security_invoker=true) as
select t.user_id,t.id as record_id,'tenant'::text as record_type,'Tenant has no property'::text as issue
 from public.tenants t where t.property_id is null
union all
select l.user_id,l.id,'lease','Active lease is missing a tenant, property or billing terms'
 from public.leases l where l.status in ('sent','signed') and (l.tenant_id is null or l.property_id is null or l.starts_on is null or l.ends_on is null or l.monthly_rent is null or l.rent_due_day is null)
union all
select l.user_id,l.id,'lease','Lease property differs from the tenant’s current property'
 from public.leases l join public.tenants t on t.id=l.tenant_id where l.status in ('sent','signed') and l.property_id is distinct from t.property_id;
grant select on public.rental_data_issues to authenticated,service_role;
notify pgrst,'reload schema';
