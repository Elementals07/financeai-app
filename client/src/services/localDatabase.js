import Dexie from 'dexie';
import {
    buildMonthRange,
    generateMonth,
    getIncome,
    getMonthlyPlan,
    DEFAULT_CATEGORIES
} from './seedData';

export const db = new Dexie('FinanceAIDB');

db.version(1).stores({
    transactions: '++id, user_id, date, category, amount, created_at',
    budgets: '++id, [user_id+month+category], user_id, month, category',
    categories: '++id, user_id, name',
    user_profile: '++id, email',
    ai_insights_cache: '++id, [user_id+type+prompt_hash], expires_at'
});

/**
 * Initializes and seeds the on-device database on first app launch
 */
export async function initLocalDatabase() {
    try {
        await db.open();

        // 1. Ensure User Profile
        let user = await db.user_profile.toCollection().first();
        if (!user) {
            const defaultUser = {
                id: 1,
                name: 'Elementals',
                email: 'user@financeai.com',
                password_hash: 'local_authenticated',
                monthly_income: 65000,
                created_at: new Date().toISOString()
            };
            await db.user_profile.put(defaultUser);
            user = defaultUser;
        }

        // 2. Ensure Categories
        const catCount = await db.categories.count();
        if (catCount === 0) {
            await db.categories.bulkAdd(
                DEFAULT_CATEGORIES.map(c => ({
                    ...c,
                    created_at: new Date().toISOString()
                }))
            );
        }

        // 3. Ensure Transactions (Pre-seed 2.5-year realistic dataset if empty)
        const txnCount = await db.transactions.count();
        if (txnCount === 0) {
            console.log('[LOCAL DB] Seeding 2.5 years of realistic Indian middle-class transactions (May 2024 to Nov 2026)...');
            const months = buildMonthRange();
            const allTransactions = [];

            months.forEach((monthStr, index) => {
                const monthTxns = generateMonth(monthStr, index, user.id);
                allTransactions.push(...monthTxns);
            });

            await db.transactions.bulkAdd(allTransactions);
            console.log(`[LOCAL DB] Pre-seeded ${allTransactions.length} transactions across ${months.length} months.`);

            // Seed Budgets for the last 6 months so budget managers and charts are rich immediately
            const recentMonths = months.slice(-6);
            const budgetRows = [];
            for (const month of recentMonths) {
                const income = getIncome(month);
                const plan = getMonthlyPlan(month);
                budgetRows.push({
                    user_id: user.id,
                    month,
                    category: 'All',
                    budget_amount: income,
                    created_at: new Date().toISOString()
                });
                for (const [cat, amt] of Object.entries(plan)) {
                    budgetRows.push({
                        user_id: user.id,
                        month,
                        category: cat,
                        budget_amount: amt,
                        created_at: new Date().toISOString()
                    });
                }
            }
            await db.budgets.bulkAdd(budgetRows);
            console.log(`[LOCAL DB] Pre-seeded ${budgetRows.length} budget allocations for recent months.`);
        }

        return user;
    } catch (err) {
        console.error('[LOCAL DB] Initialization error:', err);
        throw err;
    }
}
