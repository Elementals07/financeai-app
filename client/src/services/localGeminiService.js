import { db } from './localDatabase.js';
import { localExpenseService } from './localExpenseService.js';
import { logAiEvent } from './aiLogger.js';
import {
    dateToLocalYmd,
    isExcludedSmsBody,
    maskSender,
    normalizeReceiptResult,
    normalizeSmsParse,
    redactSmsBody
} from './financeParsers.js';
import {
    GEMINI_CONFIG,
    callGeminiDirect,
    extractGeminiResponseText,
    geminiTestHooks,
    isVisionCapableModel,
    parseJsonSafely,
    sanitizeGeminiErrorMessage
} from './ai/geminiProvider.js';
import { AI_CACHE_VERSION, AI_PROVIDERS } from './ai/aiConfig.js';
import { getProviderCacheParams, requireActiveProvider } from './ai/providerRegistry.js';

/**
 * Local AI facade.
 *
 * Financial context is computed entirely on-device; only the minimum context
 * needed for an answer is sent to the user's selected provider. Both Velona
 * and Google Gemini are supported through `services/ai/providerRegistry.js`,
 * and every cache entry is scoped by provider + model so results can never be
 * reused across providers.
 */

// Re-exported for backward compatibility: tests and existing callers import
// these from this module.
export {
    GEMINI_CONFIG,
    callGeminiDirect,
    extractGeminiResponseText,
    geminiTestHooks,
    isVisionCapableModel
};

const SUPPORTED_RECEIPT_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
]);
const MAX_RECEIPT_IMAGE_BYTES = 8 * 1024 * 1024;
const RECEIPT_CACHE_TYPE = 'receipt_scan';
const SMS_CACHE_TYPE = 'sms_parse';
const ANALYSIS_CACHE_TYPE = 'analysis';
const ANALYSIS_PROMPT_VERSION = 2;
// Bumped to match the latest web receipt prompt (15-item cap + truncation
// handling), which intentionally invalidates older receipt cache entries.
const RECEIPT_PROMPT_VERSION = 3;
const SMS_PROMPT_VERSION = 2;
const ANALYSIS_CACHE_TTL_MS = 24 * 3600 * 1000;
const SMS_CHUNK_SIZE = 15;
const SMS_MAX_MESSAGES = 60;

const inFlightAiRequests = new Map();

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

function sanitizeErrorMessage(message) {
    return sanitizeGeminiErrorMessage(message);
}

function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    return `{${Object.keys(value).sort().map(key => (
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
}

async function sha256Hex(value) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Secure hashing is not available in this environment.');
    }
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(
        new Uint8Array(digest),
        byte => byte.toString(16).padStart(2, '0')
    ).join('');
}

function base64ToBytes(base64) {
    if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    const BufferCtor = globalThis.Buffer;
    if (typeof BufferCtor === 'function') {
        const buffer = BufferCtor.from(base64, 'base64');
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    throw new Error('No base64 decoder available.');
}

async function buildAiCacheKey(type, userId, contentHash, params) {
    const paramsHash = await sha256Hex(stableStringify({
        version: AI_CACHE_VERSION,
        type,
        userId,
        params
    }));
    return `ai_${type}_v${AI_CACHE_VERSION}_u${userId}_${contentHash}_${paramsHash}`;
}

async function readAiCache(cacheKey, type) {
    try {
        const row = await db.ai_insights_cache.get(cacheKey);
        if (!row || row.cache_version !== AI_CACHE_VERSION || row.type !== type) {
            return null;
        }
        return row.response ?? null;
    } catch (error) {
        logAiEvent('ai-cache.read-failed', {
            type,
            reason: sanitizeErrorMessage(error.message)
        });
        return null;
    }
}

async function writeAiCache({ cacheKey, type, userId, contentHash, params, response, expiresAt = null }) {
    try {
        await db.ai_insights_cache.put({
            id: cacheKey,
            user_id: userId,
            type,
            prompt_hash: contentHash,
            response,
            cache_version: AI_CACHE_VERSION,
            cache_params: params,
            created_at: new Date().toISOString(),
            expires_at: expiresAt
        });
        logAiEvent('ai-cache.write', {
            type,
            version: AI_CACHE_VERSION,
            provider: params?.provider
        });
    } catch (error) {
        logAiEvent('ai-cache.write-failed', {
            type,
            reason: sanitizeErrorMessage(error.message)
        });
    }
}

async function runDeduped(key, task) {
    if (!key) return task();
    if (inFlightAiRequests.has(key)) {
        logAiEvent('ai-cache.in-flight', { key });
        return inFlightAiRequests.get(key);
    }

    const promise = Promise.resolve().then(task);
    const tracked = promise.finally(() => {
        if (inFlightAiRequests.get(key) === tracked) {
            inFlightAiRequests.delete(key);
        }
    });
    inFlightAiRequests.set(key, tracked);
    return tracked;
}

function normalizeSmsCacheContent(messages) {
    return messages.map(message => ({
        id: String(message?.id ?? ''),
        address: String(message?.address ?? message?.from ?? '').trim().toLowerCase(),
        body: String(message?.body ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
        date: message?.date ?? null
    })).sort((left, right) => (
        left.id.localeCompare(right.id)
        || left.body.localeCompare(right.body)
    ));
}

function decodeReceiptImage(input, mimeType) {
    let raw = String(input || '').trim();
    let declaredType = '';

    if (/^data:/i.test(raw)) {
        const commaIndex = raw.indexOf(',');
        if (commaIndex !== -1) {
            const header = raw.slice(5, commaIndex);
            if (/;base64$/i.test(header.trim())) {
                declaredType = header.split(';')[0];
                raw = raw.slice(commaIndex + 1);
            }
        }
    }

    raw = raw.replace(/\s+/g, '');
    let type = String(declaredType || mimeType || 'image/jpeg')
        .split(';')[0]
        .trim()
        .toLowerCase();
    if (type === 'image/jpg') type = 'image/jpeg';

    if (!SUPPORTED_RECEIPT_MIME_TYPES.has(type)) {
        throw new Error(
            'Unsupported image type. Please use a JPEG, PNG, WebP, HEIC or HEIF photo of the receipt.'
        );
    }
    if (!raw) {
        throw new Error('No image data was selected. Please retake or choose the receipt photo again.');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.replace(/=+$/, '').length % 4 === 1) {
        throw new Error('The selected image data is invalid. Please retake or choose the receipt photo again.');
    }

    const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
    const bytes = Math.floor((raw.length * 3) / 4) - padding;
    if (bytes <= 0) {
        throw new Error('The selected image is empty. Please retake or choose the receipt photo again.');
    }
    if (bytes > MAX_RECEIPT_IMAGE_BYTES) {
        throw new Error('The receipt image is too large. Please use an image smaller than 8 MB.');
    }

    const signatures = {
        'image/jpeg': '/9j/',
        'image/png': 'iVBOR',
        'image/webp': 'UklGR'
    };
    const signature = signatures[type];
    if (signature && !raw.startsWith(signature)) {
        throw new Error(
            'The selected file does not match its image type. Please retake or choose the receipt photo again.'
        );
    }

    return { data: raw, mimeType: type, bytes };
}

function providerLabel(context) {
    return context?.label || 'The AI provider';
}

function receiptPrompt(validCategories) {
    return `Analyze this receipt image. Return ONLY valid JSON matching this exact schema:
{
  "merchant": "Store or vendor name (if unclear, use \\"Local Store\\")",
  "billDate": "YYYY-MM-DD or null if not visible",
  "dateDetected": true,
  "totalAmount": 0,
  "items": [{ "name": "Item description", "amount": 0, "category": "Category" }],
  "summary": "One sentence summary of the purchase",
  "warnings": ["Any issues or unclear items"]
}
Categorize each item using one of: [${validCategories}].
Rules:
- Include at most 15 most significant line items. Omit trivial or unreadable items.
- Preserve the printed total amount; never invent or estimate it.
- Preserve duplicate product descriptions if listed separately.
- All amounts must be numbers. Dates must be YYYY-MM-DD.
- Return raw JSON only without markdown code fences.`;
}

function smsPrompt(smsData, validCategories) {
    return `You are a strict financial NLP parser for Indian banking and UPI messages.
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
}

export const localGeminiService = {
    /**
     * Compute on-device financial context and request a diagnosis from the
     * active provider.
     */
    async generateAnalysis(month = null, refresh = false, timeframe = 'month') {
        const context = requireActiveProvider();
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const user = await localExpenseService.getCurrentUser();
        const userId = user?.id ?? 1;
        const monthlyIncome = user ? parseFloat(user.monthly_income) || 65000 : 65000;

        const [monthlySummary, categoryBaseline, microLeakage, budgetData] = await Promise.all([
            localExpenseService.getMonthlySummary(targetMonth),
            localExpenseService.getCategoryBaseline(targetMonth, 3),
            localExpenseService.getMicroLeakage(targetMonth, 300, 4),
            localExpenseService.getBudget(targetMonth)
        ]);

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

        const cacheParams = {
            ...getProviderCacheParams(context),
            promptVersion: ANALYSIS_PROMPT_VERSION,
            month: targetMonth,
            timeframe
        };

        let cacheKey = null;
        let contentHash = null;
        try {
            contentHash = await sha256Hex(`${targetMonth}|${timeframe}|v${ANALYSIS_PROMPT_VERSION}`);
            cacheKey = await buildAiCacheKey(ANALYSIS_CACHE_TYPE, userId, contentHash, cacheParams);
        } catch (error) {
            logAiEvent('ai-cache.unavailable', {
                type: ANALYSIS_CACHE_TYPE,
                reason: sanitizeErrorMessage(error.message)
            });
        }

        if (!refresh && cacheKey) {
            try {
                const cached = await db.ai_insights_cache.get(cacheKey);
                if (cached
                    && cached.cache_version === AI_CACHE_VERSION
                    && cached.type === ANALYSIS_CACHE_TYPE
                    && cached.expires_at
                    && new Date(cached.expires_at) > new Date()) {
                    logAiEvent('feature.analysis-cache-hit', {
                        month: targetMonth,
                        provider: context.provider
                    });
                    return {
                        analysis: cached.response,
                        cached: true,
                        summary,
                        healthSignal,
                        provider: context.provider,
                        generatedAt: cached.created_at
                    };
                }
            } catch (error) {
                logAiEvent('ai-cache.read-failed', {
                    type: ANALYSIS_CACHE_TYPE,
                    reason: sanitizeErrorMessage(error.message)
                });
            }
        }

        const contextLines = [
            `[SNAPSHOT] ${targetMonth} | Income: ₹${fmt(monthlyIncome)} | Spent: ₹${fmt(monthlySummary.totalSpending)} | Savings Rate: ${savingsRate}% | Status: ${healthSignal.toUpperCase()}`,
            `[TOP CATEGORIES] ` + monthlySummary.categoryBreakdown.slice(0, 5).map(c => `${c.category}: ₹${fmt(c.total)} (${c.count} txns)`).join(' | '),
            `[ANOMALIES & SPIKES] ` + (deltaMatrix.filter(d => d.flag === 'major_spike' || d.flag === 'spike').map(d => `${d.category}: ₹${fmt(d.current)} (+${d.changePercent}% vs ₹${fmt(d.baseline)} baseline)`).join('; ') || 'None'),
            `[MICRO-LEAKAGE] ` + (microLeakage.map(m => `${m.category}: ${m.frequency} small transactions totaling ₹${fmt(m.total)}`).join('; ') || 'None')
        ];

        const promptText = `${contextLines.join('\n')}\n\nBased on the above financial data, provide a structured, scannable personal financial advisor analysis. Identify biggest anomalies, give a clear breakdown, and prescribe 2-3 concrete numbered solutions with exact numbers. Do not use generic filler.`;

        logAiEvent('feature.analysis', {
            month: targetMonth,
            refresh: Boolean(refresh),
            provider: context.provider
        });

        const analysisText = await context.adapter.completeText({
            systemPrompt: ANALYSIS_SYSTEM_PROMPT,
            userPrompt: promptText,
            feature: 'analysis',
            temperature: 0.7,
            maxOutputTokens: 4096
        }) || 'No response generated';

        logAiEvent('feature.analysis-complete', {
            month: targetMonth,
            chars: analysisText.length,
            provider: context.provider
        });

        if (cacheKey) {
            await writeAiCache({
                cacheKey,
                type: ANALYSIS_CACHE_TYPE,
                userId,
                contentHash,
                params: cacheParams,
                response: analysisText,
                expiresAt: new Date(Date.now() + ANALYSIS_CACHE_TTL_MS).toISOString()
            });
        }

        return {
            analysis: analysisText,
            cached: false,
            summary,
            healthSignal,
            provider: context.provider,
            generatedAt: new Date().toISOString()
        };
    },

    /**
     * Contextual multi-turn chat assistant with local tool calling.
     */
    async chat(userMessage, month = null, timeframe = 'All', conversationHistory = []) {
        const context = requireActiveProvider();
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const dataRange = await localExpenseService.getDataRange();

        const [monthlySummary, budgetData] = await Promise.all([
            localExpenseService.getMonthlySummary(targetMonth),
            localExpenseService.getBudget(targetMonth)
        ]);

        const orientationContext = `[ORIENTATION] User record spans ${dataRange.earliestMonth} to ${dataRange.latestMonth} (${dataRange.totalTransactions} transactions across categories: ${dataRange.categories}). Current viewed month: ${targetMonth}. Requested timeframe filter: ${timeframe}. Monthly income: ₹${fmt(budgetData.budgetAmount)}. Total spent in ${targetMonth}: ₹${fmt(monthlySummary.totalSpending)}.`;

        logAiEvent('feature.chat', {
            timeframe,
            chars: String(userMessage || '').length,
            provider: context.provider,
            historyTurns: Array.isArray(conversationHistory) ? conversationHistory.length : 0
        });

        const reply = await context.adapter.completeWithTools({
            systemPrompt: CHAT_SYSTEM_PROMPT,
            userPrompt: `${orientationContext}\n\n[USER QUESTION]\n${userMessage}`,
            feature: 'chat',
            declarations: TOOL_DEFINITIONS,
            executeTool: executeLocalTool,
            maxTurns: 5,
            conversationHistory,
            temperature: 0.6,
            maxOutputTokens: 2048
        });

        return {
            reply: reply || 'I checked your accounts, but could not produce a response.',
            cached: false,
            provider: context.provider,
            generatedAt: new Date().toISOString()
        };
    },

    /**
     * Receipt image OCR/parsing via the active provider's vision support.
     */
    async scanReceiptImage(base64Image, mimeType = 'image/jpeg', options = {}) {
        const forceRefresh = Boolean(options.refresh);
        const image = decodeReceiptImage(base64Image, mimeType);
        const context = requireActiveProvider();
        const user = await localExpenseService.getCurrentUser();
        const userId = user?.id ?? 1;
        const categories = await localExpenseService.getCategories();
        const categoryNames = categories.map(c => c.name);
        const validCategories = categoryNames.join(', ') || 'Food, Travel, Rent, Entertainment, Shopping, Utilities, Health, Education, Others';

        const cacheParams = {
            ...getProviderCacheParams(context),
            promptVersion: RECEIPT_PROMPT_VERSION,
            mimeType: image.mimeType,
            categories: categoryNames
        };

        let cacheKey = null;
        let contentHash = null;
        try {
            contentHash = await sha256Hex(base64ToBytes(image.data));
            cacheKey = await buildAiCacheKey(RECEIPT_CACHE_TYPE, userId, contentHash, cacheParams);
        } catch (error) {
            logAiEvent('ai-cache.unavailable', {
                type: RECEIPT_CACHE_TYPE,
                reason: sanitizeErrorMessage(error.message)
            });
        }

        if (!forceRefresh && cacheKey) {
            const cached = await readAiCache(cacheKey, RECEIPT_CACHE_TYPE);
            if (cached) {
                logAiEvent('feature.receipt-cache-hit', {
                    mimeType: image.mimeType,
                    provider: context.provider,
                    version: AI_CACHE_VERSION
                });
                return cached;
            }
        }

        const executeScan = async () => {
            const prompt = receiptPrompt(validCategories);
            const contents = [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                data: image.data,
                                mimeType: image.mimeType
                            }
                        },
                        { text: prompt }
                    ]
                }
            ];

            logAiEvent('feature.receipt-scan', {
                mimeType: image.mimeType,
                bytes: image.bytes,
                provider: context.provider
            });

            const text = (await context.adapter.completeJson({
                contents,
                feature: 'scan-receipt',
                temperature: 0.1,
                // 8,192 is used only for Velona; Gemini keeps its existing
                // generation config. Both adapters detect truncation.
                maxOutputTokens: context.provider === AI_PROVIDERS.VELONA ? 8192 : undefined,
                requireVision: true,
                parse: null
            })).trim();

            if (!text) {
                logAiEvent('feature.receipt-scan-failed', {
                    reason: 'empty-response',
                    provider: context.provider
                });
                throw new Error(
                    `${providerLabel(context)} did not return any readable receipt data. Please retake the photo or enter the details manually.`
                );
            }

            const parsed = parseJsonSafely(text, null);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                logAiEvent('feature.receipt-scan-failed', {
                    reason: 'malformed-response',
                    provider: context.provider
                });
                throw new Error(
                    `${providerLabel(context)} returned an unreadable receipt response. Please retake the photo or enter the details manually.`
                );
            }

            const normalized = normalizeReceiptResult(parsed, categoryNames);

            if (Array.isArray(parsed.warnings)) {
                const seenWarnings = new Set(
                    normalized.warnings.map(warning => warning.toLowerCase())
                );
                for (const warning of parsed.warnings) {
                    if (typeof warning !== 'string' || !warning.trim()) continue;
                    const cleaned = warning.trim();
                    if (seenWarnings.has(cleaned.toLowerCase())) continue;
                    seenWarnings.add(cleaned.toLowerCase());
                    normalized.warnings.push(cleaned);
                }
            }

            if (normalized.totalAmount <= 0 && normalized.items.length === 0) {
                logAiEvent('feature.receipt-scan-failed', {
                    reason: 'no-usable-data',
                    provider: context.provider,
                    warnings: normalized.warnings.length
                });
                throw new Error(
                    `${providerLabel(context)} could not read a usable total or line items from this image. Retake the photo with the total clearly visible, or enter the details manually.`
                );
            }

            if (cacheKey) {
                await writeAiCache({
                    cacheKey,
                    type: RECEIPT_CACHE_TYPE,
                    userId,
                    contentHash,
                    params: cacheParams,
                    response: normalized
                });
            }

            logAiEvent('feature.receipt-scan-complete', {
                items: normalized.items.length,
                hasTotal: normalized.totalAmount > 0,
                hasDate: Boolean(normalized.billDate),
                warnings: normalized.warnings.length,
                refreshed: forceRefresh,
                provider: context.provider
            });

            return normalized;
        };

        const dedupeKey = cacheKey
            ? `${cacheKey}:${forceRefresh ? 'refresh' : 'normal'}`
            : null;
        return runDeduped(dedupeKey, executeScan);
    },

    /**
     * Parses a batch of transactional bank/UPI SMS messages into structured
     * expenses. Strong non-transaction messages are filtered on-device first.
     */
    async parseBankSms(messages = [], options = {}) {
        if (!Array.isArray(messages) || messages.length === 0) return [];

        const forceRefresh = Boolean(options.refresh);
        const context = requireActiveProvider();
        const user = await localExpenseService.getCurrentUser();
        const userId = user?.id ?? 1;
        const categories = await localExpenseService.getCategories();
        const categoryNames = categories.map(c => c.name);
        const validCategories = categoryNames.join(', ') || 'Food, Travel, Rent, Entertainment, Shopping, Utilities, Health, Education, Others';

        const candidates = messages
            .filter(message => message && message.body && !isExcludedSmsBody(message.body))
            .slice(0, SMS_MAX_MESSAGES);

        if (candidates.length === 0) return [];

        const cacheParams = {
            ...getProviderCacheParams(context),
            promptVersion: SMS_PROMPT_VERSION,
            categories: categoryNames,
            chunkSize: SMS_CHUNK_SIZE
        };

        let cacheKey = null;
        let contentHash = null;
        try {
            contentHash = await sha256Hex(stableStringify(
                normalizeSmsCacheContent(candidates)
            ));
            cacheKey = await buildAiCacheKey(SMS_CACHE_TYPE, userId, contentHash, cacheParams);
        } catch (error) {
            logAiEvent('ai-cache.unavailable', {
                type: SMS_CACHE_TYPE,
                reason: sanitizeErrorMessage(error.message)
            });
        }

        if (!forceRefresh && cacheKey) {
            const cached = await readAiCache(cacheKey, SMS_CACHE_TYPE);
            if (Array.isArray(cached)) {
                logAiEvent('feature.sms-cache-hit', {
                    messages: candidates.length,
                    transactions: cached.length,
                    provider: context.provider,
                    version: AI_CACHE_VERSION
                });
                return cached;
            }
        }

        const executeParse = async () => {
            logAiEvent('feature.sms-parse', {
                messages: candidates.length,
                refreshed: forceRefresh,
                provider: context.provider
            });

            const normalized = [];

            for (let index = 0; index < candidates.length; index += SMS_CHUNK_SIZE) {
                const chunk = candidates.slice(index, index + SMS_CHUNK_SIZE);
                const smsData = chunk.map(message => ({
                    id: String(message.id),
                    from: maskSender(message.address),
                    body: redactSmsBody(message.body).slice(0, 300),
                    approxDate: dateToLocalYmd(message.date)
                }));

                const contents = [
                    {
                        role: 'user',
                        parts: [{ text: smsPrompt(smsData, validCategories) }]
                    }
                ];

                const text = (await context.adapter.completeJson({
                    contents,
                    feature: 'parse-sms',
                    temperature: 0.1,
                    // Velona gets an explicit cap; Gemini keeps its existing
                    // config so mobile behaviour is unchanged.
                    maxOutputTokens: context.provider === AI_PROVIDERS.VELONA ? 4096 : undefined,
                    parse: null
                })).trim();

                const parsed = parseJsonSafely(text, null);
                if (!Array.isArray(parsed)) {
                    logAiEvent('feature.sms-parse-failed', {
                        reason: text ? 'malformed-response' : 'empty-response',
                        provider: context.provider
                    });
                    throw new Error(
                        `${providerLabel(context)} returned an unreadable SMS response. Please try again.`
                    );
                }
                normalized.push(...normalizeSmsParse(parsed, chunk, categoryNames));
            }

            if (cacheKey) {
                await writeAiCache({
                    cacheKey,
                    type: SMS_CACHE_TYPE,
                    userId,
                    contentHash,
                    params: cacheParams,
                    response: normalized
                });
            }

            logAiEvent('feature.sms-parse-complete', {
                messages: candidates.length,
                transactions: normalized.length,
                refreshed: forceRefresh,
                provider: context.provider
            });

            return normalized;
        };

        const dedupeKey = cacheKey
            ? `${cacheKey}:${forceRefresh ? 'refresh' : 'normal'}`
            : null;
        return runDeduped(dedupeKey, executeParse);
    }
};
