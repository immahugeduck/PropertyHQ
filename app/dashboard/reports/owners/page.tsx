import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getDateRange } from "@/lib/reports"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { computeSettlement, firstMonthInvoiceIds, type SettlementExpense } from "@/lib/owner-settlement"

const money = (n: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(n)

export default async function OwnerStatementsPage({searchParams}:{searchParams:Promise<Record<string,string>>}) {
  const supabase = await createClient()
  const {data:{user}} = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")
  const params = await searchParams
  const {from,to} = params.from && params.to ? {from:params.from,to:params.to} : getDateRange("this-month")
  const [{data:owners,error:ownersError},{data:properties,error:propertiesError},{data:invoices,error:paymentsError},{data:expenses,error:expensesError},{data:payouts,error:payoutsError}] = await Promise.all([
    supabase.from("property_owners").select("id,first_name,last_name,company_name,leasing_fee_pct,management_fee_pct").eq("user_id",user.id).order("last_name"),
    supabase.from("properties").select("id,name,owner_id").eq("user_id",user.id),
    // All invoices, not just this period's: needed to tell a new tenant's first month apart.
    supabase.from("payment_balances").select("id,tenant_id,property_id,due_date,amount_paid,paid_date").eq("user_id",user.id),
    supabase.from("expenses").select("property_id,amount,date,description,paid_by").eq("user_id",user.id).gte("date",from).lte("date",to),
    supabase.from("owner_payouts").select("owner_id,amount,voided_at").eq("user_id",user.id).gte("payout_date",from).lte("payout_date",to)
  ])
  const error = ownersError || propertiesError || paymentsError || expensesError || payoutsError
  if (error) return <p role="alert" className="text-destructive">Unable to load owner financial records: {error.message}</p>
  const tenantIds = [...new Set((invoices || []).map(i => i.tenant_id).filter(Boolean))] as string[]
  const {data:tenants} = tenantIds.length ? await supabase.from("tenants").select("id,lease_start").in("id",tenantIds) : {data:[]}
  const firstMonthIds = firstMonthInvoiceIds(invoices || [], tenants || [])
  const owned = (properties || []).filter(p => p.owner_id)
  const selected = params.owner && (owners || []).some(o => o.id === params.owner) ? params.owner : "all"
  const statements = (owners || []).filter(o => selected === "all" || o.id === selected).map(o => {
    const units = owned.filter(p => p.owner_id === o.id)
    const ids = new Set(units.map(p => p.id))
    // Fees here are what the owner's fee settings give for this period; the
    // fees actually taken are on each recorded payout.
    const period = computeSettlement({
      payments: (invoices || []).filter(i => i.property_id && ids.has(i.property_id)).map(i => ({...i, amount_paid: Number(i.amount_paid)})),
      firstMonthIds,
      expenses: (expenses || []).filter(e => e.property_id && ids.has(e.property_id)) as SettlementExpense[],
      payouts: [],
      fees: {leasing_fee_pct: Number(o.leasing_fee_pct ?? 50), management_fee_pct: Number(o.management_fee_pct ?? 10)},
      from,
      through: to,
    })
    const paidOut = (payouts || []).filter(p => p.owner_id === o.id && !p.voided_at).reduce((sum,p) => sum + Number(p.amount), 0)
    const net = period.rentCollected - period.managerPaidExpenses - period.leasingFee - period.managementFee
    return {...o,units,period,net,paidOut}
  })
  return <main className="space-y-6">
    <div className="flex flex-wrap gap-3 items-start justify-between">
      <div><h1 className="text-2xl font-bold">Owner Statements</h1><p className="text-sm text-muted-foreground">Rent collected in the period, less expenses you paid and your fees from each owner&apos;s fee settings. Payouts are prepared and recorded on the <Link className="underline" href="/dashboard/owners/payouts">Owner Payouts</Link> page.</p></div>
    </div>
    <form className="flex flex-wrap gap-3 print:hidden">
      <label className="flex flex-col gap-1 text-sm">Owner
        <select name="owner" defaultValue={selected} className="h-10 rounded-md border bg-background px-3">
          <option value="all">All owners</option>
          {(owners || []).map(o => <option value={o.id} key={o.id}>{o.first_name} {o.last_name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">From<input type="date" name="from" defaultValue={from} className="h-10 rounded-md border bg-background px-3" /></label>
      <label className="flex flex-col gap-1 text-sm">To<input type="date" name="to" defaultValue={to} className="h-10 rounded-md border bg-background px-3" /></label>
      <button type="submit" className="self-end h-10 rounded-md bg-primary text-primary-foreground px-4">Apply filters</button>
    </form>
    <p className="text-sm text-muted-foreground">Statement period: {from} through {to}</p>
    {statements.length === 0 && <p>No owner records to report. <Link className="underline" href="/dashboard/owners/new">Add an owner</Link>.</p>}
    {statements.map(s => <Card key={s.id} className="break-inside-avoid">
      <CardHeader><CardTitle><Link className="hover:underline" href={`/dashboard/owners/${s.id}`}>{s.first_name} {s.last_name}{s.company_name ? ` — ${s.company_name}` : ""}</Link></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{s.units.length} assigned properties</p>
        {s.units.map(p => <div key={p.id} className="text-sm border-b pb-2">{p.name}</div>)}
        <div className="flex justify-between"><span>Rent collected</span><strong>{money(s.period.rentCollected)}</strong></div>
        <div className="flex justify-between"><span>Expenses paid by manager</span><strong>−{money(s.period.managerPaidExpenses)}</strong></div>
        {s.period.leasingFee > 0 && <div className="flex justify-between"><span>Leasing fee ({Number(s.leasing_fee_pct ?? 50)}% of new tenant first month)</span><strong>−{money(s.period.leasingFee)}</strong></div>}
        <div className="flex justify-between"><span>Management fee ({Number(s.management_fee_pct ?? 10)}%)</span><strong>−{money(s.period.managementFee)}</strong></div>
        <div className="flex justify-between border-t pt-2"><strong>Net to owner for the period</strong><strong>{money(s.net)}</strong></div>
        {s.period.ownerPaidExpenses > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Owner paid vendors directly (not deducted)</span><span>{money(s.period.ownerPaidExpenses)}</span></div>}
        <div className="flex justify-between text-sm text-muted-foreground"><span>Payouts recorded in the period</span><span>{money(s.paidOut)}</span></div>
      </CardContent>
    </Card>)}
  </main>
}
