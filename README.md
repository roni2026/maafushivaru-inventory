# 🌊 Outrigger Maafushivaru Resort – Inventory Management System

A full-stack, production-ready inventory management web application built for Outrigger Maafushivaru Resort.

---

## 🏗️ Tech Stack

| Layer       | Technology                              |
|-------------|------------------------------------------|
| Frontend    | React 18 + Vite + Tailwind CSS          |
| Database    | Supabase (PostgreSQL)                   |
| Auth        | Supabase Auth (email/password)          |
| Email       | Brevo (formerly Sendinblue) Transactional API |
| Charts      | Recharts                                |
| PDF Export  | jsPDF + jsPDF-autotable                 |
| Icons       | lucide-react                            |
| Hosting     | Render (Static Site)                    |

---

## 📁 Project Structure

```
outrigger-inventory/
├── index.html
├── vite.config.js
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── .env.example
├── render.yaml
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── lib/
│   │   ├── supabase.js        # Supabase client
│   │   └── brevo.js           # Email API helper
│   ├── hooks/
│   │   ├── useItems.js        # Items CRUD
│   │   ├── useIssuances.js    # Issuances
│   │   └── useSettings.js     # Settings
│   ├── components/
│   │   ├── Layout.jsx
│   │   ├── Sidebar.jsx
│   │   └── ui/
│   │       ├── Button.jsx
│   │       ├── Badge.jsx
│   │       ├── Modal.jsx
│   │       ├── Table.jsx
│   │       └── Input.jsx
│   └── pages/
│       ├── Login.jsx
│       ├── Dashboard.jsx
│       ├── Inventory.jsx
│       ├── Issuance.jsx
│       ├── Reports.jsx
│       ├── Orders.jsx
│       ├── Analytics.jsx
│       └── Settings.jsx
└── supabase/
    └── migrations/
        ├── 001_initial_schema.sql
        ├── 002_seed_stores.sql
        └── 003_rls_policies.sql
```

---

## 🧰 Prerequisites

Before you begin, make sure you have:

- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- **npm** v9 or later (comes with Node)
- **Supabase account** — [supabase.com](https://supabase.com) (free tier works)
- **Render account** — [render.com](https://render.com) (free tier works)
- **Brevo account** — [brevo.com](https://brevo.com) (free tier: 300 emails/day)

---

## 🛢️ Step 1 – Supabase Setup

### 1.1 Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a name (e.g. `outrigger-inventory`)
3. Set a strong database password and save it
4. Select your region (closest to Maldives: Singapore)
5. Wait ~2 minutes for the project to spin up

### 1.2 Run Migrations

Run each migration file **in order** using the Supabase SQL Editor:

1. Go to your Supabase project → **SQL Editor** → **New query**
2. Copy the content of `supabase/migrations/001_initial_schema.sql` → Paste → **Run**
3. New query → Copy `002_seed_stores.sql` → **Run**
4. New query → Copy `003_rls_policies.sql` → **Run**

Verify:
- Go to **Table Editor** — you should see: `stores`, `items`, `stock_updates`, `issuances`, `email_alerts_sent`, `settings`
- Go to `stores` table — you should see **8 rows** (8 stores pre-seeded)

### 1.3 Get Your API Keys

1. Go to Supabase → **Project Settings** → **API**
2. Copy:
   - **Project URL** (e.g. `https://abcxyz.supabase.co`)
   - **anon public** key

### 1.4 Create Your First User

1. Go to Supabase → **Authentication** → **Users** → **Add user**
2. Enter an email and password for the staff account
3. Confirm the user

---

## ⚙️ Step 2 – Local Development

### 2.1 Clone & Install

```bash
# Clone or place the project folder
cd outrigger-inventory

# Install dependencies
npm install
```

### 2.2 Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key-here
```

### 2.3 Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the user you created in Supabase.

---

## 🚀 Step 3 – Deploy on Render

### 3.1 Push to GitHub (required for Render)

```bash
git init
git add .
git commit -m "Initial commit – Outrigger Inventory"
git remote add origin https://github.com/YOUR_USERNAME/outrigger-inventory.git
git push -u origin main
```

### 3.2 Create a Render Static Site

1. Go to [render.com](https://render.com) → **New** → **Static Site**
2. Connect your GitHub repository
3. Configure:
   - **Name**: `outrigger-inventory`
   - **Branch**: `main`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`

### 3.3 Add Environment Variables on Render

In Render → your site → **Environment**:

| Key                      | Value                              |
|--------------------------|------------------------------------|
| `VITE_SUPABASE_URL`      | `https://your-project.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `your-anon-key`                    |

### 3.4 Deploy

Click **Save Changes** → Render will automatically build and deploy.

Your app will be live at: `https://outrigger-inventory.onrender.com`

> **Note**: The `render.yaml` file included in the project root will auto-configure Render if you use "Blueprint" deployment.

---

## 📧 Step 4 – Configure Brevo Email

### 4.1 Create a Brevo Account

1. Go to [brevo.com](https://brevo.com) → Sign up (free)
2. Verify your sender email address

### 4.2 Get Your API Key

1. Brevo Dashboard → **SMTP & API** → **API Keys**
2. Click **Generate a new API key**
3. Copy the key (starts with `xkeysib-...`)

### 4.3 Configure in the App

1. Open the deployed app → Sign in → **Settings**
2. Paste your Brevo API key
3. Enter the recipient email for alerts
4. Click **Save Settings**
5. Click **Send Test Email** to verify the integration

---

## ⏰ Step 5 – Scheduled Daily Alerts

The expiry check must run daily. Choose one of these methods:

### Option A – Render Cron Job (Recommended)

Add a second service to your `render.yaml`:

```yaml
  - type: cron
    name: outrigger-expiry-check
    env: node
    schedule: "0 7 0 * * *"   # runs every day at 07:00
    buildCommand: npm install
    startCommand: node scripts/check-alerts.js
    envVars:
      - key: VITE_SUPABASE_URL
        sync: false
      - key: VITE_SUPABASE_ANON_KEY
        sync: false
      - key: BREVO_API_KEY
        sync: false
      - key: RECIPIENT_EMAIL
        sync: false
```

Create `scripts/check-alerts.js`:
```js
import { createClient } from '@supabase/supabase-js'
import { checkAndSendExpiryAlerts } from '../src/lib/brevo.js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
const { data: settings } = await supabase.from('settings').select('*')
const smap = settings.reduce((a,s) => ({ ...a, [s.key]: s.value }), {})

const results = await checkAndSendExpiryAlerts({
  supabase,
  apiKey:         process.env.BREVO_API_KEY || smap.brevo_api_key,
  recipientEmail: process.env.RECIPIENT_EMAIL || smap.recipient_email,
  resortName:     smap.resort_name || 'Outrigger Maafushivaru Resort',
})
console.log('Alert results:', results)
```

### Option B – Supabase Edge Function

1. Install Supabase CLI: `npm install -g supabase`
2. `supabase functions new check-expiry-alerts`
3. Copy the logic from `brevo.js` into the Edge Function
4. Deploy: `supabase functions deploy check-expiry-alerts`
5. Set a cron schedule in Supabase → Edge Functions → **Schedules**

### Option C – Manual Trigger (No scheduling)

Use the **"Trigger Expiry Check Now"** button in the Settings page anytime.

---

## 📖 Feature Guide

### 🏠 Dashboard
- Real-time stats: total items, expired/critical, expiring soon, low stock
- Category breakdown (Beverage / Food / General)
- List of items expiring within 30 days with colour-coded urgency
- Recent stock update history

### 📦 Inventory
- Full item table, **sorted by expiry date** by default (shortest first)
- **Colour coding**: 🔴 Expired/≤7d | 🟠 8–15d | 🟡 16–30d | 🟢 >30d
- Filter by Store, Category, expiry range; search by name or part number
- Add / Edit / Delete items (with confirmation)
- **Stock update modal**: Set exact quantity, Add, or Subtract — with date picker and who updated

### 📋 Daily Issuance
- Autocomplete item search (type part number or name)
- Date defaults to today with quick "Yesterday" button
- Automatically deducts issued quantity from stock
- Logs every issuance with user name, date, and quantity
- Shows weekly total per item inline in the table

### 📊 Reports (Weekly)
- Generate on demand for the last 7 days
- **4 charts**: Daily volume bar chart, Top 10 items, Stock vs Minimum, Expiry risk
- Full per-item table with weekly issued, remaining stock, expiry status
- **Export to PDF** (portrait A4) with resort branding

### 🛒 Orders
- **Auto-detects next delivery day** (Monday for foreign + local; Thursday for local)
- Calculates: `Suggested Qty = (Avg weekly usage × 2) − Current Stock`
- Editable quantity per item with +/− buttons before exporting
- **Export to PDF** titled "Order for [Day] – [Date]" grouped by store

### 📈 Analytics
- Classifies every item: **Fast Moving** (top 25%), **Normal**, **Slow Moving** (bottom 25%), **No Movement** (zero issues in 14 days)
- Top 20 bar chart colour-coded by classification
- Filterable table by store, category, classification

### ⚙️ Settings
- Brevo API key (masked input)
- Recipient email for alerts
- Resort name (used in PDF headers)
- Test Email button
- Manual expiry alert trigger

---

## 🗄️ Database Schema Reference

```sql
stores          (id, name, category, created_at)
items           (id, part_number UNIQUE, name, store_id FK, unit,
                 current_stock, min_stock, expiry_date, supplier, notes,
                 created_at, updated_at)
stock_updates   (id, item_id FK, date, quantity_change, new_quantity,
                 updated_by, note, created_at)
issuances       (id, item_id FK, date, quantity_issued, store_id FK,
                 logged_by, created_at)
email_alerts_sent (id, item_id FK, alert_threshold_days INT, sent_at,
                   recipient_email)
settings        (id, key TEXT UNIQUE, value TEXT, updated_at)
```

---

## 🏪 Stores Reference

| Category  | Store Name           |
|-----------|----------------------|
| Beverage  | Beverage Dry Store   |
| Food      | Dry Store 1          |
| Food      | Dry Store 2          |
| Food      | Dry Store 3          |
| Food      | Freezer 1            |
| Food      | Freezer 2            |
| General   | General Chemical     |
| General   | General              |

---

## 🔐 Auth Notes

- Email/password authentication via Supabase Auth
- No public access – all routes require sign-in
- Session is persisted via Supabase's built-in session management
- To add more users: Supabase Dashboard → Authentication → Users → Add user

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Blank page after deploy | Check env vars are set in Render dashboard |
| "Missing env vars" error | Ensure `.env` file exists locally or env vars set on Render |
| Can't sign in | Check user was created in Supabase Auth → Users |
| Items not loading | Run migrations in order; check RLS policies in `003_rls_policies.sql` |
| Brevo test email fails | Verify API key starts with `xkeysib-`; check sender email is verified in Brevo |
| PDF export errors | Check browser console; jsPDF requires ES module support (handled by Vite) |

---

## 📜 License

Internal use only — Outrigger Maafushivaru Resort.
