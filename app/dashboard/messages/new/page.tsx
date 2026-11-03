import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { MessageForm } from "@/components/forms/message-form"

export default async function NewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const { data: tenants } = await supabase
    .from("visible_tenants")
    .select("*")
    .eq("status", "active")
    .order("first_name")

  return (
    <div className="max-w-2xl mx-auto pt-12 lg:pt-0">
      <MessageForm
        tenants={tenants || []}
        userId={user.id}
        defaultTenantId={params.tenant}
      />
    </div>
  )
}
