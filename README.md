# FinanceAI Mobile App (Standalone Android APK)

A local-first personal finance Android application built with React, Capacitor, Dexie.js (embedded IndexedDB) and a direct-to-Gemini REST integration.

## Key Features

1. **Local-first data**
   - Expenses, budgets, categories and SMS import history are stored on-device in Dexie/IndexedDB.
   - No Node.js, MongoDB, MySQL or Postgres backend is required.
   - Seeded with 2.5 years of realistic Indian middle-class data (May 2024 to Nov 2026).
2. **Receipt scanning with item splitting**
   - Uses `@capacitor/camera` to take a receipt photo or pick one from the gallery.
   - Gemini Vision extracts the merchant, date, total and line items.
   - Every line item can be reviewed, edited, assigned a real category and saved as its own transaction.
   - Unreadable lines are skipped with a warning; amounts are never invented.
   - Re-saving the same receipt requires an explicit duplicate confirmation.
   - The receipt total and the sum of line items are reconciled before saving.
3. **Category-aware budgets**
   - Monthly budget and per-category allocations.
   - Overall over-budget is shown as red; any overspent category is amber; reaching 80% of the overall budget is amber.
   - Category progress rows mark overspent categories and safely handle categories without an allocation.
4. **SMS bank/UPI tracking (Android only)**
   - Reads recent inbox SMS through a native Capacitor plugin after `READ_SMS` permission is granted.
   - Locally filters OTPs, credits, refunds, failures, payment requests and promotions before any text is sent to Gemini.
   - Redacts account numbers, UPI IDs, balances and OTP digits before the AI request.
   - Shows parsed transactions for review; nothing is saved until the user approves the selected rows.
   - Duplicate SMS IDs and duplicate receipt fingerprints are blocked in Dexie, so an import is not repeated across sessions.
5. **AI advisor and analytics**
   - Grounded financial diagnosis and a conversational assistant with local multi-turn function calling.
   - On-device monthly summaries, trends, category baselines and spending velocity.

## AI API key configuration

Gemini is called directly from the app over HTTPS. There is no bundled backend proxy.

**Do not commit API keys to this repository.** Keys committed in source or embedded in a distributed APK should be treated as public and must be revoked.

Supported options, in order of preference:

1. **Runtime key (recommended for local/personal use)**
   - Open the app and store one or more keys in `localStorage` under `financeai_gemini_api_keys`.
   - The value is a JSON array of key strings, for example `["KEY_ONE","KEY_TWO"]`.
   - Keys stay in the device WebView storage and are not part of the repository.
2. **Build-time environment variables (development only)**
   - `VITE_GEMINI_API_KEYS` or `VITE_GEMINI_API_KEY` can be provided in a local, uncommitted `.env` file.
   - Vite inlines `VITE_*` values into the web bundle, so these keys are extractable from the APK. Never use this for a public build.
3. **Secure backend proxy (recommended for distribution)**
   - Put the key on a server you control, authenticate users there, and have the app call the proxy instead of Gemini.
   - This is the only option that keeps the key out of the APK.

Requirements:

- Enable the Gemini API for the key's Google Cloud project.
- Set up billing/quota appropriate to your usage.
- Rotate keys if they were ever committed, pasted into logs or shared.

## SMS permissions and Play Store policy

The app declares `READ_SMS` and `CAMERA`. SMS scanning is only available in the Android build and only after the user grants permission.

- The app reads SMS only when the user explicitly starts an SMS scan. There is no background or periodic SMS scanning.
- Only recent inbox messages are considered, and the native plugin clamps the range to 1-90 days and at most 60 messages.
- Messages that do not look like debit transactions are discarded locally.
- No SMS is saved until the user reviews and approves it.

**Google Play policy differs from sideloading.** `READ_SMS` is a restricted permission. Google Play generally allows it only for apps whose core functionality is SMS-based (for example, default SMS handlers or specific financial-transaction use cases), and distribution requires a permissions declaration and review. A personal/sideloaded APK is not subject to the same review, but publishing this app on Play with `READ_SMS` may be rejected if the declared core use case is not accepted. Remove the permission and the native SMS plugin for a Play build that does not qualify.

## Project Structure

```
FinanceAI-App/
├── apk/
│   └── FinanceAI.apk              # Standalone release/debug APK
├── client/
│   ├── android/                   # Native Android Studio / Gradle project
│   ├── src/
│   │   ├── api/axios.js           # Client-side API adapter (Dexie + Gemini direct)
│   │   ├── services/
│   │   │   ├── localDatabase.js   # Dexie database, schema migrations & seed routines
│   │   │   ├── localExpenseService.js # On-device CRUD, batch/SMS import & analytics
│   │   │   ├── localGeminiService.js  # Direct Gemini HTTPS caller & key rotator
│   │   │   ├── financeParsers.js  # Pure validation, SMS filtering & budget rules
│   │   │   ├── smsService.js      # Native SMS fetch, filtering & dedupe
│   │   │   ├── cameraService.js   # Native Capacitor Camera & Gallery handler
│   │   │   └── seedData.js        # Realistic Indian middle-class dataset
│   │   └── components/            # UI components (Dashboard, Expenses, AI, Budget)
│   ├── tests/                     # Node built-in test runner tests
│   ├── capacitor.config.json      # Capacitor configuration
│   └── package.json
└── .github/
    └── workflows/
        └── build-apk.yml          # Automated APK build & GitHub Release workflow
```

## Development

```bash
cd client
npm install
npm run lint
npm test
npm run build
```

Android debug APK:

```bash
cd client
npx cap sync android
cd android
./gradlew assembleDebug
```

The debug APK is written to `client/android/app/build/outputs/apk/debug/app-debug.apk`.

## Testing

Pure parsing, validation, receipt-fingerprint and budget-status logic is covered by Node's built-in test runner:

```bash
cd client
npm test
```

## Known limitations

- AI features (receipt OCR, SMS parsing, advisor) require network access and a working Gemini key. Everything else is local.
- Receipt OCR and SMS parsing are best-effort; users must review extracted data before saving.
- Receipt duplicate detection is a deterministic per-device fingerprint, not a cryptographic identity check.
- SMS parsing depends on bank message wording. Messages from unknown senders or unusual formats may be skipped or marked for review.
- `READ_SMS` may prevent Play Store distribution; see the policy section above.
- The app does not provide bank-grade encryption for on-device storage. Protect the device with a screen lock and do not use the app on shared devices for sensitive data.
