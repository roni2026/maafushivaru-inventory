// ─────────────────────────────────────────────────────────────
// brevo.js  —  Automated email report service
// Uses Brevo Transactional Email API to send inventory reports
// Docs: https://developers.brevo.com/reference/sendtransacemail
// ─────────────────────────────────────────────────────────────

const BREVO_API = 'https://api.brevo.com/v3/smtp/email'

// ── Helpers ───────────────────────────────────────────────────
function today() {
  return new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}
function weekRange() {
  const now  = new Date()
  const mon  = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1)
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6)
  const fmt  = (d) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
  return `${fmt(mon)} – ${fmt(sun)}, ${now.getFullYear()}`
}
function daysLeft(dateStr) {
  if (!dateStr) return null
  const exp = new Date(dateStr); exp.setHours(0,0,0,0)
  const now = new Date();       now.setHours(0,0,0,0)
  return Math.ceil((exp - now) / 86400000)
}
function expiryBadge(days) {
  if (days === null)  return { label: '—',            bg:'#f1f5f9', color:'#64748b', border:'#e2e8f0' }
  if (days < 0)       return { label: 'EXPIRED',      bg:'#fef2f2', color:'#dc2626', border:'#fecaca' }
  if (days <= 7)      return { label: `${days}d left`, bg:'#fef2f2', color:'#dc2626', border:'#fecaca' }
  if (days <= 15)     return { label: `${days}d left`, bg:'#fff7ed', color:'#ea580c', border:'#fed7aa' }
  return                     { label: `${days}d left`, bg:'#fefce8', color:'#ca8a04', border:'#fde68a' }
}
function actionForExpiry(days) {
  if (days === null) return '—'
  if (days < 0)      return 'Dispose / Return immediately'
  if (days <= 7)     return 'Use immediately'
  if (days <= 15)    return 'Prioritise in issuances'
  return                    'Monitor closely'
}
function issueBadge(type) {
  const map = {
    wrong_item:    { bg:'#fef2f2', color:'#dc2626', border:'#fecaca', label:'Wrong Item'     },
    short_delivery:{ bg:'#fff7ed', color:'#ea580c', border:'#fed7aa', label:'Short Delivery' },
    damaged:       { bg:'#fef2f2', color:'#dc2626', border:'#fecaca', label:'Damaged'        },
    expired:       { bg:'#fefce8', color:'#ca8a04', border:'#fde68a', label:'Expired'        },
    wrong_spec:    { bg:'#fff7ed', color:'#ea580c', border:'#fed7aa', label:'Wrong Spec'     },
    other:         { bg:'#f8fafc', color:'#64748b', border:'#e2e8f0', label:'Other'          },
  }
  return map[type] || map.other
}

// ── HTML Email Builder ─────────────────────────────────────────
function buildHTML({ claims, expiringItems }) {
  const expired    = expiringItems.filter(i => daysLeft(i.expiry_date) !== null && daysLeft(i.expiry_date) < 0)
  const expiringSoon = expiringItems.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d >= 0 })

  // Claims rows HTML
  const claimsRows = claims.length === 0
    ? `<tr><td colspan="7" style="padding:16px;text-align:center;font-family:Arial,sans-serif;color:#94a3b8;font-size:13px;">No pending delivery claims this week.</td></tr>`
    : claims.map((c, i) => {
        const badge = issueBadge(c.issue_type)
        const bg    = i % 2 === 0 ? '#ffffff' : '#fafafa'
        return `
        <tr style="background:${bg};">
          <td style="padding:9px 10px;font-family:monospace;font-size:11px;color:#64748b;border-bottom:1px solid #f1f5f9;">${c.part_number || '—'}</td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">${c.item_name}</td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;font-size:12px;color:#64748b;border-bottom:1px solid #f1f5f9;" class="mob-hide">${c.store_name || '—'}</td>
          <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${c.ordered_qty || '—'} ${c.unit}</td>
          <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${c.received_qty || '0'} ${c.unit}</td>
          <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#dc2626;border-bottom:1px solid #f1f5f9;">${c.wrong_qty} ${c.unit}</td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;border-bottom:1px solid #f1f5f9;">
            <span style="background:${badge.bg};color:${badge.color};border:1px solid ${badge.border};border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;white-space:nowrap;">${badge.label}</span>
          </td>
        </tr>`
      }).join('')

  // Unique suppliers in claims
  const suppliers = [...new Set(claims.map(c => c.supplier_name))].join(', ') || '—'

  // Total claim qty
  const totalClaimQty = claims.reduce((s, c) => s + Number(c.wrong_qty), 0)

  // Expiry rows HTML (expired first, then near-expiry sorted by days)
  const allExpiry = [
    ...expired.map(i => ({ ...i, days: daysLeft(i.expiry_date) })),
    ...expiringSoon.sort((a,b) => daysLeft(a.expiry_date) - daysLeft(b.expiry_date)).map(i => ({ ...i, days: daysLeft(i.expiry_date) })),
  ]

  const expiryRows = allExpiry.length === 0
    ? `<tr><td colspan="7" style="padding:16px;text-align:center;font-family:Arial,sans-serif;color:#94a3b8;font-size:13px;">No items expiring within the next 30 days.</td></tr>`
    : allExpiry.map((item, i) => {
        const badge  = expiryBadge(item.days)
        const action = actionForExpiry(item.days)
        const bg     = item.days !== null && item.days < 0 ? '#fff1f2' : i % 2 === 0 ? '#ffffff' : '#fafafa'
        return `
        <tr style="background:${bg};">
          <td style="padding:9px 10px;font-family:monospace;font-size:11px;color:#64748b;border-bottom:1px solid #f1f5f9;">${item.part_number || '—'}</td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">${item.name}</td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;font-size:12px;color:#64748b;border-bottom:1px solid #f1f5f9;" class="mob-hide">${item.stores?.name || '—'}</td>
          <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">${item.current_stock} ${item.unit}</td>
          <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${item.expiry_date || '—'}</td>
          <td style="padding:9px 10px;text-align:center;border-bottom:1px solid #f1f5f9;">
            <span style="background:${badge.bg};color:${badge.color};border:1px solid ${badge.border};border-radius:4px;padding:2px 8px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;">${badge.label}</span>
          </td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;font-size:11px;color:${badge.color};font-weight:600;border-bottom:1px solid #f1f5f9;">${action}</td>
        </tr>`
      }).join('')

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title>Inventory Status Report</title>
<style type="text/css">
  *{box-sizing:border-box;}
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;}
  body{margin:0!important;padding:0!important;background:#f1f5f9;width:100%!important;}
  @media only screen and (max-width:620px){
    .email-container{width:100%!important;border-radius:0!important;box-shadow:none!important;}
    .section-pad{padding:20px 18px!important;}
    .header-pad{padding:22px 18px 18px!important;}
    .stat-row{display:block!important;}
    .stat-col{display:block!important;width:100%!important;border-right:none!important;border-bottom:1px solid rgba(255,255,255,0.15)!important;text-align:left!important;padding:10px 18px!important;}
    .stat-num{display:inline!important;font-size:18px!important;margin-right:8px!important;}
    .stat-lbl{display:inline!important;font-size:12px!important;}
    .mob-hide{display:none!important;}
    .tbl-wrap{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;display:block!important;}
    h1{font-size:19px!important;}
    h2{font-size:14px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 14px;">
<tr><td align="center">

<table role="presentation" class="email-container" width="640" cellpadding="0" cellspacing="0"
  style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,0.10);">

  <!-- HEADER -->
  <tr>
    <td class="header-pad" style="background:#00AEEF;padding:28px 36px 22px;">
      <p style="margin:0 0 5px;color:rgba(255,255,255,0.8);font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;">
        Outrigger Maafushivaru Resort &mdash; Store Department
      </p>
      <h1 style="margin:0 0 8px;color:#ffffff;font-family:Arial,sans-serif;font-size:22px;font-weight:700;line-height:1.3;">
        Inventory Status Report
      </h1>
      <p style="margin:0;color:rgba(255,255,255,0.85);font-family:Arial,sans-serif;font-size:13px;">
        &#128197; <strong>${today()}</strong> &nbsp;&middot;&nbsp; Week of <strong>${weekRange()}</strong>
      </p>
    </td>
  </tr>

  <!-- STAT BAR -->
  <tr>
    <td style="background:#0095cc;padding:0;">
      <table role="presentation" class="stat-row" width="100%" cellpadding="0" cellspacing="0" style="display:table;">
        <tr>
          <td class="stat-col" style="padding:13px 16px;text-align:center;border-right:1px solid rgba(255,255,255,0.2);">
            <p class="stat-num" style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:22px;font-weight:700;display:block;">${claims.length}</p>
            <p class="stat-lbl" style="margin:2px 0 0;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:1px;display:block;">Delivery Claims</p>
          </td>
          <td class="stat-col" style="padding:13px 16px;text-align:center;border-right:1px solid rgba(255,255,255,0.2);">
            <p class="stat-num" style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:22px;font-weight:700;display:block;">${expiringSoon.length}</p>
            <p class="stat-lbl" style="margin:2px 0 0;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:1px;display:block;">Expiring Soon</p>
          </td>
          <td class="stat-col" style="padding:13px 16px;text-align:center;">
            <p class="stat-num" style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:22px;font-weight:700;display:block;">${expired.length}</p>
            <p class="stat-lbl" style="margin:2px 0 0;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:1px;display:block;">Already Expired</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- GREETING -->
  <tr>
    <td class="section-pad" style="padding:28px 36px 0;">
      <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:15px;color:#1e293b;">Dear Sir,</p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#475569;line-height:1.75;">
        Please find below the weekly inventory status report covering delivery discrepancies
        and items approaching their expiry date. Immediate attention may be required on the items highlighted below.
      </p>
    </td>
  </tr>

  <!-- SECTION 1: DELIVERY CLAIMS -->
  <tr>
    <td class="section-pad" style="padding:26px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td style="border-left:4px solid #dc2626;padding-left:12px;">
            <h2 style="margin:0;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#dc2626;">
              &#10060;&nbsp; Section 1 &mdash; Delivery Discrepancies
            </h2>
            <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">
              Supplier(s): <strong style="color:#64748b;">${suppliers}</strong>
            </p>
          </td>
        </tr>
      </table>
      <div class="tbl-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid #e2e8f0;font-size:12px;min-width:480px;">
          <thead>
            <tr style="background:#fef2f2;">
              <th style="padding:9px 10px;text-align:left;color:#991b1b;font-family:Arial,sans-serif;border-bottom:1px solid #fecaca;">Part #</th>
              <th style="padding:9px 10px;text-align:left;color:#991b1b;font-family:Arial,sans-serif;border-bottom:1px solid #fecaca;">Item</th>
              <th class="mob-hide" style="padding:9px 10px;text-align:left;color:#991b1b;font-family:Arial,sans-serif;border-bottom:1px solid #fecaca;">Store</th>
              <th style="padding:9px 10px;text-align:center;color:#991b1b;font-family:Arial,sans-serif;border-bottom:1px solid #fecaca;">Ordered</th>
              <th style="padding:9px 10px;text-align:center;color:#991b1b;font-family:Arial,sans-serif;border-bottom:1px solid #fecaca;">Received</th>
              <th style="padding:9px 10px;text-align:center;color:#991b1b;font-family:Arial,sans-serif;border-bottom:1px solid #fecaca;">Claim Qty</th>
              <th style="padding:9px 10px;text-align:left;color:#991b1b;font-family:Arial,sans-serif;border-bottom:1px solid #fecaca;">Issue</th>
            </tr>
          </thead>
          <tbody>${claimsRows}</tbody>
          ${claims.length > 0 ? `
          <tfoot>
            <tr style="background:#fef2f2;">
              <td colspan="5" style="padding:9px 10px;text-align:right;font-family:Arial,sans-serif;font-weight:700;color:#991b1b;font-size:12px;">Total Claimed:</td>
              <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-weight:700;color:#dc2626;font-size:15px;">${totalClaimQty}</td>
              <td></td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
      ${claims.length > 0 ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
        <tr>
          <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#92400e;line-height:1.65;">
              &#9888;&#65039; The above supplier(s) have been notified via the inventory system.
              A replacement or credit note is being requested for all items listed.
            </p>
          </td>
        </tr>
      </table>` : ''}
    </td>
  </tr>

  <!-- DIVIDER -->
  <tr><td style="padding:0 36px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px dashed #e2e8f0;height:1px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>

  <!-- SECTION 2: EXPIRING ITEMS -->
  <tr>
    <td class="section-pad" style="padding:26px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
        <tr>
          <td style="border-left:4px solid #d97706;padding-left:12px;">
            <h2 style="margin:0;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#d97706;">
              &#9200;&nbsp; Section 2 &mdash; Items Expiring / Near Expiry
            </h2>
            <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">Items expiring within the next 30 days requiring immediate action</p>
          </td>
        </tr>
      </table>
      <div class="tbl-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid #e2e8f0;font-size:12px;min-width:460px;">
          <thead>
            <tr style="background:#fffbeb;">
              <th style="padding:9px 10px;text-align:left;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Part #</th>
              <th style="padding:9px 10px;text-align:left;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Item Name</th>
              <th class="mob-hide" style="padding:9px 10px;text-align:left;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Store</th>
              <th style="padding:9px 10px;text-align:center;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">In Stock</th>
              <th style="padding:9px 10px;text-align:center;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Expiry Date</th>
              <th style="padding:9px 10px;text-align:center;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Days Left</th>
              <th style="padding:9px 10px;text-align:left;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Action</th>
            </tr>
          </thead>
          <tbody>${expiryRows}</tbody>
        </table>
      </div>
      ${allExpiry.length > 0 ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
        <tr>
          <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#166534;line-height:1.65;">
              &#9989; <strong>Recommended:</strong>
              Issue or dispose of expired items per resort policy. Prioritise near-expiry items in daily issuances to minimise wastage.
            </p>
          </td>
        </tr>
      </table>` : ''}
    </td>
  </tr>

  <!-- DIVIDER -->
  <tr><td style="padding:0 36px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px dashed #e2e8f0;height:1px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>

  <!-- CLOSING -->
  <tr>
    <td class="section-pad" style="padding:26px 36px 30px;">
      <p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:14px;color:#475569;line-height:1.75;">
        I will continue to monitor these items closely and take the necessary steps to minimise any impact on operations.
        Kindly advise if further action or approval is required from your end.
      </p>
      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:14px;color:#475569;">Best regards,</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-left:4px solid #00AEEF;padding-left:14px;margin-top:14px;">
        <tr>
          <td>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:17px;font-weight:700;color:#1e293b;">Roni</p>
            <p style="margin:3px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">Store Assistant</p>
            <p style="margin:2px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">Outrigger Maafushivaru Resort</p>
            <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#00AEEF;">Sent via Inventory Management System</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 36px;text-align:center;">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;line-height:1.6;">
        Auto-generated by <strong style="color:#64748b;">Outrigger Maafushivaru Inventory System</strong> &middot; ${today()}
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

// ── Main send function ─────────────────────────────────────────
export async function sendInventoryReport({ apiKey, senderEmail, senderName, recipientEmail, recipientName, claims, expiringItems }) {
  if (!apiKey)         throw new Error('Brevo API key not set. Go to Settings → Email Reports.')
  if (!senderEmail)    throw new Error('Sender email not set. Go to Settings → Email Reports.')
  if (!recipientEmail) throw new Error('Recipient email not set. Go to Settings → Email Reports.')

  const expired      = expiringItems.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d < 0 })
  const expiringSoon = expiringItems.filter(i => { const d = daysLeft(i.expiry_date); return d !== null && d >= 0 && d <= 30 })

  const subject = `Inventory Status Report — ${today()} · ${claims.length} Claims · ${expiringSoon.length + expired.length} Expiring`

  const response = await fetch(BREVO_API, {
    method: 'POST',
    headers: {
      'accept':       'application/json',
      'api-key':      apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender:      { name: senderName || 'Roni — Store Assistant', email: senderEmail },
      to:          [{ email: recipientEmail, name: recipientName || 'Manager' }],
      subject,
      htmlContent: buildHTML({ claims, expiringItems: [...expired, ...expiringSoon] }),
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || `Brevo API error ${response.status}`)
  }

  return { subject, claimsCount: claims.length, expiryCount: expiringSoon.length + expired.length }
}

// ────────────────────────────────────────────────────────────────────────────
// EXPIRY REMINDER EMAIL  — focused email of items approaching/past expiry,
// triggered from the Item Expiry page for the selected reminder thresholds.
// `rows` = expiry rows from lib/expiry.js (each has: part_number, name, store,
//          current_stock, unit, expiry_date, days)
// ────────────────────────────────────────────────────────────────────────────
function buildExpiryHTML({ rows, thresholdLabels, resortName }) {
  const sorted = [...rows].sort((a, b) => a.days - b.days)
  const expired = sorted.filter(r => r.days < 0).length
  const within7 = sorted.filter(r => r.days >= 0 && r.days <= 7).length

  const bodyRows = sorted.length === 0
    ? `<tr><td colspan="6" style="padding:16px;text-align:center;font-family:Arial,sans-serif;color:#94a3b8;font-size:13px;">No items match the selected reminder windows.</td></tr>`
    : sorted.map((r, i) => {
        const badge = expiryBadge(r.days)
        const bg = r.days < 0 ? '#fff1f2' : i % 2 === 0 ? '#ffffff' : '#fafafa'
        const action = actionForExpiry(r.days)
        return `
        <tr style="background:${bg};">
          <td style="padding:9px 10px;font-family:monospace;font-size:11px;color:#64748b;border-bottom:1px solid #f1f5f9;">${r.part_number || '—'}</td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;font-weight:600;border-bottom:1px solid #f1f5f9;">${r.name}</td>
          <td style="padding:9px 10px;font-family:Arial,sans-serif;font-size:12px;color:#64748b;border-bottom:1px solid #f1f5f9;" class="mob-hide">${r.store || '—'}</td>
          <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${r.current_stock} ${r.unit || ''}</td>
          <td style="padding:9px 10px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${r.expiry_date || '—'}</td>
          <td style="padding:9px 10px;text-align:center;border-bottom:1px solid #f1f5f9;">
            <span style="background:${badge.bg};color:${badge.color};border:1px solid ${badge.border};border-radius:4px;padding:2px 8px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;">${badge.label}</span>
          </td>
        </tr>`
      }).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>@media only screen and (max-width:620px){.mob-hide{display:none!important;}.tbl-wrap{overflow-x:auto!important;}}</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
  <tr><td style="background:#00AEEF;padding:24px 32px;">
    <p style="margin:0 0 4px;color:rgba(255,255,255,0.85);font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;">${resortName || 'Outrigger Maafushivaru Resort'} — Store Department</p>
    <h1 style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:21px;font-weight:700;">⏰ Item Expiry Reminder</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-family:Arial,sans-serif;font-size:12px;">${today()} · Reminder windows: <strong>${(thresholdLabels || []).join(', ') || '—'}</strong></p>
  </td></tr>
  <tr><td style="background:#0095cc;padding:0;"><table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="padding:12px;text-align:center;border-right:1px solid rgba(255,255,255,0.2);"><p style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:20px;font-weight:700;">${sorted.length}</p><p style="margin:2px 0 0;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:1px;">In Window</p></td>
    <td style="padding:12px;text-align:center;border-right:1px solid rgba(255,255,255,0.2);"><p style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:20px;font-weight:700;">${within7}</p><p style="margin:2px 0 0;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:1px;">≤ 7 Days</p></td>
    <td style="padding:12px;text-align:center;"><p style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:20px;font-weight:700;">${expired}</p><p style="margin:2px 0 0;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Expired</p></td>
  </tr></table></td></tr>
  <tr><td style="padding:24px 32px;">
    <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:14px;color:#475569;line-height:1.7;">Dear Sir,</p>
    <p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:14px;color:#475569;line-height:1.7;">The following items are approaching (or have passed) their expiry date and require attention. Items are listed shortest to longest time remaining.</p>
    <div class="tbl-wrap" style="overflow-x:auto;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;font-size:12px;min-width:480px;">
      <thead><tr style="background:#fffbeb;">
        <th style="padding:9px 10px;text-align:left;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Part #</th>
        <th style="padding:9px 10px;text-align:left;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Item</th>
        <th class="mob-hide" style="padding:9px 10px;text-align:left;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Store</th>
        <th style="padding:9px 10px;text-align:center;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Stock</th>
        <th style="padding:9px 10px;text-align:center;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Expiry</th>
        <th style="padding:9px 10px;text-align:center;color:#92400e;font-family:Arial,sans-serif;border-bottom:1px solid #fde68a;">Status</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>
    <p style="margin:18px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#475569;">Best regards,<br/><strong style="color:#1e293b;">Roni</strong> · Store Assistant</p>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;text-align:center;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;">Auto-generated by the Outrigger Maafushivaru Inventory System · ${today()}</p>
  </td></tr>
</table></td></tr></table></body></html>`
}

export async function sendExpiryReport({ apiKey, senderEmail, senderName, recipientEmail, recipientName, rows, thresholdLabels, resortName }) {
  if (!apiKey)         throw new Error('Brevo API key not set. Go to Settings → Email Reports.')
  if (!senderEmail)    throw new Error('Sender email not set. Go to Settings → Email Reports.')
  if (!recipientEmail) throw new Error('Recipient email not set. Go to Settings → Email Reports.')

  const expired = rows.filter(r => r.days < 0).length
  const subject = `Item Expiry Reminder — ${today()} · ${rows.length} item(s)${expired ? ` · ${expired} expired` : ''}`

  const response = await fetch(BREVO_API, {
    method: 'POST',
    headers: { 'accept': 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: senderName || 'Roni — Store Assistant', email: senderEmail },
      to: [{ email: recipientEmail, name: recipientName || 'Manager' }],
      subject,
      htmlContent: buildExpiryHTML({ rows, thresholdLabels, resortName }),
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || `Brevo API error ${response.status}`)
  }
  return { subject, count: rows.length }
}
