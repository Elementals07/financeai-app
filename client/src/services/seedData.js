/**
 * 2.5-Year Realistic Indian Middle-Class Expense Seed Dataset
 * Covers: May 2024 -> November 2026 (31 months)
 * Income: Rs 55k -> Rs 60k -> Rs 65k (income ladder)
 */

export function getIncome(month) {
    if (month <= '2024-12') return 55000;
    if (month <= '2025-12') return 60000;
    return 65000;
}

export function getRent(month) {
    if (month <= '2024-12') return 14000;
    if (month <= '2025-06') return 15500;
    return 18000;
}

export function jitter(base, pct, seed) {
    const hash = ((seed * 2654435761) >>> 0) % 1000;
    const sign = hash % 2 === 0 ? 1 : -1;
    const factor = 1 + sign * ((hash % 100) / 100) * pct;
    return Math.round(base * factor);
}

export const FOOD_TXNS = [
    ['Reliance Fresh – monthly grocery', 0.38],
    ['Big Bazaar – grocery run',         0.36],
    ['Blinkit – weekly top-up',          0.09],
    ['Swiggy – weekday dinner',          0.07],
    ['Zomato – weekend dinner',          0.08],
    ['Family restaurant outing',         0.09],
    ['Blinkit – eggs, milk, bread',      0.05],
    ['Swiggy – lunch',                   0.05],
    ['Chai & snacks – daily',            0.04],
    ['DMart – household grocery',        0.12],
    ['Zepto – quick top-up',             0.04],
    ['Sweets & mithai',                  0.03],
];

export const TRAVEL_TXNS = [
    ['Petrol – monthly fill-up',         0.62],
    ['Ola / Rapido – weekday rides',     0.18],
    ['Metro card recharge',              0.10],
    ['Weekend outing – cab',             0.10],
];

export const UTILITIES_TXNS = [
    ['Electricity bill',                 0.55],
    ['Broadband internet',               0.18],
    ['Mobile recharge',                  0.14],
    ['Gas cylinder',                     0.13],
];

export const ENTERTAINMENT_TXNS = [
    ['Netflix + Hotstar',                0.42],
    ['Movie tickets – BookMyShow',       0.30],
    ['Weekend outing – café / drinks',   0.28],
];

export const HEALTH_TXNS = [
    ['Gym membership',                   0.52],
    ['Pharmacy – vitamins & medicine',   0.20],
    ['Doctor consultation',              0.16],
    ['Diagnostic lab – blood test',      0.12],
];

export const EDUCATION_TXNS = [
    ['Udemy / Coursera course',          0.55],
    ['Books – finance & productivity',   0.20],
    ['YouTube Premium',                  0.10],
    ['Workshop registration',            0.15],
];

export const SHOPPING_TXNS = [
    ['Amazon / Flipkart – clothing',     0.40],
    ['Myntra – fashion & accessories',   0.25],
    ['Home essentials – DMart',          0.18],
    ['Electronics / gadget accessory',   0.17],
];

export const OTHERS_TXNS = [
    ['Society maintenance charge',       0.35],
    ['Haircut + grooming',               0.22],
    ['Newspaper + misc subscription',    0.18],
    ['Gifts & occasions',                0.25],
];

export function splitBudget(total, templates, date, seedOffset) {
    const active = templates.filter(t => t[1] > 0.03);
    const txns = [];
    let used = 0;
    for (let i = 0; i < active.length - 1; i++) {
        const [desc, fraction] = active[i];
        const rawAmt = Math.round(total * fraction);
        if (rawAmt < 50) continue;
        const amt = jitter(rawAmt, 0.08, seedOffset + i);
        used += amt;
        txns.push({ desc, amount: amt });
    }
    const remainder = total - used;
    if (remainder > 50) {
        txns.push({ desc: active[active.length - 1][0], amount: remainder });
    }
    return txns;
}

export function assignDays(txns, year, month) {
    const daySlots = [1, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 18, 19, 21, 22, 24, 25, 26, 27, 28, 29, 30];
    return txns.map((t, i) => ({
        ...t,
        date: `${year}-${String(month).padStart(2, '0')}-${String(daySlots[i % daySlots.length]).padStart(2, '0')}`
    }));
}

export function getMonthlyPlan(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const income = getIncome(monthStr);
    const rent   = getRent(monthStr);

    const disposable = income - rent;
    const isFestival   = m === 10 || m === 11;
    const isSale       = m === 8 || m === 1;
    const isHoliSeason = m === 3;
    const isSummer     = m === 4 || m === 5 || m === 6;
    const isLean       = m === 2 || m === 7;

    const monthSeed = (y - 2024) * 12 + m;
    const v = (n, spread = 0.06) => {
        const h = ((monthSeed * n * 2654435761) >>> 0) % 1000;
        return 1 + ((h % 200) - 100) / 100 * spread;
    };

    const plan = {
        Rent:          rent,
        Food:          Math.round(disposable * (isSummer ? 0.165 : isLean ? 0.145 : 0.155) * v(2)),
        Travel:        Math.round(disposable * (isFestival ? 0.105 : 0.095) * v(3)),
        Shopping:      Math.round(disposable * (isFestival ? 0.18 : isSale ? 0.14 : isHoliSeason ? 0.11 : 0.07) * v(5)),
        Health:        Math.round(disposable * 0.065 * v(7)),
        Utilities:     Math.round(disposable * (isSummer ? 0.085 : 0.065) * v(11)),
        Entertainment: Math.round(disposable * (isFestival ? 0.055 : 0.042) * v(13)),
        Education:     Math.round(disposable * 0.045 * v(17)),
        Others:        Math.round(disposable * 0.03 * v(19)),
    };

    const travelMonths = ['2024-06', '2024-12', '2025-04', '2025-09', '2026-01', '2026-07'];
    if (travelMonths.includes(monthStr)) {
        plan.Travel += Math.round(income * 0.09);
    }

    const medMonths = ['2024-09', '2025-02', '2025-08', '2026-03', '2026-09'];
    if (medMonths.includes(monthStr)) {
        plan.Health += Math.round(income * 0.04);
    }

    const courseMonths = ['2024-06', '2024-11', '2025-03', '2025-07', '2026-02', '2026-08'];
    if (courseMonths.includes(monthStr)) {
        plan.Education += Math.round(income * 0.035);
    }

    return plan;
}

export function generateMonth(monthStr, monthIndex, userId = 1) {
    const [y, m] = monthStr.split('-').map(Number);
    const plan = getMonthlyPlan(monthStr);
    const allTxns = [];

    const TEMPLATES = {
        Rent:          null,
        Food:          FOOD_TXNS,
        Travel:        TRAVEL_TXNS,
        Utilities:     UTILITIES_TXNS,
        Entertainment: ENTERTAINMENT_TXNS,
        Health:        HEALTH_TXNS,
        Education:     EDUCATION_TXNS,
        Shopping:      SHOPPING_TXNS,
        Others:        OTHERS_TXNS,
    };

    for (const [cat, budget] of Object.entries(plan)) {
        if (budget < 100) continue;

        if (cat === 'Rent') {
            allTxns.push({
                user_id: userId,
                category: cat,
                amount: budget,
                description: 'Monthly rent – 2BHK apartment',
                date: `${y}-${String(m).padStart(2, '0')}-01`,
                created_at: new Date(`${y}-${String(m).padStart(2, '0')}-01T10:00:00Z`).toISOString()
            });
            continue;
        }

        const tmpl = TEMPLATES[cat];
        if (!tmpl) continue;

        const seed = monthIndex * 97 + cat.charCodeAt(0) * 31 + cat.charCodeAt(cat.length - 1);
        const subTxns = splitBudget(budget, tmpl, monthStr, seed);
        const withDays = assignDays(subTxns, y, m);
        withDays.forEach(t => {
            allTxns.push({
                user_id: userId,
                category: cat,
                amount: t.amount,
                description: t.desc,
                date: t.date,
                created_at: new Date(`${t.date}T12:00:00Z`).toISOString()
            });
        });
    }

    return allTxns.filter(t => t.amount > 0);
}

export function buildMonthRange() {
    const months = [];
    let y = 2024, m = 5;
    while (`${y}-${String(m).padStart(2, '0')}` <= '2026-11') {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return months;
}

export const DEFAULT_CATEGORIES = [
    { name: 'Food', color: '#ef4444', user_id: null },
    { name: 'Travel', color: '#f59e0b', user_id: null },
    { name: 'Rent', color: '#3b82f6', user_id: null },
    { name: 'Entertainment', color: '#8b5cf6', user_id: null },
    { name: 'Shopping', color: '#ec4899', user_id: null },
    { name: 'Utilities', color: '#06b6d4', user_id: null },
    { name: 'Health', color: '#10b981', user_id: null },
    { name: 'Education', color: '#6366f1', user_id: null },
    { name: 'Others', color: '#64748b', user_id: null }
];
