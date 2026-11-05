/**
 * Shared, server-safe reporting helpers.
 *
 * This lives outside the `"use client"` report-filters component so server
 * components (the report pages) can call it directly. Importing and calling a
 * function from a client module on the server throws
 * "Attempted to call getDateRange() from the server".
 */

/** Resolve a date-range preset (or explicit custom range) to ISO `from`/`to` dates. */
export function getDateRange(preset: string, from?: string, to?: string): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  switch (preset) {
    case "all-time": return { from: "0001-01-01", to: "9999-12-31" }
    case "custom":
      return {
        from: from || `${y}-01-01`,
        to: to || `${y}-12-31`,
      }
    case "this-month":
      return {
        from: new Date(y, m, 1).toISOString().slice(0, 10),
        to: new Date(y, m + 1, 0).toISOString().slice(0, 10),
      }
    case "last-month":
      return {
        from: new Date(y, m - 1, 1).toISOString().slice(0, 10),
        to: new Date(y, m, 0).toISOString().slice(0, 10),
      }
    case "this-quarter": {
      const q = Math.floor(m / 3)
      return {
        from: new Date(y, q * 3, 1).toISOString().slice(0, 10),
        to: new Date(y, q * 3 + 3, 0).toISOString().slice(0, 10),
      }
    }
    case "last-quarter": {
      const q = Math.floor(m / 3)
      const lq = q === 0 ? 3 : q - 1
      const ly = q === 0 ? y - 1 : y
      return {
        from: new Date(ly, lq * 3, 1).toISOString().slice(0, 10),
        to: new Date(ly, lq * 3 + 3, 0).toISOString().slice(0, 10),
      }
    }
    case "last-year":
      return {
        from: `${y - 1}-01-01`,
        to: `${y - 1}-12-31`,
      }
    case "this-year":
    default:
      return {
        from: `${y}-01-01`,
        to: `${y}-12-31`,
      }
  }
}
