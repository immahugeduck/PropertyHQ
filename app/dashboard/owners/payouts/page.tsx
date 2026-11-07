import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { loadOwnerSettlement } from "@/lib/owner-settlement-data"
import { PreparePayoutForm } from "@/components/owners/prepare-payout-form"
import { VoidPayoutButton } from "@/components/owners/void-payout-button"
import { Button } from "@/components/ui/button"

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)

/** Today in Indiana as yyyy-mm-dd. */
const todayLocal = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Indiana/Indianapolis" }).format(new Date())

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 text-sm ${strong ? "border-t font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export default async function OwnerPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; through?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const params = await searchParams
  const today = todayLocal()
  const through = params.through && /^\d{4}-\d{2}-\d{2}$/.test(params.through) ? params.through : today

  const [{ data: owners, error: ownerError }, { data: payouts, error: payoutError }] = await Promise.all([
    supabase.from("property_owners").select("id, first_name, last_name").eq("user_id", user.id).order("last_name"),
    supabase
      .from("owner_payouts")
      .select("id, owner_id, amount, payout_date, payment_method, reference_number, notes, rent_collected, expenses_deducted, leasing_fee, management_fee, adjustment, through_date, voided_at, void_reason")
      .eq("user_id", user.id)
      .order("payout_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
  ])
  const error = ownerError || payoutError
  if (error) return <p role="alert" className="text-destructive">Unable to load payout ledger: {error.message}</p>

  const names = new Map((owners || []).map((o) => [o.id, `${o.first_name} ${o.last_name}`]))
  const ownerId = params.owner && names.has(params.owner) ? params.owner : null
  const data = ownerId ? await loadOwnerSettlement(supabase, user.id, ownerId, through) : null
  const s = data?.settlement

  return (
    <main className="space-y-6">
      <div>
        <Link className="text-sm text-muted-foreground hover:underline" href="/dashboard/owners">← Owners</Link>
        <h1 className="text-2xl font-bold mt-2">Owner Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Property HQ suggests what you owe each owner. You review it, change anything you need to, send the money
          yourself, then record what you paid. Nothing is posted automatically.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-4 space-y-4 print:hidden">
        <h2 className="text-lg font-semibold">Prepare a payout</h2>
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Owner
            <select name="owner" defaultValue={ownerId ?? ""} required className="h-10 rounded-md border bg-background px-3">
              <option value="">Choose owner</option>
              {(owners || []).map((o) => (
                <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Covering activity through
            <input type="date" name="through" defaultValue={through} max={today} className="h-10 rounded-md border bg-background px-3" />
          </label>
          <Button type="submit" variant="outline">Show breakdown</Button>
        </form>

        {data && s && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {s.lastThrough ? `Since the last payout (through ${s.lastThrough})` : "Since you started tracking"} up to {s.through}
              </p>
              {s.carriedOver !== 0 && (
                <Row label={s.carriedOver > 0 ? "Carried over (still owed from before)" : "Carried over (overpaid before)"} value={money(s.carriedOver)} />
              )}
              <Row label="Rent collected" value={money(s.rentCollected)} />
              {s.firstMonthRent > 0 && (
                <Row label={`  incl. new tenant first month`} value={money(s.firstMonthRent)} muted />
              )}
              <Row label="Expenses you paid" value={`−${money(s.managerPaidExpenses)}`} />
              <Row label={`Leasing fee (${data.owner.leasing_fee_pct}% of first month)`} value={`−${money(s.leasingFee)}`} />
              <Row label={`Management fee (${data.owner.management_fee_pct}% of other rent)`} value={`−${money(s.managementFee)}`} />
              <Row label="Suggested payout" value={money(s.suggestedPayout)} strong />
              {s.ownerPaidExpenses > 0 && (
                <Row label="Owner paid vendors directly (record only)" value={money(s.ownerPaidExpenses)} muted />
              )}
              {data.expenses.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium mb-1">Expenses in this period</p>
                  <ul className="space-y-1 text-sm">
                    {data.expenses.map((e) => (
                      <li key={e.id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {e.date} · {e.description}{e.vendor ? ` (${e.vendor})` : ""}
                          {e.paid_by === "owner" && <span className="text-muted-foreground"> · owner paid</span>}
                        </span>
                        <span className="tabular-nums">{money(e.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <PreparePayoutForm
              key={`${ownerId}-${s.through}-${s.lastThrough}`}
              ownerId={ownerId!}
              settlement={s}
              today={today}
            />
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold mb-3">Payout history</h2>
        {!payouts?.length ? (
          <p className="text-sm text-muted-foreground">No recorded owner payouts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Paid</th>
                  <th>Owner</th>
                  <th>Through</th>
                  <th className="text-right">Rent</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Fees</th>
                  <th className="text-right">Adj.</th>
                  <th className="text-right">Amount</th>
                  <th>Method</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => {
                  const fees = Number(p.leasing_fee || 0) + Number(p.management_fee || 0)
                  const voided = Boolean(p.voided_at)
                  return (
                    <tr key={p.id} className={`border-b last:border-0 align-top ${voided ? "text-muted-foreground" : ""}`}>
                      <td className="py-2">{p.payout_date}</td>
                      <td>{names.get(p.owner_id) || "Unknown"}</td>
                      <td>{p.through_date || "—"}</td>
                      <td className="text-right tabular-nums">{p.rent_collected == null ? "—" : money(Number(p.rent_collected))}</td>
                      <td className="text-right tabular-nums">{p.expenses_deducted == null ? "—" : money(Number(p.expenses_deducted))}</td>
                      <td className="text-right tabular-nums">{money(fees)}</td>
                      <td className="text-right tabular-nums">{Number(p.adjustment || 0) ? money(Number(p.adjustment)) : "—"}</td>
                      <td className={`text-right tabular-nums font-medium ${voided ? "line-through" : ""}`}>{money(Number(p.amount))}</td>
                      <td>
                        {p.payment_method}
                        {p.reference_number ? ` #${p.reference_number}` : ""}
                        {p.notes && <span className="block text-xs text-muted-foreground">{p.notes}</span>}
                        {voided && <span className="block text-xs">Void: {p.void_reason}</span>}
                      </td>
                      <td className="text-right">{!voided && <VoidPayoutButton payoutId={p.id} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
