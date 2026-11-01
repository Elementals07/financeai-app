import { db } from './localDatabase';
import { localExpenseService } from './localExpenseService';

const GEMINI_KEYS = [
    'AIzaSyCpTs5tDW9xJgW-KAAg0iIutsLw6YXPZsw',
    'AIzaSyBCIDws6m0CC0Ey3HqobrYDeVZ2u-K9NQI',
    'AIzaSyAExUoLgMbP6zEwrgJdl-kh7Osm9CrJM7s',
    'AIzaSyAxl0GhonVF0N6e0odng4_fgVhzUXhAW2U',
    'AIzaSyD6I_qmvZ8OJuGAbgkR2jtTNHATsZGR6Wo'
];

let activeKeyIndex = 0;

function getActiveKey() {
    return GEMINI_KEYS[activeKeyIndex];
}

function rotateKey() {
    activeKeyIndex = (activeKeyIndex + 1) % GEMINI_KEYS.length;
    console.log(`[GEMINI ROTATION] Switched to key #${activeKeyIndex + 1}`);
    return activeKeyIndex;
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
 * Direct HTTP caller for Gemini with multi-key rotation and retries
 */
async function callGeminiDirect(payload, maxRetries = 4) {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const key = getActiveKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.status === 429 || res.status === 500 || res.status === 503) {
                console.warn(`[GEMINI API] Key #${activeKeyIndex + 1} returned status ${res.status}. Rotating...`);
                rotateKey();
                continue;
            }

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
            }

            const data = await res.json();
            return data;
        } catch (err) {
            lastError = err;
            console.error(`[GEMINI API] Error with key #${activeKeyIndex + 1}:`, err.message);
            rotateKey();
            const waitMs = (attempt + 1) * 1000;
            await new Promise(r => setTimeout(r, waitMs));
        }
    }

    throw new Error(`Gemini request failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Network error'}`);
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

        const result = await callGeminiDirect(payload);
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
        const user = await localExpenseService.getCurrentUser();
        const dataRange = await localExpenseService.getDataRange();

        const [monthlySummary, budgetData] = await Promise.all([
            localExpenseService.getMonthlySummary(targetMonth),
            localExpenseService.getBudget(targetMonth)
        ]);

        const orientationContext = `[ORIENTATION] User record spans ${dataRange.earliestMonth} to ${dataRange.latestMonth} (${dataRange.totalTransactions} transactions across categories: ${dataRange.categories}). Current viewed month: ${targetMonth}. Monthly income: ₹${fmt(budgetData.budgetAmount)}. Total spent in ${targetMonth}: ₹${fmt(monthlySummary.totalSpending)}.`;

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
            const response = await callGeminiDirect(payload);
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
        const cleanBase64 = base64Image.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
        const categories = await localExpenseService.getCategories();
        const validCategories = categories.map(c => c.name).join(', ') || 'Food, Travel, Rent, Entertainment, Shopping, Utilities, Health, Education, Others';

        const prompt = `You are an expert OCR receipt parsing engine for an Indian personal finance app.
Extract and output a valid JSON object with the following fields:
1. "merchant": The name of the store, vendor, shop, hospital, or company (e.g. "D-Mart", "Apollo Pharmacy", "Swiggy", "Indian Oil", "More Supermarket"). If unknown, use "Local Store".
2. "totalAmount": The final total amount paid in Rupees as a number (e.g. 1450.50). Do not include currency symbols.
3. "billDate": The date printed on the bill in exact "YYYY-MM-DD" format.
   - If the year is 2 digits (e.g. 26 or 25), convert to 4 digits (e.g. 2026).
   - If the date is missing, blurry, or cannot be determined with certainty, set "billDate" to null.
4. "dateDetected": true if a date was found on the bill, false if null.
5. "primaryCategory": The single best category matching one of: [${validCategories}].
6. "summary": A brief 1-sentence description of what this bill is for (e.g. "Weekly groceries at D-Mart").
7. "items": An array of individual line items if clearly listed on the bill. For each item:
   - "name": Item description (e.g. "Sunflower Oil 1L")
   - "amount": Price in Rupees (number)
   - "category": Best category from [${validCategories}]
   If line items are not distinguishable, return an empty array [].

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
                temperature: 0.2,
                responseMimeType: 'application/json'
            }
        };

        const result = await callGeminiDirect(payload);
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

        let parsed = {};
        try {
            parsed = JSON.parse(text);
        } catch {
            const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        const totalAmount = parseFloat(parsed.totalAmount) || 0;
        let billDate = parsed.billDate;
        if (billDate && !/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
            billDate = null;
        }

        return {
            merchant: parsed.merchant || 'Local Store',
            totalAmount,
            billDate,
            dateDetected: Boolean(billDate),
            primaryCategory: parsed.primaryCategory || 'Others',
            summary: parsed.summary || '',
            items: Array.isArray(parsed.items) ? parsed.items : []
        };
    }
};
