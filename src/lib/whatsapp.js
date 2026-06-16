// ============================================================
// Twilio WhatsApp API helper
// ============================================================

export async function sendWhatsAppMessage({ accountSid, authToken, from, to, body }) {
  if (!accountSid || !authToken) throw new Error('Twilio credentials not configured in Settings.')
  if (!to) throw new Error('WhatsApp recipient number not configured in Settings.')

  const fromNum = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`
  const toNum   = to.startsWith('whatsapp:')   ? to   : `whatsapp:${to}`

  const params = new URLSearchParams()
  params.append('From', fromNum)
  params.append('To',   toNum)
  params.append('Body', body)

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization':  'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type':   'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Twilio error: ${res.status}`)
  }
  return res.json()
}

// ── Message builders ───────────────────────────────────────

export function buildExpiryWhatsApp({ items, thresholdDays, resortName }) {
  const urgency = thresholdDays <= 7 ? '🔴 CRITICAL' : thresholdDays <= 15 ? '🟠 WARNING' : '🟡 NOTICE'
  const lines = items.slice(0, 15).map(i =>
    `• ${i.part_number} – ${i.name} (${i.current_stock} ${i.unit}) – Exp: ${i.expiry_date}`
  ).join('\n')
  const more = items.length > 15 ? `\n...and ${items.length - 15} more items.` : ''
  return `${urgency} *${resortName}*\n\n*${items.length} item(s) expiring ≤${thresholdDays} days:*\n\n${lines}${more}\n\n_Log in to the inventory system for full details._`
}

export function buildLowStockWhatsApp({ items, resortName }) {
  const lines = items.slice(0, 15).map(i =>
    `• ${i.part_number} – ${i.name}\n  Stock: ${i.current_stock} / Min: ${i.min_stock} ${i.unit}`
  ).join('\n')
  const more = items.length > 15 ? `\n...and ${items.length - 15} more items.` : ''
  return `⚠️ *${resortName} – Low Stock Alert*\n\n*${items.length} item(s) at or below minimum:*\n\n${lines}${more}\n\n_Log in to create an order._`
}

export function buildTestWhatsApp(resortName) {
  return `✅ *${resortName}*\n\nWhatsApp integration is working correctly!\n\nYou will receive expiry and low-stock alerts on this number.\n\n_Outrigger Maafushivaru Inventory System_`
}
