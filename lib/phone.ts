/**
 * Mirrors public.normalize_us_phone in the database: returns +1XXXXXXXXXX for
 * a 10-digit US number (or 11 digits starting with 1), +<digits> for an
 * explicit international number, otherwise null.
 */
export function normalizeUsPhone(raw: string | null | undefined): string | null {
  const value = raw ?? ""
  const digits = value.replace(/[^0-9]/g, "")
  if (/^[0-9]{10}$/.test(digits)) return `+1${digits}`
  if (/^1[0-9]{10}$/.test(digits)) return `+${digits}`
  if (/^\s*\+/.test(value) && /^[1-9][0-9]{7,14}$/.test(digits)) return `+${digits}`
  return null
}
