import { db } from './localDatabase';
import { localExpenseService } from './localExpenseService';
import {
    dateToLocalYmd,
    isExcludedSmsBody,
    maskSender,
    normalizeReceiptResult,
    normalizeSmsParse,
    redactSmsBody
} from './financeParsers';

const DEFAULT_AI_API_URL = 'http://localhost:5000/api/ai';
const AI_REQUEST_TIMEOUT_MS = 120000;

function getAiApiUrl() {
    const configured = typeof import.meta !== 'undefined' && import.meta.env
        ? String(import.meta.env.VITE_AI_API_URL || '').trim()
        : '';
    return (configured || DEFAULT_AI_API_URL).replace(/\/+$/, '');
}

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
 * Sends a Gemini-shaped payload to the FinanceAI AI proxy. Gemini keys and
 * key rotation stay on the server; the app never sees or stores them.
 */
async function callGeminiProxy(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    try {
        let res;

        try {
            res = await fetch(`${getAiApiUrl()}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('The AI request timed out. Please try again.');
            }
            throw new Error(
                'The AI backend is unreachable. Start the FinanceAI AI server or set VITE_AI_API_URL.'
            );
        }

        if (!res.ok) {
            let message = 'The AI service is temporarily unavailable. Please try again in a moment.';
            try {
                const data = await res.json();
                if (data?.message) message = data.message;
            } catch {
                // Keep the generic message when the proxy does not return JSON.
            }
            throw new Error(message);
        }

        return await res.json();
    } finally {
        clearTimeout(timeout);
    }
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

        const result = await callGeminiProxy(payload);
        const analysisText = result?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

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

        // Multi-turn tool execution loop (max 3 turns)
        for (let turn = 0; turn < 3; turn++) {
            const response = await callGeminiProxy(payload);
            const candidate = response?.candidates?.[0];
            const content = candidate?.content;

            if (!content) break;

            const functionCalls = content.parts?.filter(p => p.functionCall);

            if (!functionCalls || functionCalls.length === 0) {
                const replyText = content.parts?.find(p => p.text)?.text || 'I checked your accounts, but could not produce a response.';
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

        const result = await callGeminiProxy(payload);
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
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

            const res = await callGeminiProxy({
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

            const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
            const parsed = parseJsonSafely(text, []);
            normalized.push(...normalizeSmsParse(parsed, chunk, categoryNames));
        }

        return normalized;
    }
};
