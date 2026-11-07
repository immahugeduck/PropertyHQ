"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, Plus, Trash2, UserRound } from "lucide-react"
import { toast } from "sonner"
import type { HouseholdMember } from "@/lib/types"

type Result = { ok: boolean; error?: string }

interface HouseholdEditorProps {
  members: HouseholdMember[]
  addAction: (formData: FormData) => Promise<Result>
  removeAction: (memberId: string) => Promise<Result>
  /** Show who added each person (useful to the manager). */
  showAddedBy?: boolean
  emptyText?: string
}

export function HouseholdEditor({
  members,
  addAction,
  removeAction,
  showAddedBy = false,
  emptyText = "No one listed yet.",
}: HouseholdEditorProps) {
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    setSaving(true)
    const res = await addAction(new FormData(form))
    setSaving(false)
    if (res.ok) {
      toast.success("Added")
      form.reset()
      setAdding(false)
    } else {
      toast.error(res.error || "Could not add that person.")
    }
  }

  async function handleRemove(member: HouseholdMember) {
    if (!window.confirm(`Remove ${member.full_name} from the household?`)) return
    setRemovingId(member.id)
    const res = await removeAction(member.id)
    setRemovingId(null)
    if (res.ok) toast.success("Removed")
    else toast.error(res.error || "Could not remove that person.")
  }

  return (
    <div className="space-y-3">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{m.full_name}</p>
                  {m.is_minor && <Badge variant="secondary" className="text-xs">Under 18</Badge>}
                  {showAddedBy && (
                    <Badge variant="outline" className="text-xs">
                      Added by {m.added_by === "tenant" ? "tenant" : "you"}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[m.relationship, m.phone].filter(Boolean).join(" · ") || "No details"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(m)}
                disabled={removingId === m.id}
                title="Remove"
              >
                {removingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="hh-name">Full name</Label>
            <Input id="hh-name" name="full_name" required maxLength={120} autoComplete="off" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hh-relationship">Relationship</Label>
              <Input id="hh-relationship" name="relationship" placeholder="Spouse, son, roommate…" maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hh-phone">Phone (optional)</Label>
              <Input id="hh-phone" name="phone" type="tel" maxLength={40} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_minor" className="h-4 w-4 accent-primary" />
            Age 12–17
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add person
        </Button>
      )}
    </div>
  )
}
