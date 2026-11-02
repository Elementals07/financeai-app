# FinanceAI

FinanceAI is a local-first personal finance app for Android, built with React, Capacitor and Dexie (IndexedDB). Expenses, budgets, categories and imported bank-SMS history are stored on the device. There is no financial-data server and no MySQL, MongoDB or Postgres database.

The app can work without a network connection for everything except AI features. AI features send requests directly from the app to Google Gemini using API keys that the user adds in AI Settings. Expense data is stored on the device; selected financial context, receipt images and SMS text may be sent to Google when the corresponding AI feature is used.

This README is written for two audiences:

- **Users** who want to install the APK and understand what the app does.
- **Developers and AI agents** who need to change the code without breaking the local-first design.

---

## What is new in v1.2.0

This release adds the following changes:

- **On-device Gemini key settings:** add, validate, mask, rotate, or remove up to five user-provided Gemini API keys from the sidebar.
- **Direct Gemini requests:** AI requests use the user's configured keys directly with Google Gemini instead of the server proxy.
- **Scrollable AI panels:** advisor analysis and chat keep their headers visible while their content scrolls.
- **Existing finance features:** local expense and budget storage, receipt scanning and safeguards, category-aware budgets, SMS import, and responsive dashboard improvements from v1.1.0 remain included.
- **Tests:** 22 client tests and 14 optional proxy server tests cover the current code.

Latest release: `v1.2.0`.

---

## Quick start for users

### Option 1: Install the APK

1. Download `FinanceAI.apk` from the Assets section of the [latest GitHub Release](https://github.com/Elementals07/financeai-app/releases/latest).
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

### Configure Gemini AI

AI features require an internet connection and a Gemini API key. Without a configured key, local finance features still work, but AI analysis, receipt scanning, and SMS parsing are unavailable.

1. **Create a Gemini API key**
   - Create the key in Google AI Studio or Google Cloud.
   - Do not use a key that was committed, logged, shared or reported by Google as leaked.
   - Enable the Gemini/Generative Language API and configure quota or billing for the project.

2. **Add the key in FinanceAI**
   - Open **AI Settings** in the sidebar and paste the raw key. Up to five keys can be added for automatic rotation.
   - Keys are stored in this browser's local storage. FinanceAI does not encrypt them; anyone with access to the unlocked browser profile may be able to retrieve them. Remove keys from shared or untrusted devices.
   - The app sends requests directly to Google Gemini. AI prompts can include relevant transaction and budget context; receipt images and selected SMS content are also sent to Google when those features are used. Review Google's terms and privacy policy before proceeding.

3. **Protect and revoke keys**
   - Never commit or share keys in Git, issues, screenshots, logs or chat.
   - Remove keys from AI Settings when no longer needed, and revoke any key that was exposed.

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
- An internet connection and a user-provided Gemini API key are required for AI features.

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
        │   Google Gemini HTTPS (user-provided keys)
        └── smsService.js           → Capacitor SmsReader plugin (Android)
```

There is no financial-data backend: expenses, budgets and transactions stay in Dexie. AI requests go directly from the client to Google Gemini and may include financial context, receipt images or selected SMS content. The optional `server/` proxy is maintained separately and is not used by the app's AI flows. The file `client/src/api/axios.js` looks like an Axios client to the UI, but it routes finance and AI calls to local services. Preserve that adapter and its pseudo-routes; do not replace it with a real `axios` instance pointing at a server.

### Important service responsibilities

| File | Responsibility |
| --- | --- |
| `client/src/api/axios.js` | Maps pseudo-REST routes such as `/expenses`, `/expenses/batch`, `/expenses/sms-import`, `/ai/scan-bill` to local services. |
| `client/src/services/localDatabase.js` | Opens Dexie, runs schema migrations and seeds the first launch. |
| `client/src/services/localExpenseService.js` | CRUD, atomic batch/SMS import, budget breakdown, summaries and analytics. |
| `client/src/services/localGeminiService.js` | Builds analysis/chat/OCR/SMS prompts and sends requests directly to Google Gemini using user-provided keys. |
| `client/src/services/geminiKeys.js` | Validates and stores up to five user-provided Gemini keys in browser local storage. |
| `client/src/services/financeParsers.js` | Pure validation, SMS filters, receipt normalisation, fingerprints and budget-status rules. No browser or Dexie dependency, so it is unit-testable. |
| `client/src/services/smsService.js` | Reads native SMS, filters locally, removes processed IDs and calls the parser. |
| `client/src/utils/receiptFingerprint.js` | Deterministic per-device receipt fingerprint. |
| `server/server.js` | Optional Express AI proxy with CORS, request-size limits and in-memory rate limiting. |
| `server/services/aiService.js` | Optional proxy's server-only Gemini key loading, rotation, retries, timeouts and sanitized errors. |
| `server/routes/aiRoutes.js` | Optional proxy endpoint `POST /api/ai/generate`; not used by the app's AI flows. |
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

The `/ai/*` pseudo-routes are handled locally for prompt/tool orchestration. App AI requests go directly to Google Gemini:

```text
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
```

The optional `server/` proxy has its own `/api/ai/generate` and `/api/health` endpoints, but is not used by the app.

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
- Node.js/Express AI proxy (optional standalone service)
- Google Gemini REST API (`gemini-2.5-flash`)
- Native Android Java plugin for SMS
- Node built-in test runner, ESLint

### Requirements

- Node.js 22 for the client and AI proxy
- Java JDK 21
- Android SDK for Android builds
- A user-provided Gemini API key in AI Settings for app AI features

---

## Development

### Run the optional AI proxy

```bash
cd server
npm install
npm test
npm run dev
```

Create `server/.env` from `server/.env.example` and add `GEMINI_API_KEY_1..5`. The proxy exposes `POST /api/ai/generate` and `GET /api/health`; it is not used by the current app AI flows.

### Install and run the web app

```bash
cd client
npm install
npm run dev
```

Start the app with `npm run dev`, then add a Gemini API key in **AI Settings**. No proxy URL is required by the app.

### Lint, test and build

```bash
cd client
npm run lint
npm test
npm run build
```

`npm test` runs the Node tests in `client/tests/`; `npm test` in `server/` runs the proxy tests. The web build is written to `client/dist/`.

AI features in the APK require a user-provided Gemini API key and an internet connection.

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

Expected current result: **22 client tests and 14 proxy tests passing**.

---

## Security and privacy notes

### Gemini keys and AI data

- Users add their own Gemini keys in AI Settings. Keys are stored in browser local storage, which FinanceAI does not encrypt.
- The app sends AI prompts and relevant financial context directly to Google Gemini. Receipt images and selected SMS content are sent for those corresponding AI features.
- Do not commit or share keys in source, the APK, screenshots, logs, issues or chat. Remove keys from shared or untrusted devices and revoke any exposed key.
- The optional server proxy uses keys in `server/.env` or deployment secrets, but the app's current AI flows do not use that proxy.

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
- **Do not bundle or hardcode Gemini keys.** The app's AI Settings accepts user-provided keys and stores them in browser local storage; keep the storage and data-transmission disclosures accurate.
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

- Never hardcode or commit API keys. The app accepts user-provided Gemini keys and stores them in local storage; clearly disclose that this storage is not encrypted.
- Do not bundle user or server Gemini keys in the APK or expose server keys in client code.
- Do not log SMS bodies, account numbers, UPI IDs, balances or OTPs.
- Keep local filtering and redaction in place before sending selected SMS text to Google Gemini.
- Do not claim that browser local storage encrypts user-provided keys.
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
| “No Gemini API key configured” | Open **AI Settings**, add a valid key, and retry. |
| “Gemini request failed” | Check the network connection, key validity and Google AI Studio quota. Rotate or replace a rejected key in **AI Settings**. |
| Receipt scan fails | Check the network connection, Gemini key and image size (under 8 MB). You can still enter the receipt manually. |
| SMS sync button fails on the web | SMS import is Android-only. Use the APK. |
| SMS permission denied | Re-enable SMS permission in Android app settings, then tap Sync Bank SMS again. |
| No SMS transactions found | The app may have filtered them as OTP, credit, failed, promotional or already processed, or the bank format may be unsupported. |
| Duplicate receipt warning | Review the earlier receipt. Confirm again only if this is genuinely a second bill. |
| Budget shows red or amber unexpectedly | Overall plan comes from profile monthly income, and category limits come from the budget records. Check both in Budget. |
| Gradle build fails | Confirm Java 21, the Android SDK, and run `npx cap sync android` before `assembleDebug`. |
| Local data disappeared | Clearing app data or uninstalling removes Dexie storage. There is no server backup. |

---

## Glossary

- **AI proxy:** The optional `server/` app that accepts server-configured Gemini keys and forwards AI requests. The current app's AI flows do not use it.
- **APK:** Android application package, the installable app file.
- **Capacitor:** Tool that wraps the web app in a native Android shell and exposes native plugins.
- **Dexie / IndexedDB:** Browser/WebView database used as the on-device source of truth.
- **Gemini:** Google's AI API used for receipt OCR, SMS parsing and financial advice.
- **Local-first:** The app works from data stored on the device, not from a remote server.
- **Pseudo-route:** A URL-like string handled locally by `client/src/api/axios.js` instead of being sent over HTTP.
- **Processed SMS:** An SMS whose transaction was saved successfully, recorded in `processed_sms` to prevent duplicate imports.
