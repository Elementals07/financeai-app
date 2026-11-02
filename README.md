# FinanceAI

FinanceAI is a local-first personal finance app for Android, built with React, Capacitor and Dexie (IndexedDB). Expenses, budgets, categories and imported bank-SMS history are stored on the device. There is no financial-data server and no MySQL, MongoDB or Postgres database.

The app can work without a network connection for everything except AI features. Receipt scanning, SMS parsing and the AI advisor call a small FinanceAI AI proxy over HTTPS; that proxy holds the Gemini keys and forwards requests to Google. The proxy does not store financial data.

This README is written for two audiences:

- **Users** who want to install the APK and understand what the app does.
- **Developers and AI agents** who need to change the code without breaking the local-first design.

---

## What is new in the latest version

The current release adds the following changes:

- **Receipt splitting:** one receipt can be reviewed item by item, each line can have its own category and amount, and every item is saved as its own expense transaction.
- **Receipt reconciliation:** the receipt total and the sum of line items are shown separately. If they differ, the user must explicitly confirm the difference before saving. The difference is never silently spread across products.
- **Receipt duplicate protection:** a deterministic receipt fingerprint is stored on saved transactions. Re-saving the same receipt requires a second confirmation.
- **Category-aware budgets:** the dashboard now reports overall overspending, category overspending, or 80% budget usage with clear messages. Categories without a limit are handled safely.
- **Bank/UPI SMS import on Android:** bank debit SMS can be read after permission is granted, filtered locally, redacted, parsed by the AI proxy, reviewed in a modal, and imported atomically.
- **Durable SMS deduplication:** processed SMS IDs are stored in Dexie, so reopening the app does not import the same message again. An SMS is marked processed only after its transaction is saved successfully.
- **Server-only Gemini keys:** AI traffic now goes through the included AI proxy. The app no longer reads, stores or bundles Gemini keys, and the proxy rotates up to five server-side keys automatically.
- **Tests and build hygiene:** pure parsing, receipt and budget logic is covered by 15 client tests, and proxy routing/rotation/error handling by 14 server tests. ESLint no longer scans generated Android bundles.
- **Refreshed APK:** `apk/FinanceAI.apk` was rebuilt from the current source.

Latest implementation commit at the time of writing: `86c5842 feat: add receipt splitting, category budgets, and SMS import`.

---

## Quick start for users

### Option 1: Install the APK

1. Download `apk/FinanceAI.apk` from this repository, or download the APK attached to the latest GitHub Release.
2. On the Android device, allow installation from the browser or file manager you used. This is a debug-signed APK, not a Play Store release.
3. Open **FinanceAI**.
4. Create a local account or sign in. Accounts are stored only on the device; there is no cloud account and no password server.
5. Grant the camera permission when you want to scan a receipt.
6. Grant the SMS permission only when you choose **Sync Bank SMS**. The app does not scan SMS in the background.

The app is pre-seeded with 2.5 years of realistic sample data (May 2024 to November 2026). The sample data can be replaced by entering real expenses.

### Option 2: Run the web version

```bash
cd client
npm install
npm run dev
```

The web version supports expenses, budgets, categories and the AI pages. Bank SMS import is Android-only because browsers cannot read the SMS inbox.

### Start the AI proxy and add fresh Gemini keys

AI features need the included proxy. Without it, the local parts of the app still work, but receipt scanning, SMS parsing and the AI advisor show an error.

1. **Create fresh Gemini keys**
   - Create the keys in Google AI Studio or Google Cloud.
   - Do not reuse a key that was committed, logged, shared or reported by Google as leaked. Google rejects those keys with HTTP 403.
   - Enable the Gemini/Generative Language API and configure quota or billing for the project.

2. **Put the keys only in `server/.env`**
   - Copy `server/.env.example` to `server/.env`.
   - Add up to five server-only keys:
     ```dotenv
     GEMINI_API_KEY_1=YOUR_FIRST_FRESH_KEY
     GEMINI_API_KEY_2=YOUR_SECOND_FRESH_KEY
     GEMINI_API_KEY_3=
     GEMINI_API_KEY_4=
     GEMINI_API_KEY_5=
     ```
   - `server/.env` is ignored by Git. Never put keys in `client/`, Vite variables, localStorage, GitHub, screenshots, logs or chat.

3. **Install and start the proxy**
   ```bash
   cd server
   npm install
   npm run dev
   ```
   The proxy listens on `http://localhost:5000` by default.

4. **Verify that the server sees the keys**
   ```powershell
   Invoke-RestMethod http://localhost:5000/api/health
   ```
   `ai.configured` should be `true`, and `ai.keyCount` should match the number of non-empty keys in `server/.env`.

5. **Point the app at the proxy**
   - Web development uses `http://localhost:5000/api/ai` by default.
   - To override it, create `client/.env`:
     ```dotenv
     VITE_AI_API_URL=http://localhost:5000/api/ai
     ```
   - For an Android emulator, use `http://10.0.2.2:5000/api/ai`. For a physical device, use your computer's LAN IP, or deploy the proxy over HTTPS and use that URL.
   - For GitHub Actions APK builds, set the repository secret `AI_API_URL` to the deployed proxy URL. This secret is only a URL; never put Gemini keys in it.

6. **Deploy the keys with the server**
   - Add the same `GEMINI_API_KEY_1..5` names to the server host's environment or secret store.
   - Restart the deployed proxy and confirm its `/api/health` endpoint reports `configured: true`.

7. **Revoke old leaked keys**
   - Delete or disable any key that was ever committed, logged, shared or reported as leaked in Google AI Studio or Google Cloud.

**Security rule:** never commit real keys to Git, issues, screenshots or logs. Revoke any key that was previously exposed in Git history.

---

## Feature guide

### Dashboard

- Monthly totals, top categories, spending trends and daily spending.
- Budget status card with one of four outcomes:
  - **Red:** overall spending is over the overall plan.
  - **Amber:** at least one category is over its allocation, even if overall spending is within plan.
  - **Amber:** overall spending has reached 80% of the plan.
  - **Green:** spending is within plan and below the warning threshold.
- The overall plan uses the profile monthly income when available, then falls back to the saved overall budget row.

### Expenses

- Add, edit, delete and filter expenses.
- **Scan Bill** opens the receipt workflow.
- **Sync Bank SMS** opens the Android SMS import workflow.

### Receipt scanning and splitting

1. Take a photo or choose an image from the gallery.
2. Gemini Vision extracts the merchant, date, total and line items.
3. Review the receipt header: merchant, date, total and primary category.
4. Review every line item. Each item has its own name, amount and category.
5. If the sum of the line items differs from the receipt total, the app explains the difference and asks for confirmation. The difference is not added to any product.
6. If an identical receipt was already saved, the app warns about a possible duplicate and requires a second confirmation.
7. Saving inserts all line items as separate transactions in one atomic Dexie batch.

If no line items are detected, the receipt is saved as one transaction using the receipt total. Unreadable line amounts are skipped with a warning; the app never invents an amount.

### Budget

- Set a monthly overall plan and per-category allocations.
- Category allocations must use categories that exist in the database. The app never creates an AI-only category.
- Categories with spending but no allocation still appear in the breakdown and are marked **no limit**.

### Bank/UPI SMS import (Android only)

1. Tap **Sync Bank SMS**.
2. Grant `READ_SMS` when Android asks.
3. The native plugin reads recent inbox messages, by default from the last 30 days and at most 60 messages.
4. Messages are filtered on the device before any AI request. The app drops OTPs, credits, refunds, reversals, failed transactions, payment requests, balance-only messages and obvious promotions.
5. Account numbers, UPI IDs, balances and OTP digits are redacted before the remaining text is sent to Gemini.
6. Gemini returns a structured list of debits. Rows that look uncertain are marked **Review needed** and are not selected by default.
7. Review, edit or remove rows. Nothing is saved until the user approves selected rows.
8. Import writes transactions and processed-SMS markers in one Dexie transaction. If saving fails, the message is not marked as processed.

The app never scans SMS in the background or on a timer. A scan only starts when the user taps the button.

### AI Insights / AI Advisor

- Generates a spending diagnosis from on-device summaries, category baselines and micro-leakage data.
- Chat answers use the user's actual totals and local tool calls.
- Results are cached in Dexie for 24 hours.
- An internet connection and a running AI proxy are required. The app never asks for a Gemini key.

### Categories and Savings

- Categories are stored in Dexie and can be added, recoloured or deleted.
- Savings history is calculated from income minus spending on the device.

### Accounts and privacy

- Registration, login and profile updates are local. There is no authentication server.
- Data is not encrypted at the application level. Device storage is protected by the operating system and the device lock, not by a FinanceAI password vault.

---

## Architecture

```text
Android APK / Web browser
        │
        ▼
React UI (pages + components)
        │
        ▼
client/src/api/axios.js  ← local API adapter (pseudo-REST routes)
        │
        ├── localExpenseService.js  → Dexie / IndexedDB
        ├── localGeminiService.js   → AI prompt/tool orchestration
        │        │
        │        ▼
        │   server/ (AI proxy)  → Google Gemini HTTPS
        │   server-only GEMINI_API_KEY_1..5
        └── smsService.js           → Capacitor SmsReader plugin (Android)
```

There is no financial-data backend: expenses, budgets and transactions stay in Dexie. The only server is the AI proxy, which receives AI prompts/image/SMS payloads and holds the Gemini keys. The file `client/src/api/axios.js` looks like an Axios client to the UI, but it routes financial calls to local services. Preserve that adapter and its pseudo-routes; do not replace it with a real `axios` instance pointing at a server.

### Important service responsibilities

| File | Responsibility |
| --- | --- |
| `client/src/api/axios.js` | Maps pseudo-REST routes such as `/expenses`, `/expenses/batch`, `/expenses/sms-import`, `/ai/scan-bill` to local services. |
| `client/src/services/localDatabase.js` | Opens Dexie, runs schema migrations and seeds the first launch. |
| `client/src/services/localExpenseService.js` | CRUD, atomic batch/SMS import, budget breakdown, summaries and analytics. |
| `client/src/services/localGeminiService.js` | Builds local analysis/chat/OCR/SMS prompts and sends Gemini-shaped payloads to the AI proxy. It does not hold keys. |
| `client/src/services/financeParsers.js` | Pure validation, SMS filters, receipt normalisation, fingerprints and budget-status rules. No browser or Dexie dependency, so it is unit-testable. |
| `client/src/services/smsService.js` | Reads native SMS, filters locally, removes processed IDs and calls the parser. |
| `client/src/utils/receiptFingerprint.js` | Deterministic per-device receipt fingerprint. |
| `server/server.js` | Express AI proxy with CORS, request-size limits and in-memory rate limiting. |
| `server/services/aiService.js` | Server-only Gemini key loading, automatic rotation, retries, timeouts and sanitized errors. |
| `server/routes/aiRoutes.js` | `POST /api/ai/generate`, the single AI gateway used by all app AI features. |
| `client/android/.../SmsReaderPlugin.java` | Native Android SMS reader with permission handling and local exclusions. |

### Dexie schema version 2

Database name: `FinanceAIDB`

| Store | Purpose |
| --- | --- |
| `transactions` | Expenses, including optional `receipt_fingerprint` and `sms_id`. |
| `budgets` | Overall and per-category monthly allocations. |
| `categories` | Global and user categories. |
| `user_profile` | Local user profile and monthly income. |
| `ai_insights_cache` | Cached AI analysis responses. |
| `processed_sms` | Durable SMS deduplication with a unique `user_id + sms_id` index. |

Version 2 adds `processed_sms` and the `receipt_fingerprint` index. It preserves the version 1 stores and indexes. Do not drop or recreate stores in a migration; existing users must keep their data.

### Relevant pseudo-routes

```text
GET  /expenses
GET  /expenses/summary
GET  /expenses/receipt-fingerprint?fingerprint=...
POST /expenses
POST /expenses/batch
POST /expenses/sms-import
GET  /budgets
POST /budgets
GET  /categories
POST /categories
POST /ai/analyze
POST /ai/chat
POST /ai/scan-bill
```

The `/ai/*` pseudo-routes are handled locally for prompt/tool orchestration. The only network endpoint is the proxy:

```text
POST /api/ai/generate   # Gemini-shaped payload; server adds a rotated key
GET  /api/health        # key configuration status
```

---

## Project structure

```text
FinanceAI-App/
├── apk/
│   └── FinanceAI.apk                 # Current debug-signed APK
├── client/
│   ├── android/                      # Capacitor Android project (Java)
│   ├── src/
│   │   ├── api/axios.js              # Local pseudo-REST adapter
│   │   ├── components/               # AI, Auth, Budget, Dashboard, Expenses, Layout
│   │   ├── context/AuthContext.jsx   # Local authentication state
│   │   ├── hooks/                    # Shared hooks such as useCategories
│   │   ├── pages/                    # Dashboard, Expenses, Budget, AI, Categories, Savings, Guide, auth pages
│   │   ├── services/                 # Dexie, local expense, AI orchestration, SMS, parsers, camera, seed data
│   │   └── utils/                    # Formatting and fingerprint helpers
│   ├── tests/financeParsers.test.js  # Node built-in test runner tests
│   ├── capacitor.config.json
│   ├── eslint.config.js
│   ├── package.json
│   └── vite.config.js
├── server/
│   ├── routes/aiRoutes.js            # POST /api/ai/generate
│   ├── services/aiService.js         # Server-only Gemini keys and rotation
│   ├── middleware/                   # Rate limiting and error handling
│   ├── tests/                        # Proxy routing, rotation and error tests
│   ├── .env.example                  # Server-only key template
│   ├── package.json
│   └── server.js
├── .github/workflows/build-apk.yml   # Builds a debug APK and updates the GitHub Release
└── README.md
```

### Tech stack

- React 19 + Vite 8
- Capacitor 8
- Dexie 4 / IndexedDB
- Chart.js and react-chartjs-2
- Node.js/Express AI proxy with server-only Gemini keys
- Google Gemini REST API (`gemini-2.5-flash`)
- Native Android Java plugin for SMS
- Node built-in test runner, ESLint

### Requirements

- Node.js 22 for the client and AI proxy
- Java JDK 21
- Android SDK for Android builds
- Server-side Gemini keys for AI features; users never supply keys

---

## Development

### Run the AI proxy

```bash
cd server
npm install
npm test
npm run dev
```

Create `server/.env` from `server/.env.example` and add `GEMINI_API_KEY_1..5`. The proxy exposes `POST /api/ai/generate` and `GET /api/health`. It does not connect to a database and does not store financial data.

### Install and run the web app

```bash
cd client
npm install
npm run dev
```

Set `VITE_AI_API_URL` in `client/.env` when the proxy is not at `http://localhost:5000/api/ai`.

### Lint, test and build

```bash
cd client
npm run lint
npm test
npm run build
```

`npm test` runs the Node tests in `client/tests/`; `npm test` in `server/` runs the proxy tests. The web build is written to `client/dist/`.

The APK must be built with `VITE_AI_API_URL` pointing at a reachable HTTPS proxy; otherwise AI features cannot reach the server.

### Build the Android APK

```bash
cd client
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

On Windows PowerShell, run the Gradle wrapper as:

```powershell
cd client\android
.\gradlew.bat assembleDebug
```

The debug APK is written to:

```text
client/android/app/build/outputs/apk/debug/app-debug.apk
```

To publish the current build in this repository:

```powershell
Copy-Item -LiteralPath "client\android\app\build\outputs\apk\debug\app-debug.apk" -Destination "apk\FinanceAI.apk" -Force
```

The debug APK is not suitable for production signing. Use a proper release key before distributing outside personal sideloading.

### Continuous integration

`.github/workflows/build-apk.yml` runs on pushes to `main` and on manual dispatch. It installs Node 22 and Java 21, builds the web bundle, syncs Capacitor, builds the debug APK, uploads it as an artifact and updates the GitHub Release. The workflow does not run the linter or tests; run them locally before pushing.

---

## Testing

The current test suite covers:

- currency parsing
- real calendar-date validation
- category matching and fallback
- receipt normalisation and skipped unreadable items
- receipt total reconciliation
- SMS exclusion rules for OTP, credit, failure, request and promotional messages
- debit detection
- SMS redaction of balances, account numbers, UPI IDs and OTPs
- SMS result validation, duplicate removal and review flags
- category budget breakdowns
- budget status priority and messages
- natural-language category lists
- receipt fingerprint stability

Run:

```bash
cd client
npm test

cd ../server
npm test
```

Expected current result: **15 client tests and 14 proxy tests passing**.

---

## Security and privacy notes

### Gemini keys and the AI proxy

- Gemini keys live only in `server/.env` or the deployment's secret store.
- Never put keys in `client/`, `VITE_*` variables, localStorage, the APK or Git.
- `VITE_AI_API_URL` is not a secret; it only tells the app where the proxy lives.
- The proxy rotates across up to five keys on rate limits, server errors and rejected keys, and never returns keys to the client.
- The proxy rate-limits requests by IP, but it does not have user accounts because this app's accounts are local-only. Protect a public deployment with your platform's access controls or an authenticated gateway.
- Revoke any key that was ever committed, logged or shared.

### SMS data

- SMS scanning requires Android `READ_SMS` and an explicit user action.
- The native plugin filters messages before returning them.
- The JavaScript layer filters again before any AI request.
- Sensitive fields are redacted before the request leaves the device.
- SMS bodies are not logged by the services.
- Imported SMS IDs are stored only after successful persistence.
- The app has no background SMS scanning.

### Google Play policy

`READ_SMS` is a restricted permission. Google Play generally allows it only when SMS access is core to the app's declared functionality, and distribution requires a permissions declaration and review. A personal sideloaded APK avoids Play review, but publishing this app on Play with `READ_SMS` may be rejected. For a Play build that does not qualify, remove the permission, the native plugin and the SMS UI.

### Device data

- Data stays in Dexie on the device unless the user clears app data or uninstalls the app.
- There is no cloud backup.
- The app does not add application-level encryption. Protect the device with a screen lock and avoid using shared devices for sensitive financial data.

---

## Instructions for AI agents and contributors

Read this section before changing the project.

### Keep the architecture

- **Do not add a financial-data backend.** Do not move expenses, budgets or transactions to Node/Express, MongoDB, MySQL, Postgres, Supabase or any server. The included `server/` is an AI-only proxy.
- **Keep Gemini keys server-only.** The client must call `server/` and must never read, store or bundle keys.
- **Do not replace Dexie.** Keep IndexedDB/Dexie as the source of truth.
- **Do not replace the local API adapter.** `client/src/api/axios.js` must continue to route pseudo-routes such as `/expenses/batch` and `/ai/scan-bill` to local services.
- **Keep the app usable offline** for everything except AI calls.
- **Preserve existing UI/design conventions** and the current mobile-first layout unless the task explicitly asks for a redesign.

### Data rules

- Use only categories that exist in Dexie. Never invent an AI-only category.
- Validate amounts as positive finite numbers and dates as real `YYYY-MM-DD` dates.
- Use atomic Dexie transactions for multi-row writes.
- Mark an SMS as processed only after its transaction was saved successfully.
- Never save parsed receipt or SMS data without explicit user review.
- Do not add background SMS scanning.
- Preserve the version 1 Dexie stores when editing the schema. Add a new version instead of deleting data.
- Treat the receipt fingerprint as duplicate detection, not cryptographic proof.

### Security rules

- Never hardcode or commit API keys. Keep them in `server/.env` or deployment secrets.
- Do not add Gemini key reads to the client, localStorage, Vite variables or APK assets.
- Do not log SMS bodies, account numbers, UPI IDs, balances or OTPs.
- Keep local filtering and redaction in place before sending SMS text to the AI proxy.
- Do not claim that an APK-bundled key is secure; the proxy exists so there is no bundled key.
- Do not log Gemini keys or return upstream response bodies that might contain request data.

### Before committing

Run all of these from `client/`:

```bash
npm run lint
npm test
npm run build
```

For Android changes, also run:

```bash
npx cap sync android
cd android
./gradlew assembleDebug
```

If Android build output or generated web assets are being linted accidentally, update `client/eslint.config.js` ignores instead of adding lint-disable comments across generated files.

### Git and release

- Do not reset, clean or discard user changes.
- Do not commit generated `client/dist`, `client/android/app/build` or copied web assets unless the repository already tracks them.
- Rebuild and update `apk/FinanceAI.apk` when the user asks for a new installable build.
- Commit messages in this repository use conventional prefixes such as `feat:`, `fix:` and `chore:`.

---

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| “The AI backend is unreachable” | Start the proxy with `npm run dev` in `server/`, check `http://localhost:5000/api/health`, and confirm `VITE_AI_API_URL` points at it. For Android, do not use `localhost` unless the proxy runs on the device. |
| “AI service is not configured on the server” | Add `GEMINI_API_KEY_1..5` to `server/.env` and restart the proxy. |
| “AI service is temporarily unavailable” | All keys were rate-limited or rejected. Check server logs, Google Cloud quota and key validity. |
| Server logs show HTTP 403 or “API key was reported as leaked” | Google rejected the key as leaked. Create a fresh key, put it in `server/.env`, restart the proxy and revoke the old key. |
| Receipt scan fails | Check the proxy health, network connection and image size (under 8 MB). You can still enter the receipt manually. |
| SMS sync button fails on the web | SMS import is Android-only. Use the APK. |
| SMS permission denied | Re-enable SMS permission in Android app settings, then tap Sync Bank SMS again. |
| No SMS transactions found | The app may have filtered them as OTP, credit, failed, promotional or already processed, or the bank format may be unsupported. |
| Duplicate receipt warning | Review the earlier receipt. Confirm again only if this is genuinely a second bill. |
| Budget shows red or amber unexpectedly | Overall plan comes from profile monthly income, and category limits come from the budget records. Check both in Budget. |
| Gradle build fails | Confirm Java 21, the Android SDK, and run `npx cap sync android` before `assembleDebug`. |
| Local data disappeared | Clearing app data or uninstalling removes Dexie storage. There is no server backup. |

---

## Glossary

- **AI proxy:** The small `server/` app that holds Gemini keys, rotates them and forwards AI requests. It stores no financial data.
- **APK:** Android application package, the installable app file.
- **Capacitor:** Tool that wraps the web app in a native Android shell and exposes native plugins.
- **Dexie / IndexedDB:** Browser/WebView database used as the on-device source of truth.
- **Gemini:** Google's AI API used for receipt OCR, SMS parsing and financial advice.
- **Local-first:** The app works from data stored on the device, not from a remote server.
- **Pseudo-route:** A URL-like string handled locally by `client/src/api/axios.js` instead of being sent over HTTP.
- **Processed SMS:** An SMS whose transaction was saved successfully, recorded in `processed_sms` to prevent duplicate imports.
