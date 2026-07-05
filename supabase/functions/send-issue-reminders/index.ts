// send-issue-reminders
//
// Supabase Edge Function (Deno). Two call shapes:
//
//   1. Instant "issued without req" alert — called right after a new batch is
//      inserted (e.g. from a Database Webhook on manual_issues INSERT, or the
//      app can call it directly):
//        POST { mode: "issued", batch_id: "<uuid>" }
//      Pushes to EVERY registered mobile token so all staff using the app see
//      it, and stamps notified_at on the rows in that batch.
//
//   2. Daily kitchen reminder — called by pg_cron (see the migration) once
//      for Main Kitchen (before 08:30) and once for Staff Kitchen (before
//      10:30), Maldives time:
//        POST { kitchen: "MAIN KITCHEN" | "STAFF KITCHEN" }
//      Pushes a reminder listing everything still `pending_req` for that
//      kitchen, to tokens tagged for that kitchen (or untagged, so general
//      staff still get it).
//
// Sends via Expo's push HTTP API directly — no extra service/SDK required:
// https://docs.expo.dev/push-notifications/sending-notifications/
//
// Env vars required (set with `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function client() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function sendExpoPush(tokens: string[], title: string, body: string, data: Record<string, unknown> = {}) {
  const uniq = [...new Set(tokens)].filter(Boolean);
  if (!uniq.length) return { sent: 0 };
  const messages = uniq.map((to) => ({ to, title, body, sound: 'default', data }));
  // Expo caps batches at 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    }).catch(() => null);
  }
  return { sent: uniq.length };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = client();

    // ── 1. Instant "issued without requisition" alert ──────────────────
    if (body.mode === 'issued' && body.batch_id) {
      const { data: rows } = await supabase
        .from('manual_issues')
        .select('id,item_name,quantity,unit,destination_location,notified_at')
        .eq('batch_id', body.batch_id);

      const pending = (rows || []).filter((r) => !r.notified_at);
      if (!pending.length) return Response.json({ ok: true, skipped: 'already notified' });

      const { data: tokenRows } = await supabase.from('push_tokens').select('token');
      const tokens = (tokenRows || []).map((t) => t.token);

      const dest = pending[0]?.destination_location || 'destination';
      const title = 'Items issued without requisition';
      const summary = pending.length === 1
        ? `${pending[0].quantity} ${pending[0].unit || ''} ${pending[0].item_name} → ${dest}`
        : `${pending.length} item(s) issued to ${dest} — requisition still needed`;

      await sendExpoPush(tokens, title, summary, { type: 'manual_issue_created', batch_id: body.batch_id });
      await supabase.from('manual_issues').update({ notified_at: new Date().toISOString() }).eq('batch_id', body.batch_id);

      return Response.json({ ok: true, notified: pending.length, pushed_to: tokens.length });
    }

    // ── 2. Daily kitchen reminder (still pending from a previous day) ──
    if (body.kitchen === 'MAIN KITCHEN' || body.kitchen === 'STAFF KITCHEN') {
      const todayStr = new Date().toISOString().split('T')[0];
      const { data: rows } = await supabase
        .from('manual_issues')
        .select('id,item_name,quantity,unit,date')
        .eq('status', 'pending_req')
        .eq('kitchen', body.kitchen)
        .lt('date', todayStr);

      if (!rows?.length) return Response.json({ ok: true, skipped: 'nothing pending' });

      const { data: tokenRows } = await supabase
        .from('push_tokens')
        .select('token')
        .or(`kitchen.eq.${body.kitchen},kitchen.is.null`);
      const tokens = (tokenRows || []).map((t) => t.token);

      const deadline = body.kitchen === 'MAIN KITCHEN' ? '8:30am' : '10:30am';
      const title = `${body.kitchen}: requisition still pending`;
      const summary = `${rows.length} item(s) issued without a requisition — please provide it before ${deadline} today.`;

      await sendExpoPush(tokens, title, summary, { type: 'issue_reminder', kitchen: body.kitchen });

      const nowIso = new Date().toISOString();
      await supabase.from('manual_issues')
        .update({ last_reminder_at: nowIso })
        .in('id', rows.map((r) => r.id));

      return Response.json({ ok: true, reminded: rows.length, pushed_to: tokens.length });
    }

    return Response.json({ ok: false, error: 'Unrecognised request body' }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
});
