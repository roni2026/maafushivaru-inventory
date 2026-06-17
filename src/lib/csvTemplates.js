// ─────────────────────────────────────────────────────────────
// csvTemplates.js
// Unified CSV import configuration for every page.
// Each config defines: headers, required fields, sample rows,
// field descriptions, lookup tables, transform & validate fns.
// ─────────────────────────────────────────────────────────────

// ── CSV parser (handles quoted fields) ───────────────────────
export function parseCSV(text) {
  const lines = text.split('\n')
  // Skip comment lines starting with #
  const dataLines = lines.filter(l => !l.trim().startsWith('#') && l.trim())
  if (dataLines.length < 2) return []
  const headers = dataLines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase().replace(/\s+/g, '_'))
  const rows = []
  for (let i = 1; i < dataLines.length; i++) {
    const line = dataLines[i].trim()
    if (!line) continue
    const values = []; let inQuote = false; let cur = ''
    for (const ch of line + ',') {
      if (ch === '"')          inQuote = !inQuote
      else if (ch === ',' && !inQuote) { values.push(cur.replace(/^"|"$/g,'').trim()); cur = '' }
      else                     cur += ch
    }
    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] || '' })
    rows.push(row)
  }
  return rows
}

// ── CSV generator ─────────────────────────────────────────────
export function generateCSV(config) {
  const lines = []
  // Instructions comment header
  lines.push(`# ${config.label} Import Template — Outrigger Maafushivaru`)
  lines.push(`# Required fields: ${config.required.join(', ')}`)
  lines.push(`# DO NOT remove or rename the header row`)
  if (config.notes) lines.push(`# Note: ${config.notes}`)
  lines.push('#')
  // Column descriptions
  config.headers.forEach(h => {
    const desc = config.descriptions?.[h]
    if (desc) lines.push(`# ${h}: ${desc}`)
  })
  lines.push('#')
  // Header row
  lines.push(config.headers.join(','))
  // Sample rows
  config.samples.forEach(s => {
    lines.push(s.map(v => (String(v).includes(',') ? `"${v}"` : v)).join(','))
  })
  return lines.join('\n')
}

// ── All CSV configurations ────────────────────────────────────
export const CSV_CONFIGS = {

  // ──────────────────────────────────────────────────────────
  // 1. INVENTORY ITEMS
  // ──────────────────────────────────────────────────────────
  items: {
    label: 'Inventory Items',
    icon: '📦',
    table: 'items',
    upsertOn: 'part_number',
    headers: ['part_number','name','store_name','unit','current_stock','min_stock','unit_cost','expiry_date','supplier','location','notes'],
    required: ['part_number','name','store_name','unit'],
    descriptions: {
      part_number:   'Unique item code, e.g. BEV-001. Must be unique across all items.',
      store_name:    'Must exactly match a store name in your system (case-insensitive).',
      unit:          'Unit of measure: pcs / kg / g / L / mL / bottle / box / can / bag / pack etc.',
      current_stock: 'Current quantity in stock (number).',
      min_stock:     'Minimum stock level before low-stock alert (number).',
      unit_cost:     'Cost per unit in USD (number, e.g. 1.50).',
      expiry_date:   'Format: YYYY-MM-DD (e.g. 2026-12-31). Leave blank if no expiry.',
      supplier:      'Supplier company name.',
      location:      'Physical location, e.g. Shelf B3 or Freezer 1 bottom.',
      notes:         'Any additional notes or description.',
    },
    samples: [
      ['BEV-001','Mineral Water 500mL','Beverage Dry Store','bottle','100','20','1.50','2026-12-31','Maldives Fresh Co','Shelf A1','Keep cool'],
      ['F-001','Chicken Breast 1kg','Food Store - Frozen','kg','50','10','8.00','2026-08-15','Island Meats Ltd','Freezer 1','Free range'],
      ['DRY-012','Rice Basmati 5kg','Dry Store','bag','30','5','12.00','2027-06-01','Global Foods','Row 3 shelf 2',''],
    ],
    lookups: ['stores'],
    transform: (row, { stores }) => ({
      part_number:   row.part_number?.trim(),
      name:          row.name?.trim(),
      store_id:      stores?.find(s => s.name.toLowerCase() === row.store_name?.trim().toLowerCase())?.id || null,
      unit:          row.unit?.trim() || 'pcs',
      current_stock: Number(row.current_stock) || 0,
      min_stock:     Number(row.min_stock)     || 0,
      unit_cost:     Number(row.unit_cost)     || 0,
      expiry_date:   row.expiry_date?.trim() || null,
      supplier:      row.supplier?.trim() || '',
      location:      row.location?.trim() || '',
      notes:         row.notes?.trim()    || '',
    }),
    validate: (row, { stores }) => {
      const e = []
      if (!row.part_number?.trim()) e.push('Part # is required')
      if (!row.name?.trim())        e.push('Name is required')
      const store = stores?.find(s => s.name.toLowerCase() === row.store_name?.trim().toLowerCase())
      if (!store) e.push(`Store "${row.store_name}" not found — check store name`)
      if (row.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.expiry_date.trim())) e.push('Expiry must be YYYY-MM-DD')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 2. ISSUANCES
  // ──────────────────────────────────────────────────────────
  issuances: {
    label: 'Issuances',
    icon: '📋',
    table: 'issuances',
    upsertOn: null,
    headers: ['date','part_number','quantity_issued','unit','issued_by','note'],
    required: ['date','part_number','quantity_issued'],
    notes: 'part_number must match an item in your inventory. Stock will NOT be auto-deducted by import — use manual issuance for that.',
    descriptions: {
      date:             'Issue date — format YYYY-MM-DD.',
      part_number:      'Must match an existing item part number exactly.',
      quantity_issued:  'Quantity issued (number).',
      unit:             'Unit — auto-filled from inventory if blank.',
      issued_by:        'Name of person who issued.',
      note:             'Optional note.',
    },
    samples: [
      ['2026-06-17','BEV-001','24','bottle','Roni','Morning bar service'],
      ['2026-06-17','F-001','5','kg','Roni','Dinner prep'],
      ['2026-06-16','DRY-012','2','bag','Ahmed',''],
    ],
    lookups: ['items'],
    transform: (row, { items }) => {
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      return {
        item_id:         item?.id || null,
        date:            row.date?.trim(),
        quantity_issued: Number(row.quantity_issued) || 0,
        issued_by:       row.issued_by?.trim() || 'Import',
        note:            row.note?.trim() || 'Bulk import',
      }
    },
    validate: (row, { items }) => {
      const e = []
      if (!row.date?.trim()) e.push('Date is required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date?.trim())) e.push('Date must be YYYY-MM-DD')
      if (!row.part_number?.trim()) e.push('Part # is required')
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      if (!item) e.push(`Part # "${row.part_number}" not found in inventory`)
      if (!row.quantity_issued || Number(row.quantity_issued) <= 0) e.push('Quantity must be > 0')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 3. RECEIVING / GRN
  // ──────────────────────────────────────────────────────────
  receiving: {
    label: 'Receiving (GRN)',
    icon: '📥',
    table: 'receiving',
    upsertOn: null,
    headers: ['date','part_number','quantity_received','unit','supplier_name','received_by','invoice_number','unit_cost','note'],
    required: ['date','part_number','quantity_received'],
    notes: 'Stock levels will NOT be auto-updated by import. Use the Receiving page for that.',
    descriptions: {
      date:              'Receiving date — format YYYY-MM-DD.',
      part_number:       'Must match an existing item part number.',
      quantity_received: 'Quantity received (number).',
      unit:              'Unit — auto-filled if blank.',
      supplier_name:     'Name of the supplier.',
      received_by:       'Name of person who received.',
      invoice_number:    'Invoice or GRN reference number.',
      unit_cost:         'Cost per unit at this delivery.',
      note:              'Optional note.',
    },
    samples: [
      ['2026-06-15','BEV-001','200','bottle','Maldives Fresh Co','Roni','INV-2026-123','1.50','Monday delivery'],
      ['2026-06-15','F-001','30','kg','Island Meats Ltd','Roni','INV-2026-124','8.00',''],
    ],
    lookups: ['items'],
    transform: (row, { items }) => {
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      return {
        item_id:           item?.id || null,
        item_name:         item?.name || row.part_number,
        date:              row.date?.trim(),
        quantity_received: Number(row.quantity_received) || 0,
        unit:              row.unit?.trim() || item?.unit || 'pcs',
        supplier_name:     row.supplier_name?.trim() || '',
        received_by:       row.received_by?.trim() || 'Import',
        invoice_number:    row.invoice_number?.trim() || '',
        unit_cost:         Number(row.unit_cost) || 0,
        note:              row.note?.trim() || '',
      }
    },
    validate: (row, { items }) => {
      const e = []
      if (!row.date?.trim()) e.push('Date is required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date?.trim())) e.push('Date must be YYYY-MM-DD')
      if (!row.part_number?.trim()) e.push('Part # is required')
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      if (!item) e.push(`Part # "${row.part_number}" not found`)
      if (!row.quantity_received || Number(row.quantity_received) <= 0) e.push('Quantity must be > 0')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 4. WASTE LOG
  // ──────────────────────────────────────────────────────────
  waste: {
    label: 'Waste Log',
    icon: '🗑️',
    table: 'waste_log',
    upsertOn: null,
    headers: ['date','part_number','quantity_wasted','unit','reason','wasted_by','note'],
    required: ['date','part_number','quantity_wasted','reason'],
    descriptions: {
      date:             'Waste date — format YYYY-MM-DD.',
      part_number:      'Must match an existing item part number.',
      quantity_wasted:  'Quantity wasted (number).',
      unit:             'Unit — auto-filled if blank.',
      reason:           'expired / damaged / spoiled / overproduction / contaminated / other',
      wasted_by:        'Name of person logging the waste.',
      note:             'Additional details.',
    },
    samples: [
      ['2026-06-17','BEV-001','6','bottle','expired','Roni','Bottles past expiry date'],
      ['2026-06-16','F-001','2','kg','spoiled','Ahmed','Left out of freezer'],
    ],
    lookups: ['items'],
    transform: (row, { items }) => {
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      return {
        item_id:         item?.id || null,
        item_name:       item?.name || row.part_number,
        date:            row.date?.trim(),
        quantity_wasted: Number(row.quantity_wasted) || 0,
        unit:            row.unit?.trim() || item?.unit || 'pcs',
        reason:          row.reason?.trim() || 'other',
        wasted_by:       row.wasted_by?.trim() || 'Import',
        note:            row.note?.trim() || '',
      }
    },
    validate: (row, { items }) => {
      const e = []
      if (!row.date?.trim()) e.push('Date is required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date?.trim())) e.push('Date must be YYYY-MM-DD')
      if (!row.part_number?.trim()) e.push('Part # is required')
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      if (!item) e.push(`Part # "${row.part_number}" not found`)
      if (!row.quantity_wasted || Number(row.quantity_wasted) <= 0) e.push('Quantity must be > 0')
      if (!row.reason?.trim()) e.push('Reason is required')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 5. STOCKTAKE
  // ──────────────────────────────────────────────────────────
  stocktake: {
    label: 'Stocktake',
    icon: '📊',
    table: 'stocktake_entries',
    upsertOn: null,
    headers: ['date','part_number','counted_quantity','unit','note'],
    required: ['date','part_number','counted_quantity'],
    notes: 'This logs the stocktake count. Stock levels are NOT automatically updated — approve via the Stocktake page.',
    descriptions: {
      date:             'Stocktake date — format YYYY-MM-DD.',
      part_number:      'Must match an existing item part number.',
      counted_quantity: 'Physical count (number).',
      unit:             'Unit — auto-filled if blank.',
      note:             'Optional note, e.g. "counted twice".',
    },
    samples: [
      ['2026-06-17','BEV-001','94','bottle','Counted x2, confirmed'],
      ['2026-06-17','F-001','47','kg',''],
      ['2026-06-17','DRY-012','28','bag','One bag partially used'],
    ],
    lookups: ['items'],
    transform: (row, { items }) => {
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      return {
        item_id:          item?.id || null,
        item_name:        item?.name || row.part_number,
        date:             row.date?.trim(),
        counted_quantity: Number(row.counted_quantity) || 0,
        system_quantity:  item?.current_stock || 0,
        difference:       Number(row.counted_quantity) - (item?.current_stock || 0),
        unit:             row.unit?.trim() || item?.unit || 'pcs',
        note:             row.note?.trim() || '',
        status:           'pending',
      }
    },
    validate: (row, { items }) => {
      const e = []
      if (!row.date?.trim()) e.push('Date is required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date?.trim())) e.push('Date must be YYYY-MM-DD')
      if (!row.part_number?.trim()) e.push('Part # is required')
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      if (!item) e.push(`Part # "${row.part_number}" not found`)
      if (row.counted_quantity === '' || isNaN(Number(row.counted_quantity))) e.push('Counted qty must be a number')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 6. TRANSFERS
  // ──────────────────────────────────────────────────────────
  transfers: {
    label: 'Transfers',
    icon: '🔄',
    table: 'transfers',
    upsertOn: null,
    headers: ['date','part_number','quantity','from_store','to_store','transferred_by','note'],
    required: ['date','part_number','quantity','from_store','to_store'],
    descriptions: {
      date:            'Transfer date — format YYYY-MM-DD.',
      part_number:     'Must match an existing item part number.',
      quantity:        'Quantity transferred (number).',
      from_store:      'Source store name (must exist exactly).',
      to_store:        'Destination store name (must exist exactly).',
      transferred_by:  'Name of person making the transfer.',
      note:            'Optional note.',
    },
    samples: [
      ['2026-06-17','BEV-001','12','Beverage Dry Store','Beach Bar','Roni','Replenish bar stock'],
      ['2026-06-17','F-001','5','Food Store - Frozen','Main Kitchen','Ahmed','Chef request'],
    ],
    lookups: ['items','stores'],
    transform: (row, { items, stores }) => {
      const item      = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      const fromStore = stores?.find(s => s.name.toLowerCase() === row.from_store?.trim().toLowerCase())
      const toStore   = stores?.find(s => s.name.toLowerCase() === row.to_store?.trim().toLowerCase())
      return {
        item_id:        item?.id     || null,
        item_name:      item?.name   || row.part_number,
        date:           row.date?.trim(),
        quantity:       Number(row.quantity) || 0,
        from_store_id:  fromStore?.id || null,
        from_store_name:fromStore?.name || row.from_store,
        to_store_id:    toStore?.id   || null,
        to_store_name:  toStore?.name || row.to_store,
        transferred_by: row.transferred_by?.trim() || 'Import',
        note:           row.note?.trim() || '',
        status:         'completed',
      }
    },
    validate: (row, { items, stores }) => {
      const e = []
      if (!row.date?.trim()) e.push('Date is required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date?.trim())) e.push('Date must be YYYY-MM-DD')
      if (!row.part_number?.trim()) e.push('Part # is required')
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      if (!item) e.push(`Part # "${row.part_number}" not found`)
      if (!row.quantity || Number(row.quantity) <= 0) e.push('Quantity must be > 0')
      const from = stores?.find(s => s.name.toLowerCase() === row.from_store?.trim().toLowerCase())
      if (!from) e.push(`From store "${row.from_store}" not found`)
      const to = stores?.find(s => s.name.toLowerCase() === row.to_store?.trim().toLowerCase())
      if (!to) e.push(`To store "${row.to_store}" not found`)
      if (row.from_store?.trim().toLowerCase() === row.to_store?.trim().toLowerCase()) e.push('From and To stores cannot be the same')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 7. DELIVERY CLAIMS
  // ──────────────────────────────────────────────────────────
  claims: {
    label: 'Delivery Claims',
    icon: '⚠️',
    table: 'delivery_claims',
    upsertOn: null,
    headers: ['date','part_number','item_name','supplier_name','ordered_qty','received_qty','wrong_qty','unit','issue_type','notes'],
    required: ['date','item_name','supplier_name','wrong_qty','issue_type'],
    descriptions: {
      date:          'Claim date — format YYYY-MM-DD.',
      part_number:   'Item part number (optional if item_name given).',
      item_name:     'Full name of the item.',
      supplier_name: 'Supplier who delivered the wrong item.',
      ordered_qty:   'Quantity that was ordered (number).',
      received_qty:  'Quantity actually received (number).',
      wrong_qty:     'Quantity being claimed / disputed (number).',
      unit:          'Unit of measure.',
      issue_type:    'wrong_item / short_delivery / damaged / expired / wrong_spec / other',
      notes:         'Details of the issue.',
    },
    samples: [
      ['2026-06-15','BEV-001','Mineral Water 500mL','Maldives Fresh Co','200','195','5','bottle','short_delivery','5 bottles missing from delivery'],
      ['2026-06-15','F-001','Chicken Breast 1kg','Island Meats Ltd','30','30','10','kg','damaged','10kg arrived thawed, unusable'],
      ['2026-06-15','DRY-012','Rice Basmati 5kg','Global Foods','10','10','10','bag','wrong_item','Delivered long grain rice instead of basmati'],
    ],
    lookups: ['items'],
    transform: (row, { items }) => {
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      return {
        date:          row.date?.trim(),
        item_id:       item?.id || null,
        item_name:     row.item_name?.trim(),
        part_number:   row.part_number?.trim() || '',
        store_name:    item?.stores?.name || '',
        supplier_name: row.supplier_name?.trim(),
        ordered_qty:   Number(row.ordered_qty)  || 0,
        received_qty:  Number(row.received_qty) || 0,
        wrong_qty:     Number(row.wrong_qty)    || 0,
        unit:          row.unit?.trim() || item?.unit || 'pcs',
        issue_type:    row.issue_type?.trim() || 'other',
        notes:         row.notes?.trim() || '',
        status:        'pending',
      }
    },
    validate: (row) => {
      const e = []
      const validTypes = ['wrong_item','short_delivery','damaged','expired','wrong_spec','other']
      if (!row.date?.trim()) e.push('Date is required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date?.trim())) e.push('Date must be YYYY-MM-DD')
      if (!row.item_name?.trim()) e.push('Item name is required')
      if (!row.supplier_name?.trim()) e.push('Supplier name is required')
      if (!row.wrong_qty || Number(row.wrong_qty) <= 0) e.push('Claim quantity must be > 0')
      if (!validTypes.includes(row.issue_type?.trim())) e.push(`Issue type must be one of: ${validTypes.join(', ')}`)
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 8. SUPPLIERS
  // ──────────────────────────────────────────────────────────
  suppliers: {
    label: 'Suppliers',
    icon: '🏢',
    table: 'suppliers',
    upsertOn: 'name',
    headers: ['name','contact_name','email','phone','address','payment_terms','notes'],
    required: ['name'],
    descriptions: {
      name:          'Supplier company name (unique).',
      contact_name:  'Primary contact person name.',
      email:         'Contact email address.',
      phone:         'Phone or WhatsApp number.',
      address:       'Business address.',
      payment_terms: 'e.g. Net 30, COD, Advance etc.',
      notes:         'Any additional notes.',
    },
    samples: [
      ['Maldives Fresh Co','Ahmed Rasheed','ahmed@maldivesfresh.mv','+960 300 1234','Male City, Maldives','Net 30','Primary beverage supplier'],
      ['Island Meats Ltd','Ibrahim Ali','ibrahim@islandmeats.mv','+960 300 5678','Hulhumale','COD','Meat and poultry'],
      ['Global Foods Trading','Sara Mohamed','sara@globalfoods.mv','+960 300 9012','Male City','Net 15','Dry goods and grains'],
    ],
    lookups: [],
    transform: (row) => ({
      name:          row.name?.trim(),
      contact_name:  row.contact_name?.trim()  || '',
      email:         row.email?.trim()         || '',
      phone:         row.phone?.trim()         || '',
      address:       row.address?.trim()       || '',
      payment_terms: row.payment_terms?.trim() || '',
      notes:         row.notes?.trim()         || '',
    }),
    validate: (row) => {
      const e = []
      if (!row.name?.trim()) e.push('Supplier name is required')
      if (row.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) e.push('Invalid email format')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 9. STORES
  // ──────────────────────────────────────────────────────────
  stores: {
    label: 'Stores',
    icon: '🏪',
    table: 'stores',
    upsertOn: 'name',
    headers: ['name','category','location','description'],
    required: ['name','category'],
    descriptions: {
      name:        'Store name (unique). This is referenced by items, so spelling matters.',
      category:    'Category group, e.g. Beverage / Food / Dry / Chemical / Housekeeping etc.',
      location:    'Physical location of the store on the resort.',
      description: 'Brief description.',
    },
    samples: [
      ['Beverage Dry Store','Beverage','Main building, ground floor north','All non-refrigerated beverages'],
      ['Food Store - Frozen','Food','Kitchen block, behind main kitchen','Frozen meat, fish and dairy'],
      ['Dry Store - Main','Dry','Warehouse block A','Rice, flour, pasta and dry goods'],
      ['Chemical Store','Chemical','Laundry building','Cleaning chemicals and sanitation'],
    ],
    lookups: [],
    transform: (row) => ({
      name:        row.name?.trim(),
      category:    row.category?.trim(),
      location:    row.location?.trim()    || '',
      description: row.description?.trim() || '',
    }),
    validate: (row) => {
      const e = []
      if (!row.name?.trim())     e.push('Store name is required')
      if (!row.category?.trim()) e.push('Category is required')
      return e
    },
  },

  // ──────────────────────────────────────────────────────────
  // 10. ORDERS (manual order items)
  // ──────────────────────────────────────────────────────────
  order_items: {
    label: 'Order Items',
    icon: '🛒',
    table: 'order_history_items',
    upsertOn: null,
    headers: ['delivery_date','delivery_day','part_number','item_name','store_name','unit','ordered_qty','notes'],
    required: ['delivery_date','part_number','ordered_qty'],
    notes: 'This creates a new saved order from your CSV. All rows with the same delivery_date will be grouped into one order.',
    descriptions: {
      delivery_date: 'Delivery date — format YYYY-MM-DD.',
      delivery_day:  'Day name, e.g. Monday (auto-filled if blank).',
      part_number:   'Item part number — must exist in inventory.',
      item_name:     'Item name (auto-filled from inventory if blank).',
      store_name:    'Store name (auto-filled from inventory if blank).',
      unit:          'Unit (auto-filled from inventory if blank).',
      ordered_qty:   'Quantity to order (number).',
      notes:         'Optional note for this line item.',
    },
    samples: [
      ['2026-06-23','Monday','BEV-001','Mineral Water 500mL','Beverage Dry Store','bottle','240',''],
      ['2026-06-23','Monday','F-001','Chicken Breast 1kg','Food Store - Frozen','kg','30',''],
      ['2026-06-23','Monday','DRY-012','Rice Basmati 5kg','Dry Store - Main','bag','10','Extra stock'],
    ],
    lookups: ['items'],
    transform: (row, { items }) => {
      const item    = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      const dayName = row.delivery_day?.trim() || (row.delivery_date ? new Date(row.delivery_date).toLocaleDateString('en-US',{weekday:'long'}) : '')
      return {
        // order_id is set after the order_history record is created
        _delivery_date: row.delivery_date?.trim(),
        _delivery_day:  dayName,
        item_id:        item?.id || null,
        part_number:    row.part_number?.trim(),
        item_name:      row.item_name?.trim() || item?.name || '',
        store_name:     row.store_name?.trim() || item?.stores?.name || '',
        unit:           row.unit?.trim() || item?.unit || 'pcs',
        ordered_qty:    Number(row.ordered_qty) || 0,
        received_qty:   0,
        notes:          row.notes?.trim() || '',
      }
    },
    validate: (row, { items }) => {
      const e = []
      if (!row.delivery_date?.trim()) e.push('Delivery date is required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.delivery_date?.trim())) e.push('Date must be YYYY-MM-DD')
      if (!row.part_number?.trim()) e.push('Part # is required')
      const item = items?.find(i => i.part_number?.toUpperCase() === row.part_number?.trim().toUpperCase())
      if (!item) e.push(`Part # "${row.part_number}" not found`)
      if (!row.ordered_qty || Number(row.ordered_qty) <= 0) e.push('Ordered qty must be > 0')
      return e
    },
  },
}
