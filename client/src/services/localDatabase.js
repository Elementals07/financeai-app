import Dexie from 'dexie';
import {
    buildMonthRange,
    generateMonth,
    getIncome,
    getMonthlyPlan,
    DEFAULT_CATEGORIES
} from './seedData.js';
import { hashPassword } from './authCrypto.js';

export const db = new Dexie('FinanceAIDB');

db.version(1).stores({
    transactions: '++id, user_id, date, category, amount, created_at',
    budgets: '++id, [user_id+month+category], user_id, month, category',
    categories: '++id, user_id, name',
    user_profile: '++id, email',
    ai_insights_cache: '++id, [user_id+type+prompt_hash], expires_at'
});

// v2 adds durable SMS deduplication and receipt duplicate detection.
// Existing stores and indexes are preserved; no data is removed.
db.version(2).stores({
    transactions: '++id, user_id, date, category, amount, created_at, receipt_fingerprint',
    budgets: '++id, [user_id+month+category], user_id, month, category',
    categories: '++id, user_id, name',
    user_profile: '++id, email',
    ai_insights_cache: '++id, [user_id+type+prompt_hash], expires_at',
    processed_sms: '++id, &[user_id+sms_id], user_id, sms_id, processed_at'
});

export const DEMO_USERNAME = 'Elementals';
export const DEMO_EMAIL = 'user@financeai.com';
export const DEMO_PASSWORD = 'demo@123';

let initialised = false;

/**
 * Locates the demo profile. Prefer the is_demo flag, fall back to the
 * canonical seeded email (profiles created by older app versions).
 */
export async function findDemoUser() {
    const flagged = await db.user_profile.filter(p => p.is_demo === true).first();
    if (flagged) return flagged;
    return await db.user_profile
        .where('email')
        .equalsIgnoreCase(DEMO_EMAIL)
        .first() || null;
}

/**
 * Makes sure the demo account exists exactly once and always has:
 *  - id 1, the seeded "Elementals" identity
 *  - the is_demo flag
 *  - a working password (demo@123) for the Try Demo / manual login flow
 * Idempotent: safe to run on every app launch.
 */
async function ensureDemoUser() {
    let demo = await findDemoUser();
    if (!demo) {
        const existingId1 = await db.user_profile.get(1);
        if (existingId1) {
            demo = existingId1;
        } else {
            demo = {
                id: 1,
                name: DEMO_USERNAME,
                email: DEMO_EMAIL,
                monthly_income: 65000,
                created_at: new Date().toISOString()
            };
        }
    }

    const updates = {
        ...demo,
        id: demo.id || 1,
        name: demo.name || DEMO_USERNAME,
        email: demo.email || DEMO_EMAIL,
        is_demo: true
    };

    // Add a password to the demo account only if it has none.
    if (!updates.password_hash) {
        const hashed = await hashPassword(DEMO_PASSWORD);
        Object.assign(updates, hashed);
    }

    if (demo.password_hash !== updates.password_hash
        || demo.is_demo !== true
        || demo.name !== updates.name
        || demo.email !== updates.email) {
        await db.user_profile.put(updates);
    }

    return updates;
}

/**
 * Falls back to the demo profile id only because historical builds recorded
 * every transaction against the first profile (user 1). No records are ever
 * reassigned blindly to a newly registered user.
 */
function legacyMigrationNeeded(demoUser) {
    return demoUser && demoUser.id === 1;
}

async function getDemoSeedTargets(demoUser) {
    return {
        transactions: await db.transactions.where('user_id').equals(demoUser.id).count(),
        budgets: await db.budgets.where('user_id').equals(demoUser.id).count()
    };
}

/**
 * Initializes and seeds the on-device database on first app launch
 */
export async function initLocalDatabase() {
    if (initialised) {
        return await findDemoUser();
    }

    try {
        await db.open();

        initialised = true;

        // 1. Migration / demo account bootstrap (idempotent)
        const demoUser = await ensureDemoUser();

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

        // 3. Ensure Transactions (Pre-seed 2.5-year realistic dataset for the
        //    demo account only, and only once — re-runs never duplicate rows)
        const { transactions: demoTxnCount, budgets: demoBudgetCount } =
            await getDemoSeedTargets(demoUser);

        if (demoTxnCount === 0 || demoBudgetCount === 0) {
            console.log('[LOCAL DB] Seeding 2.5 years of realistic Indian middle-class transactions (May 2024 to Nov 2026) for the demo account...');
            const months = buildMonthRange();
            const allTransactions = [];

            months.forEach((monthStr, index) => {
                const monthTxns = generateMonth(monthStr, index, demoUser.id);
                allTransactions.push(...monthTxns);
            });

            if (allTransactions.length > 0) {
                await db.transactions.bulkAdd(allTransactions);
                console.log(`[LOCAL DB] Pre-seeded ${allTransactions.length} demo transactions across ${months.length} months.`);
            }

            // Seed Budgets for the last 6 months so budget managers and charts are rich immediately
            const recentMonths = months.slice(-6);
            const budgetRows = [];
            for (const month of recentMonths) {
                const income = getIncome(month);
                const plan = getMonthlyPlan(month);
                budgetRows.push({
                    user_id: demoUser.id,
                    month,
                    category: 'All',
                    budget_amount: income,
                    created_at: new Date().toISOString()
                });
                for (const [cat, amt] of Object.entries(plan)) {
                    budgetRows.push({
                        user_id: demoUser.id,
                        month,
                        category: cat,
                        budget_amount: amt,
                        created_at: new Date().toISOString()
                    });
                }
            }
            if (budgetRows.length > 0) {
                await db.budgets.bulkAdd(budgetRows);
                console.log(`[LOCAL DB] Pre-seeded ${budgetRows.length} demo budget allocations for recent months.`);
            }
        }

        if (!legacyMigrationNeeded(demoUser)) {
            throw new Error('[LOCAL DB] Demo user could not be resolved.');
        }

        return demoUser;
    } catch (err) {
        initialised = false;
        console.error('[LOCAL DB] Initialization error:', err);
        throw err;
    }
}
