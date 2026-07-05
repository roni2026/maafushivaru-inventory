# send-issue-reminders

Edge Function that pushes "Issue Without Requisition" alerts to the mobile
app via Expo's push API. Two triggers feed it:

1. **Instant alert** — fires the moment a new no-req batch is issued (from
   web or mobile), notifying every registered device.
2. **Daily kitchen reminder** — Main Kitchen gets reminded before 8:30am,
   Staff Kitchen before 10:30am (Maldives time), for anything still
   `pending_req` from a previous day.

The app itself already raises an **instant in-app notification** via a
Supabase Realtime subscription (see `useIssueWithoutReqAlerts` in the mobile
app) whenever a `manual_issues` row is inserted — that works as long as the
app is open, no deployment needed. This Edge Function is the optional
upgrade so the alert also arrives as a real push notification when the app
is closed / in the background.

## One-time setup (per Supabase project)

```bash
supabase functions deploy send-issue-reminders
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # Project Settings → API
```

## Wire up the two triggers

- **Daily reminders** — uncomment the two `cron.schedule(...)` blocks at the
  bottom of `supabase/migrations/020_issue_without_req_enhancements.sql`,
  filling in your project ref and a Vault secret for the function's bearer
  token. Requires the `pg_cron` and `pg_net` extensions (Database →
  Extensions in the dashboard).
- **Instant push on insert** — add a Database Webhook (Database → Webhooks)
  on `manual_issues`, event = INSERT, calling this function's URL with
  `{ "mode": "issued", "batch_id": "<record.batch_id>" }`, or simply call the
  function from the app right after a successful insert.

Until these are wired up, everything still works end-to-end for anyone with
the app open (Realtime + local notifications) — this function only adds
true background push delivery.
