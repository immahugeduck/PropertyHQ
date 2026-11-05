import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getDateRange } from "@/lib/reports"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const money = (n: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(n)

export default async function OwnerStatementsPage({searchParams}:{searchParams:Promise<Record<string,string>>}) {
  const supabase = await createClient()
  const {data:{user}} = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")
  const params = await searchParams
  const {from,to} = params.from && params.to ? {from:params.from,to:params.to} : getDateRange("this-month")
  const [{data:owners,error:ownersError},{data:properties,error:propertiesError},{data:payments,error:paymentsError},{data:expenses,error:expensesError}] = await Promise.all([
    supabase.from("property_owners").select("id,first_name,last_name,company_name").eq("user_id",user.id).order("last_name"),
    supabase.from("properties").select("id,name,owner_id").eq("user_id",user.id),
    supabase.from("payment_balances").select("property_id,amount,amount_paid,paid_date").eq("user_id",user.id).gt("amount_paid",0).gte("paid_date",from).lte("paid_date",to),
    supabase.from("expenses").select("property_id,amount,date,description").eq("user_id",user.id).gte("date",from).lte("date",to)
  ])
  const error = ownersError || propertiesError || paymentsError || expensesError
  if (error) return <p role="alert" className="text-destructive">Unable to load owner financial records: {error.message}</p>
  const owned = (properties || []).filter(p => p.owner_id)
  const selected = params.owner && (owners || []).some(o => o.id === params.owner) ? params.owner : "all"
  const statements = (owners || []).filter(o => selected === "all" || o.id === selected).map(o => {
    const units = owned.filter(p => p.owner_id === o.id)
    const ids = new Set(units.map(p => p.id))
    const collected = (payments || []).filter(p => p.property_id && ids.has(p.property_id)).reduce((sum,p) => sum + Number(p.amount_paid || 0), 0)
    const costs = (expenses || []).filter(e => e.property_id && ids.has(e.property_id)).reduce((sum,e) => sum + Number(e.amount || 0), 0)
    return {...o,units,collected,costs,net:collected-costs}
  })
  return <main className="space-y-6">
    <div className="flex flex-wrap gap-3 items-start justify-between">
      <div><h1 className="text-2xl font-bold">Owner Statements</h1><p className="text-sm text-muted-foreground">Collected rent minus recorded property expenses. This is NOT an owner payout calculation: fees, reserves, deposits and disbursements are not deducted.</p></div>
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
        <div className="flex justify-between"><span>Rent collected</span><strong>{money(s.collected)}</strong></div>
        <div className="flex justify-between"><span>Recorded expenses</span><strong>{money(s.costs)}</strong></div>
        <div className="flex justify-between border-t pt-2"><strong>Operating balance before adjustments</strong><strong>{money(s.net)}</strong></div>
      </CardContent>
    </Card>)}
  </main>
}
