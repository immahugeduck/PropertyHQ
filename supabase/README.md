# Supabase backup

Everything Property HQ needs from Supabase that is not data, captured from the
live project on 2026-10-13 so the database can be rebuilt anywhere.

| Path | What it is |
| --- | --- |
| `schema.sql` | Full schema snapshot: 19 tables, constraints, indexes, functions, triggers, row-level security on every table (61 policies), the `property-files` storage bucket and its 4 policies. No data, no secrets. |
| `migrations/*.sql` | Changes made after the snapshot, applied in filename order. |
| `functions/*/index.ts` | Source of the 3 edge functions deployed in the project (`process-monthly-rent`, `create-stripe-payment`, `stripe-webhook`). |

Source project: `supabase-propertyhq`, ref `fxmlwozvjzzntorolhtv` (us-east-1).

`schema.sql` was generated from the Postgres catalog (`pg_catalog`,
`pg_policies`, `storage.buckets`, `cron.job`), so it describes what is actually
deployed. The older files in `scripts/` were partial, hand-run migrations and
did not include the base tables (properties, tenants, rent payments, messages,
expenses, and others). The live database's own migration history
(`supabase_migrations.schema_migrations`, 14 entries) also starts after those
base tables were created.

## Rebuilding on a new Supabase project

1. Create the project, then open **SQL Editor** and run `supabase/schema.sql`
   once, on the empty database, followed by each file in
   `supabase/migrations/` in filename order.
2. In **Authentication → URL Configuration**, set the site URL and redirect
   URLs for the Vercel deployment (see `NEXT_PUBLIC_SITE_URL` and
   `NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL` in the app).
3. In Vercel, point the app at the new project: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Edge functions are optional (see Known issues). To deploy them, use the
   Supabase CLI (`supabase functions deploy <name>`) and set their secrets:
   `STRIPE_SECRET_KEY`, and for `stripe-webhook` also
   `STRIPE_WEBHOOK_SIGNING_SECRET`. `SUPABASE_URL` and `SUPABASE_SECRET_KEYS`
   are provided by Supabase automatically.

Auth users, rows and uploaded files are data and are not part of this backup.

## Tenant and maintenance handoff upgrade

`20261108181500_tenant_maintenance_handoff.sql` keeps the coordinator RPC contract
and formats maintenance work orders from the saved ticket. The manager receives
the original context; maintenance receives the repair, access restrictions,
availability and the next scheduling step. Unchanged permission answers and
unresolved entry clarifications no longer restart maintenance scheduling.

Apply this additive migration after the existing permission-led scheduling
migration and before releasing the matching PropertyHQ-Bot workflow upgrade.
It does not modify live tickets or replay existing queued messages. The bot's
raw-text/database examples run with this migration against PGlite, using only
fixture contacts. The three-upgrade plan and example results live in the bot's
`docs/superpowers/plans/2026-11-08-tenant-maintenance-upgrades.md` and
`docs/TENANT_MAINTENANCE_RESULTS.md`.

## Manager review and exact replies

`20261111003933_manager_review_replies.sql` adds saved manager-review status and
the last exact tenant-facing manager reply to existing requests. Pending reviews
go to the manager; maintenance receives a work order only after a separate
`APPROVE INSPECTION #1001` or `APPROVE WORK #1001` command. Inspection completion
returns findings to manager review and clears a used inspection entry grant.
This applies to completion through either the bot or the existing portal form.
Pending review blocks portal work-start/completion status changes while retaining
intentional cancellation. Tenant entry changes remain saved during review.

Managers send outward wording with `SEND #1001: your exact message`. `SEND:`
without a number works only when exactly one request is open. Bodies are preserved
verbatim, including line breaks, and limited to 1,600 characters; overlong bodies
are rejected rather than shortened. Conditional wording never authorizes work.
Other review comments remain internal, and tenant acknowledgements create no new
staff alert. Explicitly marked portal review requests use the same routing;
emergency form reports bypass the optional-review marker.

Apply this additive migration after `20261108181500_tenant_maintenance_handoff.sql`
and before releasing the matching PropertyHQ-Bot update. No existing ticket is
reclassified and no queued message is replayed. Unmarked portal descriptions
retain existing intake behavior. The bot's `docs/MANAGER_REVIEW_RESULTS.md` records
the fictional database examples and verification limits. This change has been
verified locally; the subsequent context-followup release records the rollout.

## Compact maintenance requests and durable staff focus

`20261111214912_context_followup.sql` follows the manager-review migration. It
preserves cleaned `repairSummary` and `accessNotes` in request facts, generates
the compact repair/access/calendar work order and keeps three tentative calendar
suggestions even while permission is TBD. Bookings still require the applicable
permission, staff approval and current conflict checks. Numeric selection must
match the displayed proposal version, full proposal and chosen member.

The context RPC includes the latest delivered open request for each staff phone,
scoped to its account and outside the recent-message limit. Scheduling replies
without mutations can carry `replyJobId`; the commit RPC validates its scope and
records it on SMS history so the next answer stays with the same review. Existing
function ACLs, account locks, SID deduplication and manager-review gates remain.

Deploy the matching bot after the additive migrations. No historical messages
are replayed or appointments automatically booked by these migrations. Bot
`docs/CONTEXT_FOLLOWUP_RESULTS.md` contains the example and measured tests.

## Known issues found while exporting (not changed by this backup)

- **Edge functions are unused by the app.** Nothing in `app/`, `lib/` or
  `components/` calls them. Rent invoices come from the Vercel cron
  `/api/cron/generate-invoices` and Stripe goes through the Next.js routes
  (`app/api/stripe`, `app/actions/rent-checkout.ts`).
- **The `process-monthly-rent-day-1` pg_cron job cannot run.** It calls
  `net.http_post`, but the `pg_net` extension is not installed, and the vault
  secrets it reads (`project_url`, `edge_invoke_key`) do not exist. It is
  recorded in `schema.sql` but commented out.
- **`stripe-webhook` is deployed with JWT verification on.** Stripe does not
  send a Supabase JWT, so Supabase would reject Stripe's calls before the
  function runs. Moot while the function is unused.
- **Supabase security advisor warnings:**
  - `public.is_tenant_of` is `SECURITY DEFINER` and callable by `anon` and
    `authenticated` through `/rest/v1/rpc/is_tenant_of`. It only answers
    "is the signed-in user this tenant?", but `EXECUTE` should be revoked from
    `anon`.
  - `public.set_updated_at` has no fixed `search_path`.
  - Leaked-password protection (HaveIBeenPwned check) is off in Auth settings.
- **`public.todos`** is a leftover from the Supabase starter template and is
  not used by the app.
- **Nine tables have an `updated_at` column but no trigger maintaining it**:
  `expenses`, `file_folders`, `files`, `maintenance_requests`, `properties`,
  `property_owners`, `rent_payments`, `rent_schedules`, `tenants`. Their
  `updated_at` only changes when the app sets it explicitly.
