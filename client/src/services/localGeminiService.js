import { db } from './localDatabase.js';
import { localExpenseService } from './localExpenseService.js';
import { loadGeminiKeys } from './geminiKeys.js';
import { logAiEvent } from './aiLogger.js';
import {
    dateToLocalYmd,
    isExcludedSmsBody,
    maskSender,
    normalizeReceiptResult,
    normalizeSmsParse,
    redactSmsBody
} from './financeParsers.js';

/**
 * Central Gemini configuration — the single source of truth for every AI
 * feature (analysis, chat, receipt scanning and SMS parsing all funnel
 * through callGeminiDirect below, which uses these values).
 */
export const GEMINI_CONFIG = {
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    // Stable alias tracking the current Flash model. It supports text,
    // image input and function calling.
    model: 'gemini-flash-latest',
    // Consulted in order when the primary model is unavailable to the
    // project (HTTP 404) or repeatedly returns a server-side error (5xx).
    fallbackModels: [
        'gemini-3.8-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash'
    ]
};

// Temporary failures eligible for bounded exponential backoff. Attrition
// of quota (429) additionally rotates to the next configured key.
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 8000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_TOTAL_TIMEOUT_MS = 90000;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

let activeKeyIndex = 0;
let modelCache = null;

// Test-only hook so simulated tests can pin the rotation start index.
export const geminiTestHooks = {
    setActiveKeyIndex(value) {
        activeKeyIndex = Math.max(0, Number(value) || 0);
    }
};

function parseJsonSafely(text, fallback) {
    if (typeof text !== 'string' || !text.trim()) return fallback;
    try {
        return JSON.parse(text);
    } catch {
        try {
            const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch {
            return fallback;
        }
    }
}

const ESSENTIAL_CATEGORIES = new Set([
    'Rent', 'Groceries', 'Utilities', 'Health', 'Education',
    'Food', 'Bills', 'Insurance', 'EMI', 'Medical'
]);

function classifyCategory(cat) {
    return ESSENTIAL_CATEGORIES.has(cat) ? 'Essential' : 'Discretionary';
}

function fmt(n) {
    return Number(n || 0).toLocaleString('en-IN');
}

const ANALYSIS_SYSTEM_PROMPT = `You are an elite, direct Personal Financial Advisor for an Indian user. You have analyzed their spending history and baseline across multiple months.

CORE PRINCIPLES:
1. **Dynamic & Authentic**: Provide advice tailored to this user's exact numbers and anomalies. Do NOT recite generic slogans, repetitive mantras, or canned speeches.
2. **Real Solutions, Not Vague Suggestions**: Never say "continue to monitor" or "consider setting a budget". Prescribe specific, calculated targets in Rupees (₹) with estimated savings impact.
3. **Structured & Scannable**:
   - Avoid long essay paragraphs or walls of text.
   - Use headings (\`###\` or \`####\`) to separate major points.
   - Summarize key financial metrics with piped stats (e.g. **Income:** ₹X | **Spent:** ₹Y | **Saved:** ₹Z) so they display as clean cards.
   - Use bullet points (\`*\` or \`-\`) with relevant icons (🚨 for high-risk drains, ⚠️ for warnings, ✅ for wins).
   - Use numbered action steps (\`1.\`, \`2.\`, \`3.\`) for concrete fixes tailored to their primary financial challenges.
   - Use \`💡\` for key takeaways and \`🎯\` for targets.
- All amounts in Indian Rupees (₹).`;

const CHAT_SYSTEM_PROMPT = `You are a knowledgeable, direct personal finance advisor for an Indian user. You have their complete financial data (income, monthly spending by category, historical baselines, budget status, micro-spending patterns) provided below.

YOUR JOB:
- Answer the user's specific question using their actual numbers
- Compare current behavior to their own historical baseline whenever relevant
- Be conversational, not robotic — talk like a knowledgeable friend, not a finance textbook
- If they ask "can I afford X?", look at their remaining budget, savings rate, and spending velocity before answering
- If they ask about a category, tell them how it compares to their historical average
- Be honest. If their finances look risky, say so clearly with the specific numbers
- All amounts in Indian Rupees (₹)
- Keep responses focused — 1–3 paragraphs maximum for most questions`;

// Tool definitions for Gemini Function Calling
const TOOL_DEFINITIONS = [
    {
        name: 'get_period_summary',
        description: 'Aggregate spending across a multi-month range. Returns total spent, count, and breakdown by month and category.',
        parameters: {
            type: 'OBJECT',
            properties: {
                startMonth: { type: 'STRING', description: 'Start month in YYYY-MM format' },
                endMonth: { type: 'STRING', description: 'End month in YYYY-MM format' }
            },
            required: ['startMonth', 'endMonth']
        }
    },
    {
        name: 'get_category_history',
        description: 'Month-by-month spending history for one specific category across a date range.',
        parameters: {
            type: 'OBJECT',
            properties: {
                category: { type: 'STRING', description: 'Category name (e.g. Food, Shopping, Travel)' },
                startMonth: { type: 'STRING', description: 'Start month in YYYY-MM' },
                endMonth: { type: 'STRING', description: 'End month in YYYY-MM' }
            },
            required: ['category', 'startMonth', 'endMonth']
        }
    },
    {
        name: 'get_annual_breakdown',
        description: 'Full year spending breakdown by month and category for an entire calendar year.',
        parameters: {
            type: 'OBJECT',
            properties: {
                year: { type: 'INTEGER', description: 'Calendar year as 4-digit integer (e.g. 2025, 2026)' }
            },
            required: ['year']
        }
    },
    {
        name: 'compare_periods',
        description: 'Side-by-side comparison of spending between two multi-month date ranges.',
        parameters: {
            type: 'OBJECT',
            properties: {
                p1Start: { type: 'STRING', description: 'Period 1 start month (YYYY-MM)' },
                p1End: { type: 'STRING', description: 'Period 1 end month (YYYY-MM)' },
                p2Start: { type: 'STRING', description: 'Period 2 start month (YYYY-MM)' },
                p2End: { type: 'STRING', description: 'Period 2 end month (YYYY-MM)' }
            },
            required: ['p1Start', 'p1End', 'p2Start', 'p2End']
        }
    },
    {
        name: 'get_micro_leakage',
        description: 'Detect small repeated expenses under a threshold that quietly drain budget.',
        parameters: {
            type: 'OBJECT',
            properties: {
                month: { type: 'STRING', description: 'Month in YYYY-MM' },
                threshold: { type: 'NUMBER', description: 'Max single transaction amount (default 300)' }
            },
            required: ['month']
        }
    }
];

async function executeLocalTool(toolName, args) {
    logAiEvent('chat.tool-call', { tool: toolName, args });
    switch (toolName) {
        case 'get_period_summary':
            return await localExpenseService.getPeriodSummary(args.startMonth, args.endMonth);
        case 'get_category_history':
            return await localExpenseService.getCategoryHistory(args.category, args.startMonth, args.endMonth);
        case 'get_annual_breakdown':
            return await localExpenseService.getAnnualBreakdown(args.year);
        case 'compare_periods':
            return await localExpenseService.comparePeriods(args.p1Start, args.p1End, args.p2Start, args.p2End);
        case 'get_micro_leakage':
            return await localExpenseService.getMicroLeakage(args.month, args.threshold || 300);
        default:
            return { error: `Tool ${toolName} not supported` };
    }
}

/**
 * Strips anything that could expose an API key from a Google error message
 * before it is shown to the user or surfaced through errors.
 */
function sanitizeErrorMessage(message) {
    return String(message || '')
        .replace(/AIza[0-9A-Za-z_.-]+/g, '[redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}

function backoffDelayMs(attempt) {
    return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

class GeminiTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s.`);
        this.name = 'GeminiTimeoutError';
    }
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            try {
                controller?.abort();
            } catch {
                // Ignore abort failures.
            }
            reject(new GeminiTimeoutError(timeoutMs));
        }, timeoutMs);
    });

    try {
        return await Promise.race([
            fetchFn(url, controller ? { ...init, signal: controller.signal } : init),
            timeout
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Pulls the text out of the first Gemini candidate and raises a useful error
 * when Google blocked or truncated the response. This prevents components
 * from receiving an empty string and staying in a loading/blank state.
 */
export function extractGeminiResponseText(response) {
    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map(part => part?.text || '').join('').trim();

    if (text) return text;

    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) {
        throw new Error(`Gemini blocked this request (${blockReason}). Try rephrasing it.`);
    }

    if (candidate?.finishReason === 'SAFETY') {
        throw new Error('Gemini stopped the response for safety reasons. Try rephrasing your request.');
    }

    if (candidate?.finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini reached its output limit before producing an answer. Please try again.');
    }

    return '';
}

async function discoverAvailableModels({ keys, fetchFn, timeoutMs }) {
    if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_TTL_MS) {
        return modelCache.models;
    }

    const response = await fetchWithTimeout(
        fetchFn,
        `${GEMINI_CONFIG.apiBase}/models?pageSize=200`,
        {
            method: 'GET',
            headers: { 'x-goog-api-key': keys[activeKeyIndex % keys.length] }
        },
        timeoutMs
    );

    if (!response.ok) {
        throw new Error(`Model discovery failed with HTTP ${response.status}.`);
    }

    const body = await response.json();
    const models = (Array.isArray(body?.models) ? body.models : [])
        .filter(model => Array.isArray(model?.supportedGenerationMethods)
            && model.supportedGenerationMethods.includes('generateContent'))
        .map(model => String(model.name || '').replace(/^models\//, ''))
        .filter(Boolean);

    modelCache = { models, at: Date.now() };
    return models;
}

/**
 * Direct Gemini caller with user-supplied keys, bounded exponential backoff
 * and central model configuration. Keys live only in this device's local
 * storage and are never logged, bundled or placed in the request URL.
 *
 * - Authentication uses the documented `x-goog-api-key` header.
 * - Model availability is checked against Google's model list (cached for
 *   10 minutes) so projects that cannot access an alias automatically use an
 *   available Flash model instead of failing blindly.
 * - Permanent errors (400 invalid key, 401/403 auth or permission) fail
 *   immediately with Google's sanitized message and are never retried.
 * - Temporary errors (429, 5xx) retry with bounded exponential backoff,
 *   rotating to the next key on 429 (quota exhaustion is per key). Server
 *   side 5xx errors never rotate keys.
 * - 404 and repeated 5xx fall through to the next configured model.
 * - Every request has a timeout and the whole call has a deadline, so callers
 *   can never hang indefinitely.
 *
 * Test hooks are injected via `options` (keys, fetchImpl, delayFn) so the
 * error-handling matrix can be exercised without network access.
 */
export async function callGeminiDirect(payload, options = {}) {

    const maxRetries = options.maxRetries ?? 2;
    const requestTimeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    const deadline = Date.now() + totalTimeoutMs;
    const envKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';
    const storedKeys = loadGeminiKeys();
    const effectiveKeys = envKey ? [envKey, ...storedKeys.filter(k => k !== envKey)] : storedKeys;
    const keys = options.keys ?? effectiveKeys;
    const fetchFn = options.fetchImpl ?? fetch.bind(globalThis);
    const delayFn = options.delayFn ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));

    if (keys.length === 0) {
        throw new Error(
            'No Gemini API key configured. Open AI Settings in the sidebar and add up to 5 keys.'
        );
    }

    const configuredModels = [GEMINI_CONFIG.model, ...GEMINI_CONFIG.fallbackModels];
    let models = configuredModels;

    logAiEvent('gemini.start', {
        keys: keys.length,
        primaryModel: GEMINI_CONFIG.model,
        fallbacks: GEMINI_CONFIG.fallbackModels
    });

    // Verify model availability on real (network) calls. Tests that inject a
    // fetch implementation skip discovery unless explicitly requested.
    const shouldDiscover = options.discoverModels ?? !options.fetchImpl;
    if (shouldDiscover) {
        try {
            const available = await discoverAvailableModels({
                keys,
                fetchFn,
                timeoutMs: Math.min(requestTimeoutMs, Math.max(2000, deadline - Date.now()))
            });
            const availableSet = new Set(available);
            const preferred = configuredModels.filter(model => availableSet.has(model));
            const discoveredFlash = available
                .filter(model => /gemini.*flash/i.test(model) && !configuredModels.includes(model))
                .slice(0, 2);
            models = [...new Set([...preferred, ...configuredModels, ...discoveredFlash])];
            logAiEvent('gemini.models', {
                available: available.length,
                verified: preferred,
                order: models
            });
        } catch (error) {
            logAiEvent('gemini.models-unverified', { reason: error.message });
            // Discovery is an optimization only; generation still works when
            // the ListModels endpoint is blocked or temporarily unavailable.
        }
    }

    let lastDetail = '';

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
        if (Date.now() >= deadline) {
            throw new Error('Gemini request timed out. Please check your connection and try again.');
        }

        const model = models[modelIndex];
        const url = `${GEMINI_CONFIG.apiBase}/models/${model}:generateContent`;
        const attemptedKeys = new Set();
        const maxAttempts = Math.max(maxRetries, keys.length - 1);

        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
            let response;
            const requestStartedAt = Date.now();
            const keyNumber = (activeKeyIndex % keys.length) + 1;
            logAiEvent('gemini.request', {
                model,
                attempt: attempt + 1,
                maxAttempts: maxAttempts + 1,
                key: keyNumber
            });
            try {
                response = await fetchWithTimeout(fetchFn, url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': keys[activeKeyIndex % keys.length]
                    },
                    body: JSON.stringify(payload)
                }, Math.min(requestTimeoutMs, Math.max(1000, deadline - Date.now())));
            } catch (err) {
                // Network/TLS/WebView failures are independent of model and
                // key: retry the same request with bounded backoff.
                const backoff = backoffDelayMs(attempt);
                logAiEvent('gemini.network-error', {
                    model,
                    attempt: attempt + 1,
                    reason: err instanceof GeminiTimeoutError ? 'timeout' : 'network'
                });
                if (attempt < maxRetries && Date.now() + backoff < deadline) {
                    logAiEvent('gemini.retry', { model, attempt: attempt + 1, delayMs: backoff });
                    await delayFn(backoff);
                    continue;
                }
                if (err instanceof GeminiTimeoutError) {
                    throw new Error(
                        `${err.message} The AI service may be busy — please try again in a moment.`
                    );
                }
                throw new Error(
                    'Gemini request failed due to a network error. Check your internet connection and try again.'
                );
            }

            if (response.ok) {
                try {
                    const result = await response.json();
                    logAiEvent('gemini.success', {
                        model,
                        attempt: attempt + 1,
                        key: keyNumber,
                        ms: Date.now() - requestStartedAt
                    });
                    return result;
                } catch {
                    logAiEvent('gemini.malformed-response', { model });
                    throw new Error('Gemini returned a malformed response body.');
                }
            }

            let errorBody = null;
            try {
                errorBody = await response.json();
            } catch {
                // Non-JSON error body; detail stays empty.
            }
            const detail = sanitizeErrorMessage(errorBody?.error?.message);
            const googleStatus = errorBody?.error?.status || '';

            if (!RETRYABLE_HTTP_STATUSES.has(response.status)) {
                // Permanent failure: 400 (invalid argument/key), 401/403
                // (authentication, permission, key restrictions) and 404
                // (model not found). Never retried; each key is attempted at
                // most once.
                logAiEvent('gemini.http-error', {
                    model,
                    status: response.status,
                    googleStatus,
                    detail
                });

                if (response.status === 404 && modelIndex + 1 < models.length) {
                    logAiEvent('gemini.model-fallback', {
                        from: model,
                        to: models[modelIndex + 1],
                        reason: 'HTTP 404'
                    });
                    break; // Try the fallback model instead.
                }
                if (response.status === 404) {
                    throw new Error(
                        `No Gemini model from the configured list (${models.slice(0, modelIndex + 1).join(', ')}) is available with your API keys (HTTP 404${googleStatus ? `, ${googleStatus}` : ''})${detail ? `: ${detail}` : '.'} The model list can be changed in client/src/services/localGeminiService.js (GEMINI_CONFIG).`
                    );
                }

                // Authentication/permission failures are permanent for the
                // current key. Try each remaining key once (never repeatedly)
                // so one stale key cannot disable the whole app.
                attemptedKeys.add(activeKeyIndex % keys.length);
                if (keys.length > 1 && attemptedKeys.size < keys.length) {
                    activeKeyIndex = (activeKeyIndex + 1) % keys.length;
                    logAiEvent('gemini.key-rotate', {
                        reason: `HTTP ${response.status}`,
                        nextKey: (activeKeyIndex % keys.length) + 1
                    });
                    continue;
                }
                throw new Error(
                    `Gemini request failed (HTTP ${response.status}${googleStatus ? `, ${googleStatus}` : ''})${detail ? `: ${detail}` : '.'}`
                );
            }

            // Temporary failure: 429/5xx. Rotate keys only on quota
            // exhaustion; server-side 5xx uses the same key.
            logAiEvent('gemini.temporary-error', {
                model,
                status: response.status,
                googleStatus,
                detail
            });
            if (response.status === 429 && keys.length > 1) {
                activeKeyIndex = (activeKeyIndex + 1) % keys.length;
                logAiEvent('gemini.key-rotate', {
                    reason: 'HTTP 429',
                    nextKey: (activeKeyIndex % keys.length) + 1
                });
            }
            lastDetail = detail || `temporary Gemini error (HTTP ${response.status}${googleStatus ? `, ${googleStatus}` : ''})`;
            const backoff = backoffDelayMs(attempt);
            if (attempt < maxRetries && Date.now() + backoff < deadline) {
                logAiEvent('gemini.retry', {
                    model,
                    attempt: attempt + 1,
                    status: response.status,
                    delayMs: backoff
                });
                await delayFn(backoff);
                continue;
            }
            if (response.status >= 500 && modelIndex + 1 < models.length) {
                logAiEvent('gemini.model-fallback', {
                    from: model,
                    to: models[modelIndex + 1],
                    reason: `HTTP ${response.status}`
                });
                break; // Try the next configured model.
            }
            throw new Error(
                `Gemini request failed after ${maxRetries + 1} attempts: ${lastDetail}`
            );
        }
    }

    logAiEvent('gemini.failed', { models });
    throw new Error(
        `No Gemini model from the configured list (${models.join(', ')}) is available for your API keys (HTTP 404).`
    );
}

export const localGeminiService = {
    /**
     * Compute on-device financial context and request diagnosis from Gemini
     */
    async generateAnalysis(month = null, refresh = false) {
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const user = await localExpenseService.getCurrentUser();
        const monthlyIncome = user ? parseFloat(user.monthly_income) || 65000 : 65000;

        // Fetch monthly summary, baselines, and micro leakage
        const [monthlySummary, categoryBaseline, microLeakage, budgetData] = await Promise.all([
            localExpenseService.getMonthlySummary(targetMonth),
            localExpenseService.getCategoryBaseline(targetMonth, 3),
            localExpenseService.getMicroLeakage(targetMonth, 300, 4),
            localExpenseService.getBudget(targetMonth)
        ]);

        // Baseline comparison map
        const baselineMap = {};
        categoryBaseline.forEach(b => {
            baselineMap[b.category] = b;
        });

        const deltaMatrix = monthlySummary.categoryBreakdown.map(item => {
            const baseline = baselineMap[item.category];
            const avgSpent = baseline ? baseline.avgSpent : null;
            let changePercent = null;
            let flag = 'new';
            if (avgSpent !== null && avgSpent > 0) {
                changePercent = Math.round(((item.total - avgSpent) / avgSpent) * 100);
                if (changePercent >= 50) flag = 'major_spike';
                else if (changePercent >= 25) flag = 'spike';
                else if (changePercent <= -20) flag = 'saving';
                else flag = 'normal';
            }
            return {
                category: item.category,
                current: item.total,
                baseline: avgSpent,
                changePercent,
                flag,
                classification: classifyCategory(item.category),
                count: item.count
            };
        });

        // Health signal
        const savingsRate = monthlyIncome > 0
            ? Math.round(((monthlyIncome - monthlySummary.totalSpending) / monthlyIncome) * 100)
            : 0;

        const hasMajorSpike = deltaMatrix.some(d => d.flag === 'major_spike');
        const hasSpike = deltaMatrix.some(d => d.flag === 'spike');
        const isOverBudget = monthlySummary.totalSpending > monthlyIncome;

        let healthSignal = 'green';
        if (isOverBudget || hasMajorSpike || savingsRate < 0) {
            healthSignal = 'red';
        } else if (hasSpike || savingsRate < 15) {
            healthSignal = 'yellow';
        }

        const summary = {
            month: targetMonth,
            monthlyIncome,
            totalSpending: monthlySummary.totalSpending,
            transactionCount: monthlySummary.transactionCount,
            categoryBreakdown: monthlySummary.categoryBreakdown,
            deltaMatrix,
            microLeakage,
            savingsRate,
            healthSignal,
            budgetStatus: budgetData
        };

        // Cache Check
        const cacheKey = `analysis_${user?.id || 1}_${targetMonth}`;
        if (!refresh) {
            const cached = await db.ai_insights_cache.get(cacheKey);
            if (cached && new Date(cached.expires_at) > new Date()) {
                return {
                    analysis: cached.response,
                    cached: true,
                    summary,
                    healthSignal,
                    generatedAt: cached.created_at
                };
            }
        }

        // Format prompt context
        const contextLines = [
            `[SNAPSHOT] ${targetMonth} | Income: ₹${fmt(monthlyIncome)} | Spent: ₹${fmt(monthlySummary.totalSpending)} | Savings Rate: ${savingsRate}% | Status: ${healthSignal.toUpperCase()}`,
            `[TOP CATEGORIES] ` + monthlySummary.categoryBreakdown.slice(0, 5).map(c => `${c.category}: ₹${fmt(c.total)} (${c.count} txns)`).join(' | '),
            `[ANOMALIES & SPIKES] ` + (deltaMatrix.filter(d => d.flag === 'major_spike' || d.flag === 'spike').map(d => `${d.category}: ₹${fmt(d.current)} (+${d.changePercent}% vs ₹${fmt(d.baseline)} baseline)`).join('; ') || 'None'),
            `[MICRO-LEAKAGE] ` + (microLeakage.map(m => `${m.category}: ${m.frequency} small transactions totaling ₹${fmt(m.total)}`).join('; ') || 'None')
        ];

        const promptText = `${contextLines.join('\n')}\n\nBased on the above financial data, provide a structured, scannable personal financial advisor analysis. Identify biggest anomalies, give a clear breakdown, and prescribe 2-3 concrete numbered solutions with exact numbers. Do not use generic filler.`;

        const payload = {
            systemInstruction: { parts: [{ text: ANALYSIS_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
            }
        };

        logAiEvent('feature.analysis', { month: targetMonth, refresh: Boolean(refresh) });
        const result = await callGeminiDirect(payload);
        const analysisText = extractGeminiResponseText(result) || 'No response generated';
        logAiEvent('feature.analysis-complete', { month: targetMonth, chars: analysisText.length });

        // Cache for 24 hours
        await db.ai_insights_cache.put({
            id: cacheKey,
            user_id: user?.id || 1,
            type: 'analysis',
            prompt_hash: targetMonth,
            response: analysisText,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
        });

        return {
            analysis: analysisText,
            cached: false,
            summary,
            healthSignal,
            generatedAt: new Date().toISOString()
        };
    },

    /**
     * Contextual multi-turn chat assistant with local tool calling
     */
    async chat(userMessage, month = null, timeframe = 'All') {
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const dataRange = await localExpenseService.getDataRange();

        const [monthlySummary, budgetData] = await Promise.all([
            localExpenseService.getMonthlySummary(targetMonth),
            localExpenseService.getBudget(targetMonth)
        ]);

        const orientationContext = `[ORIENTATION] User record spans ${dataRange.earliestMonth} to ${dataRange.latestMonth} (${dataRange.totalTransactions} transactions across categories: ${dataRange.categories}). Current viewed month: ${targetMonth}. Requested timeframe filter: ${timeframe}. Monthly income: ₹${fmt(budgetData.budgetAmount)}. Total spent in ${targetMonth}: ₹${fmt(monthlySummary.totalSpending)}.`;

        const contents = [
            {
                role: 'user',
                parts: [
                    { text: `${orientationContext}\n\n[USER QUESTION]\n${userMessage}` }
                ]
            }
        ];

        const payload = {
            systemInstruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
            contents,
            tools: [{ functionDeclarations: TOOL_DEFINITIONS }],
            generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 2048
            }
        };

        logAiEvent('feature.chat', { timeframe, chars: String(userMessage || '').length });

        // Multi-turn tool execution loop (max 3 turns)
        for (let turn = 0; turn < 3; turn++) {
            const response = await callGeminiDirect(payload);
            const candidate = response?.candidates?.[0];
            const content = candidate?.content;

            if (!content) break;

            const functionCalls = content.parts?.filter(p => p.functionCall);

            if (!functionCalls || functionCalls.length === 0) {
                const replyText = extractGeminiResponseText(response)
                    || 'I checked your accounts, but could not produce a response.';
                return {
                    reply: replyText,
                    cached: false,
                    generatedAt: new Date().toISOString()
                };
            }

            // Append assistant response with function calls
            contents.push(content);

            // Execute functions locally
            const responseParts = [];
            for (const part of functionCalls) {
                const call = part.functionCall;
                try {
                    const toolResult = await executeLocalTool(call.name, call.args || {});
                    responseParts.push({
                        functionResponse: {
                            name: call.name,
                            response: toolResult
                        }
                    });
                } catch (err) {
                    responseParts.push({
                        functionResponse: {
                            name: call.name,
                            response: { error: err.message }
                        }
                    });
                }
            }

            contents.push({
                role: 'user',
                parts: responseParts
            });
        }

        return {
            reply: 'Here is what I found in your spending data.',
            cached: false,
            generatedAt: new Date().toISOString()
        };
    },

    /**
     * Native receipt image OCR via Gemini Vision
     */
    async scanReceiptImage(base64Image, mimeType = 'image/jpeg') {
        const cleanBase64 = String(base64Image || '')
            .replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
            .trim();
        const categories = await localExpenseService.getCategories();
        const categoryNames = categories.map(c => c.name);
        const validCategories = categoryNames.join(', ') || 'Food, Travel, Rent, Entertainment, Shopping, Utilities, Health, Education, Others';

        const prompt = `You are an expert OCR receipt parsing engine for an Indian personal finance app.
Extract the receipt into a single valid JSON object with these fields:
1. "merchant": Store, vendor, shop, hospital, or company name (e.g. "D-Mart", "Apollo Pharmacy", "Swiggy", "Indian Oil"). If unknown, use "Local Store".
2. "totalAmount": The final amount paid in Rupees as a number (e.g. 1450.50). Never invent or estimate this value; use 0 if it is not readable.
3. "billDate": The date printed on the bill in exact "YYYY-MM-DD" format.
   - If the year is 2 digits (e.g. 26 or 25), convert to 4 digits (e.g. 2026).
   - If the date is missing or unreadable, set "billDate" to null.
4. "dateDetected": true if a date was found on the bill, false if null.
5. "primaryCategory": The single best category matching exactly one of: [${validCategories}].
6. "summary": A brief 1-sentence description of the bill.
7. "items": An array of every clearly listed line item. For each item:
   - "name": Item description exactly as printed (e.g. "Sunflower Oil 1L").
   - "amount": Line total in Rupees as a number. Never estimate; omit the item if the amount is unreadable.
   - "category": The best category from [${validCategories}] based on what the item is.
   Classify each product independently. For example, oil/milk/rice are usually Groceries or Food, detergent/cleaning products are usually Utilities or Household items when such a category exists, and clothing/electronics are Shopping.
   If line items are not clearly distinguishable, return an empty array [].
8. "warnings": An array of short strings for anything you could not read confidently.

Rules:
- Use ONLY the category names listed above. Never invent a category.
- If a product does not clearly match a category, use the closest valid category.
- Do not merge two products into one line item.
- Do not distribute tax, discount, or unknown charges among products. Report the printed total separately.
- Preserve duplicate product descriptions as separate line items if they appear separately.

CRITICAL: Return ONLY raw JSON without markdown code fences or backticks.`;

        const payload = {
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                data: cleanBase64,
                                mimeType: mimeType || 'image/jpeg'
                            }
                        },
                        { text: prompt }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        };

        logAiEvent('feature.receipt-scan', { mimeType });
        const result = await callGeminiDirect(payload);
        const text = extractGeminiResponseText(result) || '{}';
        const parsed = parseJsonSafely(text, null);
        const normalized = normalizeReceiptResult(parsed, categoryNames);

        if (Array.isArray(parsed?.warnings)) {
            normalized.warnings.push(
                ...parsed.warnings
                    .filter(warning => typeof warning === 'string' && warning.trim())
                    .map(warning => warning.trim())
            );
        }

        return normalized;
    },

    /**
     * Parses a batch of transactional bank/UPI SMS messages into structured expenses
     */
    async parseBankSms(messages = []) {
        if (!Array.isArray(messages) || messages.length === 0) return [];

        const categories = await localExpenseService.getCategories();
        const categoryNames = categories.map(c => c.name);
        const validCategories = categoryNames.join(', ') || 'Food, Travel, Rent, Entertainment, Shopping, Utilities, Health, Education, Others';

        // Local privacy filter: strong exclusions never leave the device.
        const candidates = messages
            .filter(message => message && message.body && !isExcludedSmsBody(message.body))
            .slice(0, 60);

        if (candidates.length === 0) return [];

        const buildPrompt = (smsData) => `You are a strict financial NLP parser for Indian banking and UPI messages.
Extract only completed money-out (debit/expense) transactions from the messages below.

Valid Categories to assign (use exactly one of these names): [${validCategories}].

Rules:
1. "smsId": The exact "id" from the input message.
2. "merchant": The business, merchant, or person receiving the payment (e.g. "Swiggy", "Amazon", "Shell Petrol", "D-Mart", "Uber", "Electricity Board"). Use an empty string if it cannot be determined.
3. "amount": The debited amount as a positive number. Never use an account balance, available balance, or credit amount.
4. "date": Transaction date in "YYYY-MM-DD" format. Use the approxDate when the message has no explicit date.
5. "category": Best matched category from [${validCategories}].
6. "type": "debit" or "credit".
7. "confidence": A number from 0 to 1 describing how certain you are.
8. "uncertain": true if the message is ambiguous or you had to guess the merchant or amount.

Exclude:
- OTPs, login alerts, verification codes and password messages.
- Credits, salary inflows, refunds, reversals and cashback credits.
- Balance-only notifications.
- Failed, declined, cancelled or reversed transactions.
- Promotional messages and payment/collect requests.
- Account balance amounts of any kind.

If no message contains a valid debit, return an empty array [].

Input SMS List:
${JSON.stringify(smsData, null, 2)}

CRITICAL: Return ONLY a raw JSON array without markdown code blocks:
[
  { "smsId": "...", "merchant": "...", "amount": 100, "date": "YYYY-MM-DD", "category": "...", "type": "debit", "confidence": 0.9, "uncertain": false }
]`;

        logAiEvent('feature.sms-parse', { messages: candidates.length });

        const CHUNK_SIZE = 15;
        const normalized = [];

        for (let index = 0; index < candidates.length; index += CHUNK_SIZE) {
            const chunk = candidates.slice(index, index + CHUNK_SIZE);
            const smsData = chunk.map(message => ({
                id: String(message.id),
                from: maskSender(message.address),
                body: redactSmsBody(message.body).slice(0, 300),
                approxDate: dateToLocalYmd(message.date)
            }));

            const res = await callGeminiDirect({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: buildPrompt(smsData) }]
                    }
                ],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: 'application/json'
                }
            });

            const text = extractGeminiResponseText(res) || '[]';
            const parsed = parseJsonSafely(text, []);
            normalized.push(...normalizeSmsParse(parsed, chunk, categoryNames));
        }

        return normalized;
    }
};
