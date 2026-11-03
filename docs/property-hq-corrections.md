# Property HQ corrections

## Changes and root causes

1. **Overdue payments:** screens previously trusted stored statuses, and check-overdue contained lease-alert code. All financial displays now read the RLS-respecting payment_balances view, which derives status from due date, manager billing timezone and grace days. The cron persists the same calculation. Default: late the day after the due date. Grace settings are in Settings. Automatic late fees remain disabled because fee amounts and lease authorization have not been specified.
2. **Landing page:** hard-coded preview figures now explicitly say they are illustrative and are not account data.
3. **Typos:** Berkshire #10 city and Rental Agreement filename corrected in the reviewed account. Address validation trims city, normalizes state, checks state/ZIP formats and rejects the known city misspelling. City suggestions include Greencastle; this is not an authoritative nationwide address service. Studio bedroom/bathroom values now preserve zero.
4. **Demo data:** Claude Codemaster flagged as demo, without deleting history. Tenant forms expose the flag; Settings can hide demo tenants and their payments from financial displays. Defaults preserve visibility. The reported $800 invoice belongs to this demo tenant, so hiding demos legitimately removes it from financial totals.
5. **Empty states:** Owners already had explanatory text and Add Owner. Leases now offers a direct Add lease/template-install action. Existing payment, maintenance and message empty states retained.
6. **Consistency:** shared receipt/pending/overdue totals, dashboard expense totals and explicit forecast labeling. Ledger no longer credits a partial invoice in full. Partial receipts have an amount_paid field, outstanding balance and remaining-balance checkout. All-time report filter supports reconciliation; rent reports use due dates and cash reports use receipt dates. New lease billing terms generate linked recurring schedules on signing, respect lease dates and stop on voiding. Database triggers validate rental and owner relationships; deletion restrictions prevent silent detachment. The Data consistency report identifies legacy missing assignments/billing terms rather than guessing them.
7. **CRUD fixes:** payment edit now updates the selected record rather than inserting another. Added payment deletion. Improved narrow-screen form spacing and wrapping. Database CRUD tested for property, owner, tenant, lease, payment, expense, maintenance, vendor, message and file metadata. These database tests do not establish browser UI, storage upload, signing, message delivery or mobile end-to-end success.

## Database

Applied to project fxmlwozvjzzntorolhtv: migration 20261031153532_property_hq_consistency.sql. Includes billing settings with RLS, demo flags, partial balances, lease billing columns, linked schedules, duplicate-generation indexes, relationship/address triggers, security-invoker views, and a service-role-only status-refresh function. Existing missing tenant assignments remain visible in the data-quality report; future new/reassigned tenants require a property. Existing leases require review of normalized billing terms; PDF fields are not parsed automatically.

## Verification

- Production Next.js build passed with network access enabled.
- TypeScript passed; 16 unit tests passed.
- ESLint: zero errors, eight existing warnings.
- Migration and ten-entity CRUD/validation/RLS smoke test passed in a transaction followed by rollback; migration then applied successfully, and the reviewed invoice was verified as overdue with $800 balance and demo flag.
- SQL smoke script: test/sql/property-hq-consistency.sql. It targets the reviewed manager for an authenticated-role test and must be wrapped in BEGIN/ROLLBACK; adjust the manager UUID for another environment.
- Supabase advisor: existing is_tenant_of security-definer and password-protection warnings remain; new views use security_invoker.

## Remaining setup and limitations

Terminal network commands need the environment's supported network permission enabled. Configured Supabase API key bindings currently return HTTP 401 Invalid API key even though setup reports them ready; re-save the correct project URL/key bindings through environment secret settings. Never put service-role keys in NEXT_PUBLIC variables or client code. No connected browser was available to verify signed-in or mobile flows. No real emails, messages, payments or lease signatures were sent during testing. UI changes need merging/deployment separately from the already-applied database migration. No new hosting environment variables are required; the existing CRON_SECRET must remain configured in production.
