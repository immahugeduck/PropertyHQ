import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

/** Persist the same read-time status used by every financial screen. No email side effects. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret ? request.headers.get("authorization") !== `Bearer ${secret}` : process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const db = createServiceClient()
  const { data, error } = await db.rpc("refresh_payment_statuses")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, updated: data })
}
