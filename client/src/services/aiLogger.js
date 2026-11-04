/**
 * Dev-only AI workflow logger.
 *
 * Sends small structured events to the Vite dev server so the AI request
 * lifecycle (model discovery, attempts, retries, fallbacks and errors) is
 * visible in the terminal running `npm run dev`.
 *
 * No API keys, prompts or user financial data are included in these events.
 */

const isBrowser = typeof window !== 'undefined';
const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

export function logAiEvent(event, detail = {}) {
    if (!isBrowser) return;

    try {
        console.debug(`[FinanceAI AI] ${event}`, detail);
    } catch {
        // Console may be unavailable in some WebViews.
    }

    if (!isDev) return;

    try {
        const payload = JSON.stringify({
            event,
            detail,
            timestamp: new Date().toISOString()
        });

        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([payload], { type: 'application/json' });
            if (navigator.sendBeacon('/api/ai/log', blob)) return;
        }

        fetch('/api/ai/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(() => {
            // Logging must never break an AI request.
        });
    } catch {
        // Logging must never break an AI request.
    }
}
