import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
export default async function DataQualityPage() {
  const db=await createClient()
  const {data,error}=await db.from("rental_data_issues").select("*")
  if (error) throw new Error("Unable to check rental data")
  return <div className="space-y-4 pt-12 lg:pt-0"><h1 className="text-2xl font-bold">Data consistency checks</h1>
    <p className="text-muted-foreground">Assign properties and complete lease billing terms using the source records. Existing missing relationships require your choice; the app cannot infer them.</p>
    {data?.length ? <ul className="space-y-3">{data.map((r,i)=><li key={i} className="border rounded-lg p-4"><p>{r.issue}</p><Link className="text-primary underline" href={r.record_type==="tenant" ? `/dashboard/tenants/${r.record_id}/edit` : `/dashboard/leases/${r.record_id}`}>Review {r.record_type}</Link></li>)}</ul> : <p>No missing rental relationships or billing terms found.</p>}
  </div>
}
