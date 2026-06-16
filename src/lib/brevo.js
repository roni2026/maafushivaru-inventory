// ============================================================
// Brevo (formerly Sendinblue) transactional email API helper
// ============================================================

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

/**
 * Send a transactional email via Brevo.
 */
export async function sendBrevoEmail({ apiKey, to, subject, htmlContent, textContent }) {
  if (!apiKey) throw new Error('Brevo API key is not configured.')
  if (!to)     throw new Error('Recipient email is not configured.')

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      accept:         'application/json',
      'api-key':      apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender:      { name: 'Outrigger Maafushivaru Inventory', email: 'noreply@outrigger-maafushivaru.com' },
      to:          [{ email: to }],
      subject,
      htmlContent,
      textContent,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Brevo API error: ${res.status}`)
  }
  return res.json()
}

// ── Email builders ────────────────────────────────────────

export function buildExpiryAlertEmail({ items, thresholdDays, resortName }) {
  const urgency = thresholdDays <= 7 ? '🔴 CRITICAL' : thresholdDays <= 15 ? '🟠 WARNING' : '🟡 NOTICE'
  const borderColor = thresholdDays <= 7 ? '#dc2626' : thresholdDays <= 15 ? '#ea580c' : '#ca8a04'
  const bgColor     = thresholdDays <= 7 ? '#fef2f2' : thresholdDays <= 15 ? '#fff7ed'  : '#fefce8'

  // Group by store
  const grouped = items.reduce((acc, item) => {
    const s = item.stores?.name || 'Unknown Store'
    ;(acc[s] = acc[s] || []).push(item)
    return acc
  }, {})

  const storeHtml = Object.entries(grouped).map(([storeName, storeItems]) => `
    <h3 style="color:#0f766e;margin:24px 0 8px;">${storeName}</h3>
    <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#0f766e;color:white;">
          <th style="padding:10px 12px;text-align:left;">Part #</th>
          <th style="padding:10px 12px;text-align:left;">Item Name</th>
          <th style="padding:10px 12px;text-align:left;">Stock</th>
          <th style="padding:10px 12px;text-align:left;">Expiry Date</th>
        </tr>
      </thead>
      <tbody>
        ${storeItems.map(i => `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 12px;">${i.part_number}</td>
          <td style="padding:8px 12px;">${i.name}</td>
          <td style="padding:8px 12px;">${i.current_stock} ${i.unit}</td>
          <td style="padding:8px 12px;color:${borderColor};font-weight:600;">
            ${i.expiry_date ? new Date(i.expiry_date).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'N/A'}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`).join('')

  const subject = `${urgency} – ${items.length} item(s) expiring ≤${thresholdDays} days | ${resortName}`

  const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;max-width:700px;margin:0 auto;background:#f1f5f9;padding:20px;">
  <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#0f766e,#0369a1);padding:32px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:24px;">${resortName}</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;">Inventory Expiry Alert</p>
    </div>
    <div style="padding:32px;">
      <div style="background:${bgColor};border-left:4px solid ${borderColor};padding:16px;border-radius:4px;margin-bottom:24px;">
        <p style="margin:0;font-weight:600;color:${borderColor};">${urgency}: ${items.length} item(s) expiring within ${thresholdDays} days</p>
        <p style="margin:8px 0 0;color:#64748b;font-size:14px;">Please review and take appropriate action.</p>
      </div>
      ${storeHtml}
      <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:13px;">
        <p>Automated alert from the ${resortName} Inventory Management System.</p>
        <p>Generated on ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}</p>
      </div>
    </div>
  </div>
</body></html>`

  const textContent = [
    `${resortName} – Inventory Expiry Alert`,
    `${urgency}: ${items.length} item(s) expiring within ${thresholdDays} days`,
    '',
    ...Object.entries(grouped).map(([store, si]) =>
      `${store}:\n${si.map(i => `  - ${i.part_number} | ${i.name} | Stock: ${i.current_stock} ${i.unit} | Expiry: ${i.expiry_date || 'N/A'}`).join('\n')}`
    ),
    '',
    `Generated: ${new Date().toLocaleDateString()}`,
  ].join('\n')

  return { subject, htmlContent, textContent }
}

// ── Main alert runner ─────────────────────────────────────

export async function checkAndSendExpiryAlerts({ supabase, apiKey, recipientEmail, resortName }) {
  const today    = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]
  const results  = { sent: 0, errors: [] }

  for (const thresholdDays of [7, 15, 30]) {
    // Fetch all items with non-null expiry and positive stock
    const { data: allItems, error } = await supabase
      .from('items')
      .select('*, stores(name)')
      .not('expiry_date', 'is', null)
      .gt('current_stock', 0)

    if (error || !allItems?.length) continue

    // Keep only items whose days-until-expiry equals this threshold
    const matchingItems = allItems.filter(item => {
      const expiry = new Date(item.expiry_date)
      expiry.setHours(0, 0, 0, 0)
      const diff = Math.ceil((expiry - today) / 86400000)
      return diff === thresholdDays
    })
    if (!matchingItems.length) continue

    // Deduplication: skip items already emailed today for this threshold
    const { data: alreadySent } = await supabase
      .from('email_alerts_sent')
      .select('item_id')
      .eq('alert_threshold_days', thresholdDays)
      .eq('recipient_email', recipientEmail)
      .gte('sent_at', `${todayStr}T00:00:00Z`)

    const sentIds  = new Set((alreadySent || []).map(a => a.item_id))
    const newItems = matchingItems.filter(i => !sentIds.has(i.id))
    if (!newItems.length) continue

    // Build & send
    const { subject, htmlContent, textContent } = buildExpiryAlertEmail({
      items: newItems, thresholdDays, resortName,
    })

    try {
      await sendBrevoEmail({ apiKey, to: recipientEmail, subject, htmlContent, textContent })
      await supabase.from('email_alerts_sent').insert(
        newItems.map(item => ({
          item_id:              item.id,
          alert_threshold_days: thresholdDays,
          recipient_email:      recipientEmail,
        }))
      )
      results.sent += newItems.length
    } catch (err) {
      results.errors.push(`Threshold ${thresholdDays}d: ${err.message}`)
    }
  }

  return results
}

export function buildTestEmail(resortName) {
  const subject = `✅ Test Email – ${resortName} Inventory System`
  const htmlContent = `<div style="font-family:Arial,sans-serif;padding:40px;text-align:center;">
    <h2 style="color:#0f766e;">✅ Test Email Successful</h2>
    <p>Your Brevo integration for <strong>${resortName}</strong> is working correctly.</p>
    <p style="color:#64748b;font-size:14px;">You will receive expiry alerts at 30, 15, and 7 days before expiration.</p>
  </div>`
  const textContent = `Test Email - ${resortName} Inventory System\nBrevo integration is working correctly.`
  return { subject, htmlContent, textContent }
}
