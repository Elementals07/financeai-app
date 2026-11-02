import { db, initLocalDatabase } from './localDatabase';
import { buildCategoryBudgetBreakdown, computeBudgetStatus } from './financeParsers';

/**
 * Local Expense Service
 * 100% on-device calculations and Dexie (IndexedDB) persistence
 * Eliminates all need for an external backend or Node.js server.
 */

// Helper to get active user ID (defaults to 1)
async function getUserId() {
    let user = await db.user_profile.toCollection().first();
    if (!user) {
        user = await initLocalDatabase();
    }
    return user ? user.id : 1;
}

export const localExpenseService = {
    // ─── USER & AUTH ──────────────────────────────────────────────────────────
    async getCurrentUser() {
        await initLocalDatabase();
        return await db.user_profile.toCollection().first();
    },

    async login(email) {
        await initLocalDatabase();
        let user = await db.user_profile.where('email').equalsIgnoreCase(email).first();
        if (!user) {
            // In standalone mobile, if not found, create profile seamlessly
            user = {
                name: email.split('@')[0] || 'Elementals',
                email,
                monthly_income: 65000,
                created_at: new Date().toISOString()
            };
            user.id = await db.user_profile.add(user);
        }
        return { token: 'standalone_token_' + user.id, user };
    },

    async register(name, email) {
        await initLocalDatabase();
        let user = await db.user_profile.where('email').equalsIgnoreCase(email).first();
        if (user) {
            user.name = name;
            await db.user_profile.put(user);
        } else {
            user = {
                name,
                email,
                monthly_income: 65000,
                created_at: new Date().toISOString()
            };
            user.id = await db.user_profile.add(user);
        }
        return { token: 'standalone_token_' + user.id, user };
    },

    async updateUserProfile(updates) {
        const userId = await getUserId();
        const user = await db.user_profile.get(userId);
        if (user) {
            const next = { ...user, ...updates };
            if (updates.monthly_income !== undefined) {
                next.monthly_income = parseFloat(updates.monthly_income) || 0;
            }
            await db.user_profile.put(next);
            return next;
        }
        return null;
    },

    // ─── EXPENSES CRUD ────────────────────────────────────────────────────────
    async list({ month, category, startDate, endDate, page = 1, limit = 25 }) {
        const userId = await getUserId();
        let collection = db.transactions.where('user_id').equals(userId);

        let items = await collection.toArray();

        // Apply filters in memory for full query flexibility
        if (month) {
            items = items.filter(t => t.date && t.date.startsWith(month));
        }
        if (category) {
            items = items.filter(t => t.category === category);
        }
        if (startDate) {
            items = items.filter(t => t.date >= startDate);
        }
        if (endDate) {
            items = items.filter(t => t.date <= endDate);
        }

        // Sort descending by date, then created_at
        items.sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return (b.created_at || '').localeCompare(a.created_at || '');
        });

        const totalCount = items.length;
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 25;
        const offset = (pageNum - 1) * limitNum;
        const paginated = items.slice(offset, offset + limitNum);

        return {
            data: paginated,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalCount,
                count: paginated.length
            }
        };
    },

    async create({ amount, category, description, date, receipt_fingerprint }) {
        const userId = await getUserId();
        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            throw new Error('Expense amount must be greater than zero');
        }
        if (!category) {
            throw new Error('Expense category is required');
        }

        const newTxn = {
            user_id: userId,
            amount: parsedAmount,
            category,
            description: (description || '').trim() || null,
            date: date || new Date().toISOString().slice(0, 10),
            created_at: new Date().toISOString(),
            receipt_fingerprint: receipt_fingerprint || null
        };
        const id = await db.transactions.add(newTxn);
        return { ...newTxn, id };
    },

    async createBatch(items) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('No expenses were provided');
        }

        const userId = await getUserId();
        const now = new Date().toISOString();

        const toAdd = items.map(item => {
            const amount = parseFloat(item.amount);
            const category = typeof item.category === 'string' ? item.category.trim() : '';
            const date = item.date || now.slice(0, 10);

            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error('Every expense must have an amount greater than zero');
            }
            if (!category) {
                throw new Error('Every expense must have a category');
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                throw new Error('Every expense must have a valid date');
            }

            return {
                user_id: userId,
                amount,
                category,
                description: (item.description || '').trim() || null,
                date,
                created_at: now,
                receipt_fingerprint: item.receipt_fingerprint || null
            };
        });

        // Atomic: either every line item is inserted or none are.
        return await db.transaction('rw', db.transactions, async () => {
            const ids = await db.transactions.bulkAdd(toAdd, { allKeys: true });
            return toAdd.map((item, index) => ({ ...item, id: ids[index] }));
        });
    },

    async receiptFingerprintExists(fingerprint) {
        if (!fingerprint) return false;
        const userId = await getUserId();
        const match = await db.transactions
            .where('receipt_fingerprint')
            .equals(fingerprint)
            .filter(txn => txn.user_id === userId)
            .first();
        return Boolean(match);
    },

    // ─── SMS DEDUPLICATION & IMPORT ───────────────────────────────────────────
    async getProcessedSmsIds() {
        const userId = await getUserId();
        const rows = await db.processed_sms.where('user_id').equals(userId).toArray();
        return rows.map(row => String(row.sms_id));
    },

    /**
     * Inserts SMS-derived transactions and records their SMS ids in the same
     * Dexie transaction. A message is only marked processed if its transaction
     * was actually persisted.
     */
    async importSmsTransactions(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return { created: [], skipped: [] };
        }

        const userId = await getUserId();
        const now = new Date().toISOString();
        const seen = new Set();
        const normalized = [];

        for (const item of items) {
            const smsId = String(item.smsId ?? item.sms_id ?? '').trim();
            if (!smsId || seen.has(smsId)) continue;
            seen.add(smsId);

            const amount = parseFloat(item.amount);
            const category = typeof item.category === 'string' ? item.category.trim() : '';
            const date = item.date;

            if (!Number.isFinite(amount) || amount <= 0) continue;
            if (!category) continue;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) continue;

            normalized.push({
                smsId,
                amount,
                category,
                date,
                description: (item.description || item.merchant || 'Bank SMS transaction').trim()
            });
        }

        if (normalized.length === 0) {
            return { created: [], skipped: [] };
        }

        return await db.transaction('rw', db.transactions, db.processed_sms, async () => {
            const existing = await db.processed_sms.where('user_id').equals(userId).toArray();
            const existingIds = new Set(existing.map(row => String(row.sms_id)));

            const fresh = normalized.filter(item => !existingIds.has(item.smsId));
            const skipped = normalized.filter(item => existingIds.has(item.smsId)).map(item => item.smsId);

            if (fresh.length === 0) {
                return { created: [], skipped };
            }

            const toAdd = fresh.map(item => ({
                user_id: userId,
                amount: item.amount,
                category: item.category,
                description: item.description || null,
                date: item.date,
                created_at: now,
                receipt_fingerprint: null,
                sms_id: item.smsId
            }));

            const ids = await db.transactions.bulkAdd(toAdd, { allKeys: true });

            await db.processed_sms.bulkAdd(
                fresh.map((item, index) => ({
                    user_id: userId,
                    sms_id: item.smsId,
                    transaction_id: ids[index],
                    processed_at: now
                }))
            );

            return {
                created: toAdd.map((item, index) => ({ ...item, id: ids[index] })),
                skipped
            };
        });
    },

    async update(id, { amount, category, description, date }) {
        const userId = await getUserId();
        const numId = parseInt(id, 10);
        const existing = await db.transactions.get(numId);
        if (!existing || existing.user_id !== userId) {
            throw new Error('Expense not found');
        }

        const updated = {
            ...existing,
            amount: amount !== undefined ? parseFloat(amount) : existing.amount,
            category: category || existing.category,
            description: description !== undefined ? (description || '').trim() || null : existing.description,
            date: date || existing.date
        };

        await db.transactions.put(updated);
        return updated;
    },

    async delete(id) {
        const userId = await getUserId();
        const numId = parseInt(id, 10);
        const existing = await db.transactions.get(numId);
        if (!existing || existing.user_id !== userId) {
            throw new Error('Expense not found');
        }
        await db.transactions.delete(numId);
        return true;
    },

    // ─── ANALYTICS & SUMMARIES ────────────────────────────────────────────────
    async getMonthlySummary(month) {
        const userId = await getUserId();
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const allTxns = await db.transactions
            .where('user_id')
            .equals(userId)
            .toArray();

        const monthTxns = allTxns.filter(t => t.date && t.date.startsWith(targetMonth));

        let totalSpending = 0;
        const catMap = {};

        monthTxns.forEach(t => {
            const amt = parseFloat(t.amount) || 0;
            totalSpending += amt;
            const cat = t.category || 'Others';
            if (!catMap[cat]) {
                catMap[cat] = { category: cat, total: 0, count: 0 };
            }
            catMap[cat].total += amt;
            catMap[cat].count += 1;
        });

        const categoryBreakdown = Object.values(catMap).sort((a, b) => b.total - a.total);

        return {
            totalSpending: parseFloat(totalSpending.toFixed(2)),
            transactionCount: monthTxns.length,
            categoryBreakdown
        };
    },

    async getMonthlyTrend(months = 60) {
        const userId = await getUserId();
        const allTxns = await db.transactions
            .where('user_id')
            .equals(userId)
            .toArray();

        const monthMap = {};
        allTxns.forEach(t => {
            if (!t.date) return;
            const m = t.date.slice(0, 7);
            const amt = parseFloat(t.amount) || 0;
            monthMap[m] = (monthMap[m] || 0) + amt;
        });

        const sortedMonths = Object.keys(monthMap).sort();
        const recentMonths = sortedMonths.slice(-months);

        return recentMonths.map(m => ({
            month: m,
            total: parseFloat(monthMap[m].toFixed(2))
        }));
    },

    async getDailySpending(month) {
        const userId = await getUserId();
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const allTxns = await db.transactions
            .where('user_id')
            .equals(userId)
            .toArray();

        const monthTxns = allTxns.filter(t => t.date && t.date.startsWith(targetMonth));
        const dayMap = {};

        monthTxns.forEach(t => {
            const day = t.date;
            const amt = parseFloat(t.amount) || 0;
            dayMap[day] = (dayMap[day] || 0) + amt;
        });

        return Object.keys(dayMap).sort().map(day => ({
            day,
            total: parseFloat(dayMap[day].toFixed(2))
        }));
    },

    async getSavingsHistory() {
        const userId = await getUserId();
        const user = await db.user_profile.get(userId);
        const defaultIncome = user ? parseFloat(user.monthly_income) || 65000 : 65000;

        const [allTxns, allBudgets] = await Promise.all([
            db.transactions.where('user_id').equals(userId).toArray(),
            db.budgets.where('user_id').equals(userId).toArray()
        ]);

        const monthSpent = {};
        allTxns.forEach(t => {
            if (!t.date) return;
            const m = t.date.slice(0, 7);
            monthSpent[m] = (monthSpent[m] || 0) + (parseFloat(t.amount) || 0);
        });

        const budgetMap = {};
        allBudgets.forEach(b => {
            if (b.category === 'All') {
                budgetMap[b.month] = parseFloat(b.budget_amount) || defaultIncome;
            }
        });

        const months = Object.keys(monthSpent).sort().reverse();
        return months.map(m => {
            const income = budgetMap[m] !== undefined ? budgetMap[m] : defaultIncome;
            const spent = parseFloat(monthSpent[m].toFixed(2));
            const savings = parseFloat((income - spent).toFixed(2));
            return {
                month: m,
                income,
                spent,
                savings
            };
        });
    },

    async getCategoryBaseline(currentMonth, months = 3) {
        const userId = await getUserId();
        const allTxns = await db.transactions.where('user_id').equals(userId).toArray();

        // Calculate start boundary
        const [y, m] = currentMonth.split('-').map(Number);
        const priorMonths = [];
        for (let i = 1; i <= months; i++) {
            const d = new Date(y, m - 1 - i, 1);
            const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            priorMonths.push(mStr);
        }

        // Aggregate by category and month
        const catMonthTotals = {};
        allTxns.forEach(t => {
            if (!t.date) return;
            const txnMonth = t.date.slice(0, 7);
            if (priorMonths.includes(txnMonth)) {
                const cat = t.category;
                if (!catMonthTotals[cat]) catMonthTotals[cat] = {};
                catMonthTotals[cat][txnMonth] = (catMonthTotals[cat][txnMonth] || 0) + parseFloat(t.amount || 0);
            }
        });

        const baselines = [];
        for (const [cat, monthData] of Object.entries(catMonthTotals)) {
            const values = Object.values(monthData);
            const sum = values.reduce((s, v) => s + v, 0);
            const avg = values.length > 0 ? sum / values.length : 0;
            const max = values.length > 0 ? Math.max(...values) : 0;
            baselines.push({
                category: cat,
                avgSpent: parseFloat(avg.toFixed(2)),
                maxSpent: parseFloat(max.toFixed(2)),
                monthsWithData: values.length
            });
        }

        return baselines;
    },

    async getMicroLeakage(month, threshold = 300, minCount = 4) {
        const userId = await getUserId();
        const targetMonth = month || new Date().toISOString().slice(0, 7);
        const allTxns = await db.transactions.where('user_id').equals(userId).toArray();

        const monthTxns = allTxns.filter(t =>
            t.date &&
            t.date.startsWith(targetMonth) &&
            parseFloat(t.amount) <= threshold
        );

        const catMap = {};
        monthTxns.forEach(t => {
            const cat = t.category || 'Others';
            const amt = parseFloat(t.amount) || 0;
            if (!catMap[cat]) {
                catMap[cat] = { category: cat, frequency: 0, total: 0 };
            }
            catMap[cat].frequency += 1;
            catMap[cat].total += amt;
        });

        const results = [];
        for (const [cat, data] of Object.entries(catMap)) {
            if (data.frequency >= minCount) {
                results.push({
                    category: cat,
                    frequency: data.frequency,
                    total: parseFloat(data.total.toFixed(2)),
                    avgAmount: parseFloat((data.total / data.frequency).toFixed(2))
                });
            }
        }

        return results.sort((a, b) => b.total - a.total);
    },

    async getPeriodSummary(startMonth, endMonth) {
        const userId = await getUserId();
        const allTxns = await db.transactions.where('user_id').equals(userId).toArray();

        const inPeriod = allTxns.filter(t => {
            if (!t.date) return false;
            const m = t.date.slice(0, 7);
            return m >= startMonth && m <= endMonth;
        });

        const monthMap = {};
        const catMap = {};
        let grandTotal = 0;

        inPeriod.forEach(t => {
            const m = t.date.slice(0, 7);
            const cat = t.category || 'Others';
            const amt = parseFloat(t.amount) || 0;

            grandTotal += amt;

            if (!monthMap[m]) monthMap[m] = { month: m, total: 0, count: 0 };
            monthMap[m].total += amt;
            monthMap[m].count += 1;

            if (!catMap[cat]) catMap[cat] = { category: cat, total: 0, count: 0 };
            catMap[cat].total += amt;
            catMap[cat].count += 1;
        });

        const byMonth = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
        const byCategory = Object.values(catMap).map(c => ({
            category: c.category,
            total: parseFloat(c.total.toFixed(2)),
            count: c.count,
            percentage: grandTotal > 0 ? Math.round((c.total / grandTotal) * 100) : 0
        })).sort((a, b) => b.total - a.total);

        return {
            period: `${startMonth} to ${endMonth}`,
            totalSpent: parseFloat(grandTotal.toFixed(2)),
            transactionCount: inPeriod.length,
            byMonth,
            byCategory
        };
    },

    async getCategoryHistory(category, startMonth, endMonth) {
        const userId = await getUserId();
        const allTxns = await db.transactions.where('user_id').equals(userId).toArray();

        const filtered = allTxns.filter(t => {
            if (!t.date || t.category !== category) return false;
            const m = t.date.slice(0, 7);
            return m >= startMonth && m <= endMonth;
        });

        const monthMap = {};
        let grandTotal = 0;

        filtered.forEach(t => {
            const m = t.date.slice(0, 7);
            const amt = parseFloat(t.amount) || 0;
            grandTotal += amt;

            if (!monthMap[m]) monthMap[m] = { month: m, total: 0, count: 0, amounts: [] };
            monthMap[m].total += amt;
            monthMap[m].count += 1;
            monthMap[m].amounts.push(amt);
        });

        const byMonth = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({
            month: m.month,
            total: parseFloat(m.total.toFixed(2)),
            count: m.count,
            avgTransaction: parseFloat((m.total / m.count).toFixed(2))
        }));

        const totals = byMonth.map(m => m.total);
        const avg = totals.length > 0 ? grandTotal / totals.length : 0;
        const highestMonth = byMonth.length > 0 ? byMonth.reduce((a, b) => a.total > b.total ? a : b) : null;
        const lowestMonth = byMonth.length > 0 ? byMonth.reduce((a, b) => a.total < b.total ? a : b) : null;

        return {
            category,
            period: `${startMonth} to ${endMonth}`,
            grandTotal: parseFloat(grandTotal.toFixed(2)),
            monthlyAverage: parseFloat(avg.toFixed(2)),
            activeMonths: byMonth.length,
            highestMonth,
            lowestMonth,
            byMonth
        };
    },

    async getAnnualBreakdown(year) {
        const startMonth = `${year}-01`;
        const endMonth = `${year}-12`;
        const summary = await this.getPeriodSummary(startMonth, endMonth);

        const highestMonth = summary.byMonth.length > 0 ? summary.byMonth.reduce((a, b) => a.total > b.total ? a : b) : null;
        const lowestMonth = summary.byMonth.length > 0 ? summary.byMonth.reduce((a, b) => a.total < b.total ? a : b) : null;

        return {
            year,
            annualTotal: summary.totalSpent,
            activeMonths: summary.byMonth.length,
            highestMonth,
            lowestMonth,
            byMonth: summary.byMonth,
            byCategory: summary.byCategory
        };
    },

    async comparePeriods(p1Start, p1End, p2Start, p2End) {
        const [p1, p2] = await Promise.all([
            this.getPeriodSummary(p1Start, p1End),
            this.getPeriodSummary(p2Start, p2End)
        ]);

        const catMap = {};
        p1.byCategory.forEach(c => {
            catMap[c.category] = { category: c.category, period1: c.total, period2: 0 };
        });
        p2.byCategory.forEach(c => {
            if (!catMap[c.category]) catMap[c.category] = { category: c.category, period1: 0, period2: c.total };
            else catMap[c.category].period2 = c.total;
        });

        const categoryComparison = Object.values(catMap).map(c => ({
            ...c,
            changePercent: c.period1 > 0 ? Math.round(((c.period2 - c.period1) / c.period1) * 100) : null
        })).sort((a, b) => b.period2 - a.period2);

        return {
            period1: `${p1Start} to ${p1End}`,
            period2: `${p2Start} to ${p2End}`,
            period1Total: p1.totalSpent,
            period2Total: p2.totalSpent,
            totalChange: p1.totalSpent > 0 ? Math.round(((p2.totalSpent - p1.totalSpent) / p1.totalSpent) * 100) : null,
            categoryComparison
        };
    },

    async getDataRange() {
        const userId = await getUserId();
        const allTxns = await db.transactions.where('user_id').equals(userId).toArray();
        if (allTxns.length === 0) {
            return {
                earliestMonth: null,
                latestMonth: null,
                totalTransactions: 0,
                categories: ''
            };
        }

        const dates = allTxns.map(t => t.date).filter(Boolean).sort();
        const earliest = dates[0]?.slice(0, 7) || '2024-05';
        const latest = dates[dates.length - 1]?.slice(0, 7) || '2026-11';
        const cats = Array.from(new Set(allTxns.map(t => t.category))).filter(Boolean).sort().join(', ');

        return {
            earliestMonth: earliest,
            latestMonth: latest,
            totalTransactions: allTxns.length,
            categories: cats
        };
    },

    // ─── BUDGETS ──────────────────────────────────────────────────────────────
    async getBudget(month) {
        const userId = await getUserId();
        const targetMonth = month || new Date().toISOString().slice(0, 7);

        const [user, budgetsList, summary] = await Promise.all([
            db.user_profile.get(userId),
            db.budgets
                .where('user_id')
                .equals(userId)
                .filter(b => b.month === targetMonth)
                .toArray(),
            this.getMonthlySummary(targetMonth)
        ]);

        const allRow = budgetsList.find(b => b.category === 'All');
        const profileIncome = user ? parseFloat(user.monthly_income) : NaN;
        const overallBudget = Number.isFinite(profileIncome) && profileIncome > 0
            ? profileIncome
            : (allRow ? parseFloat(allRow.budget_amount) || 0 : 0);

        const allocations = {};
        budgetsList.forEach(b => {
            if (b.category === 'All') return;
            const amount = parseFloat(b.budget_amount);
            if (Number.isFinite(amount) && amount > 0) {
                allocations[b.category] = amount;
            }
        });

        const spendingByCategory = {};
        summary.categoryBreakdown.forEach(item => {
            spendingByCategory[item.category] = {
                total: item.total,
                count: item.count
            };
        });

        const totalSpent = summary.totalSpending;
        const remaining = overallBudget - totalSpent;
        const percentUsed = overallBudget > 0 ? Math.round((totalSpent / overallBudget) * 100) : 0;
        const isOverBudget = overallBudget > 0 && totalSpent > overallBudget;

        const categoryBreakdown = buildCategoryBudgetBreakdown(allocations, spendingByCategory);
        const status = computeBudgetStatus({
            budgetAmount: overallBudget,
            totalSpent,
            categoryBreakdown
        });

        return {
            month: targetMonth,
            budgetAmount: overallBudget,
            allocations,
            totalSpent,
            remaining,
            percentUsed,
            isOverBudget,
            categoryBreakdown,
            overspentCategories: status.overspentCategories,
            status,
            hasBudget: overallBudget > 0 || budgetsList.length > 0
        };
    },

    async setBudget(allocations, month) {
        const userId = await getUserId();
        const targetMonth = month || new Date().toISOString().slice(0, 7);

        // Remove existing allocations for that month
        const existing = await db.budgets
            .where('user_id')
            .equals(userId)
            .filter(b => b.month === targetMonth)
            .toArray();

        for (const b of existing) {
            await db.budgets.delete(b.id);
        }

        const toAdd = [];
        let totalIncome = 0;

        if (Array.isArray(allocations)) {
            for (const item of allocations) {
                const amt = parseFloat(item.amount) || 0;
                toAdd.push({
                    user_id: userId,
                    month: targetMonth,
                    category: item.category,
                    budget_amount: amt,
                    created_at: new Date().toISOString()
                });
                totalIncome += amt;
            }
        }

        toAdd.push({
            user_id: userId,
            month: targetMonth,
            category: 'All',
            budget_amount: totalIncome,
            created_at: new Date().toISOString()
        });

        await db.budgets.bulkAdd(toAdd);
        return await this.getBudget(targetMonth);
    },

    // ─── CATEGORIES ───────────────────────────────────────────────────────────
    async getCategories() {
        const userId = await getUserId();
        const allCats = await db.categories.toArray();
        // Return global (user_id === null) and user's categories
        return allCats.filter(c => c.user_id === null || c.user_id === userId);
    },

    async createCategory(name, color) {
        const userId = await getUserId();
        const formattedName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

        const existing = await db.categories
            .where('name')
            .equalsIgnoreCase(formattedName)
            .first();

        if (existing) {
            throw new Error('Category name already exists');
        }

        const newCat = {
            user_id: userId,
            name: formattedName,
            color: color || '#2D3FBF',
            created_at: new Date().toISOString()
        };

        const id = await db.categories.add(newCat);
        return { ...newCat, id };
    },

    async updateCategory(id, color) {
        const numId = parseInt(id, 10);
        const cat = await db.categories.get(numId);
        if (!cat) throw new Error('Category not found');
        cat.color = color;
        await db.categories.put(cat);
        return cat;
    },

    async deleteCategory(id) {
        const numId = parseInt(id, 10);
        const cat = await db.categories.get(numId);
        if (!cat) throw new Error('Category not found');
        await db.categories.delete(numId);
        return true;
    }
};
