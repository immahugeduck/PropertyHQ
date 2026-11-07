import { describe, expect, it } from "vitest"
import { normalizeUsPhone } from "./phone"

describe("normalizeUsPhone", () => {
  it("accepts common US formats", () => {
    expect(normalizeUsPhone("(765) 770-9030")).toBe("+17657709030")
    expect(normalizeUsPhone("765.770.9030")).toBe("+17657709030")
    expect(normalizeUsPhone("1-765-770-9030")).toBe("+17657709030")
    expect(normalizeUsPhone("+1 765 770 9030")).toBe("+17657709030")
  })

  it("rejects incomplete numbers", () => {
    expect(normalizeUsPhone("770-9030")).toBeNull()
    expect(normalizeUsPhone("")).toBeNull()
    expect(normalizeUsPhone(null)).toBeNull()
  })
})
