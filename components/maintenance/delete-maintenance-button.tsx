"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Trash2 } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"

interface DeleteMaintenanceButtonProps {
  requestId: string
  requestTitle: string
}

export function DeleteMaintenanceButton({ requestId, requestTitle }: DeleteMaintenanceButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase
      .from("maintenance_requests")
      .delete()
      .eq("id", requestId)

    if (error) {
      console.error("Error deleting request:", error)
      toast.error(`Couldn't delete this request: ${error.message}`)
      setLoading(false)
      return
    }

    router.push("/dashboard/maintenance")
    router.refresh()
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Maintenance Request</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &quot;{requestTitle}&quot;? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading && <Spinner className="mr-2 h-4 w-4" />}
            Delete Request
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
