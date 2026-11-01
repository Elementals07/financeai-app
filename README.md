# FinanceAI Mobile App (100% Standalone Android APK)

A 100% autonomous, on-device personal financial advisor Android application built with React, Capacitor, Dexie.js (embedded IndexedDB), and Direct-to-Gemini REST integration.

## Key Features

1. **Zero PC or Server Dependency**: 
   - No local Node.js server, PC, or localhost:5000 required.
   - Install the APK on any Android device and use every feature offline/independently.
2. **On-Device Database & Analytics**:
   - High-performance local storage via Dexie.js (IndexedDB).
   - Pre-seeded with 2.5-year realistic Indian middle-class dataset (May 2024 to Nov 2026, ₹65k income ladder).
   - Calculates monthly summaries, 5-year trends, daily spending velocities, rolling category baselines, and micro-leakage entirely on the phone.
3. **Direct-to-Gemini AI Engine**:
   - Calls Google Gemini 2.5 Flash directly via HTTPS REST with automatic 5-key rotation fallback on rate limits.
   - Grounded financial diagnosis and intelligent conversational assistant with local multi-turn function calling.
4. **Native Bill Scanner**:
   - Uses `@capacitor/camera` to take receipts directly with the device camera or pick from the photo gallery.
   - Extracts merchant, date, amounts, and itemized lines with Gemini Multimodal Vision OCR.
5. **Polished Design System**:
   - Deep Indigo (`#2D3FBF`), Teal (`#0EA5C9`), DM Sans typography, and full Android safe-area padding.

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
│   │   │   ├── localDatabase.js   # Dexie database & auto-seed routines
│   │   │   ├── localExpenseService.js # On-device CRUD & financial analytics
│   │   │   ├── localGeminiService.js  # Direct Gemini HTTPS caller & key rotator
│   │   │   ├── cameraService.js   # Native Capacitor Camera & Gallery handler
│   │   │   └── seedData.js        # 31-month realistic Indian middle-class dataset
│   │   └── components/            # UI components (Dashboard, Expenses, AI, Budget)
│   ├── capacitor.config.json      # Capacitor configuration
│   └── package.json
└── .github/
    └── workflows/
        └── build-apk.yml          # Automated APK build & GitHub Release workflow
```
