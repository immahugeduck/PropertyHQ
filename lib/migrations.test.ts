import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Supabase tracks applied migrations by the leading version number. Two files
// with the same version means one is silently skipped on a fresh database
// (this has happened twice when branches were developed in parallel).
describe("supabase migrations", () => {
  it("have unique version numbers", () => {
    const files = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"))
    const versions = files.map((f) => f.split("_")[0])
    const dupes = versions.filter((v, i) => versions.indexOf(v) !== i)
    expect(dupes, `duplicate migration versions: ${dupes.join(", ")}`).toEqual([])
  })
})
