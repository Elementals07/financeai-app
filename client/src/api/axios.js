/**
 * Standalone Local API Adapter
 * 100% on-device routing using Dexie (IndexedDB) and direct Gemini REST.
 * ZERO server or localhost:5000 dependency.
 */
import { localExpenseService } from '../services/localExpenseService';
import { localGeminiService } from '../services/localGeminiService';
import { initLocalDatabase } from '../services/localDatabase';

// Auto-initialize on module load
initLocalDatabase().catch(err => console.error('[LOCAL API] DB Init failed:', err));

const API = {
    // Interceptor compatibility mocks
    interceptors: {
        request: { use: () => {} },
        response: { use: () => {} }
    },

    async get(url, config = {}) {
        const cleanUrl = url.split('?')[0].replace(/^\/api/, '');
        const params = config.params || {};

        // Parse query params from URL if present
        if (url.includes('?')) {
            const search = url.split('?')[1];
            const parsed = new URLSearchParams(search);
            for (const [k, v] of parsed.entries()) {
                params[k] = v;
            }
        }

        // 1. Auth Me
        if (cleanUrl === '/auth/me') {
            const user = await localExpenseService.getCurrentUser();
            return { data: { success: true, data: user } };
        }

        // 2. Expenses Summary
        if (cleanUrl === '/expenses/summary') {
            const month = params.month || new Date().toISOString().slice(0, 7);
            const summary = await localExpenseService.getMonthlySummary(month);
            const trends = await localExpenseService.getMonthlyTrend(60);
            const daily = await localExpenseService.getDailySpending(month);
            return {
                data: {
                    success: true,
                    data: {
                        month,
                        ...summary,
                        trends,
                        dailySpending: daily
                    }
                }
            };
        }

        // 3. Expenses Savings
        if (cleanUrl === '/expenses/savings') {
            const history = await localExpenseService.getSavingsHistory();
            return { data: { success: true, data: history } };
        }

        // 4. Expenses List
        if (cleanUrl === '/expenses') {
            const result = await localExpenseService.list(params);
            return {
                data: {
                    success: true,
                    data: result.data,
                    pagination: result.pagination
                }
            };
        }

        // 5. Budgets
        if (cleanUrl === '/budgets') {
            const month = params.month || new Date().toISOString().slice(0, 7);
            const budgetData = await localExpenseService.getBudget(month);
            return { data: { success: true, data: budgetData } };
        }

        // 6. Categories
        if (cleanUrl === '/categories') {
            const cats = await localExpenseService.getCategories();
            return { data: { success: true, data: cats } };
        }

        throw new Error(`[LOCAL API] Unhandled GET route: ${cleanUrl}`);
    },

    async post(url, body = {}) {
        const cleanUrl = url.replace(/^\/api/, '');

        // 1. Auth Login
        if (cleanUrl === '/auth/login') {
            const res = await localExpenseService.login(body.email, body.password);
            return { data: { success: true, data: res } };
        }

        // 2. Auth Register
        if (cleanUrl === '/auth/register') {
            const res = await localExpenseService.register(body.name, body.email, body.password);
            return { data: { success: true, data: res } };
        }

        // 3. Expenses Single
        if (cleanUrl === '/expenses') {
            const txn = await localExpenseService.create(body);
            return {
                data: {
                    success: true,
                    message: 'Expense added successfully',
                    data: txn
                }
            };
        }

        // 4. Expenses Batch
        if (cleanUrl === '/expenses/batch') {
            const created = await localExpenseService.createBatch(body.items || []);
            return {
                data: {
                    success: true,
                    message: `${created.length} expense(s) recorded successfully`,
                    data: created
                }
            };
        }

        // 5. Budgets Set
        if (cleanUrl === '/budgets') {
            const updated = await localExpenseService.setBudget(body.allocations, body.month);
            return {
                data: {
                    success: true,
                    message: 'Budget set successfully',
                    data: updated
                }
            };
        }

        // 6. Categories Create
        if (cleanUrl === '/categories') {
            const newCat = await localExpenseService.createCategory(body.name, body.color);
            return { data: { success: true, data: newCat } };
        }

        // 7. AI Analyze
        if (cleanUrl === '/ai/analyze') {
            const res = await localGeminiService.generateAnalysis(body.month, body.refresh);
            return { data: { success: true, data: res } };
        }

        // 8. AI Chat
        if (cleanUrl === '/ai/chat') {
            const res = await localGeminiService.chat(body.message, body.month, body.timeframe);
            return { data: { success: true, data: res } };
        }

        // 9. AI Scan Bill
        if (cleanUrl === '/ai/scan-bill') {
            const res = await localGeminiService.scanReceiptImage(body.image, body.mimeType);
            return {
                data: {
                    success: true,
                    message: 'Receipt scanned successfully',
                    data: res
                }
            };
        }

        throw new Error(`[LOCAL API] Unhandled POST route: ${cleanUrl}`);
    },

    async put(url, body = {}) {
        const cleanUrl = url.replace(/^\/api/, '');

        // 1. Auth Profile
        if (cleanUrl === '/auth/profile') {
            const updated = await localExpenseService.updateUserProfile(body);
            return { data: { success: true, data: updated } };
        }

        // 2. Expenses Update (/expenses/:id)
        const expMatch = cleanUrl.match(/^\/expenses\/(\d+)$/);
        if (expMatch) {
            const id = expMatch[1];
            const updated = await localExpenseService.update(id, body);
            return {
                data: {
                    success: true,
                    message: 'Expense updated successfully',
                    data: updated
                }
            };
        }

        // 3. Categories Update (/categories/:id)
        const catMatch = cleanUrl.match(/^\/categories\/(\d+)$/);
        if (catMatch) {
            const id = catMatch[1];
            const updated = await localExpenseService.updateCategory(id, body.color);
            return {
                data: {
                    success: true,
                    message: 'Category updated',
                    data: updated
                }
            };
        }

        throw new Error(`[LOCAL API] Unhandled PUT route: ${cleanUrl}`);
    },

    async delete(url) {
        const cleanUrl = url.replace(/^\/api/, '');

        // 1. Expenses Delete (/expenses/:id)
        const expMatch = cleanUrl.match(/^\/expenses\/(\d+)$/);
        if (expMatch) {
            const id = expMatch[1];
            await localExpenseService.delete(id);
            return {
                data: {
                    success: true,
                    message: 'Expense deleted successfully'
                }
            };
        }

        // 2. Categories Delete (/categories/:id)
        const catMatch = cleanUrl.match(/^\/categories\/(\d+)$/);
        if (catMatch) {
            const id = catMatch[1];
            await localExpenseService.deleteCategory(id);
            return {
                data: {
                    success: true,
                    message: 'Category deleted'
                }
            };
        }

        throw new Error(`[LOCAL API] Unhandled DELETE route: ${cleanUrl}`);
    }
};

export default API;
