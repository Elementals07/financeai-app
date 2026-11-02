import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeBudgetStatus,
    computeReceiptDifference,
    dateToLocalYmd,
    formatCategoryList,
    isDebitSmsBody,
    isExcludedSmsBody,
    isValidDateString,
    normalizeCategory,
    normalizeReceiptResult,
    normalizeSmsParse,
    redactSmsBody,
    toAmount,
    buildCategoryBudgetBreakdown
} from '../src/services/financeParsers.js';
import { buildReceiptFingerprint } from '../src/utils/receiptFingerprint.js';

test('toAmount parses currency strings and rejects junk', () => {
    assert.equal(toAmount('₹1,234.50'), 1234.5);
    assert.equal(toAmount('Rs. 99'), 99);
    assert.equal(toAmount('INR 45.10'), 45.1);
    assert.equal(toAmount(12.5), 12.5);
    assert.ok(Number.isNaN(toAmount('not a number')));
    assert.ok(Number.isNaN(toAmount('')));
    assert.ok(Number.isNaN(toAmount(null)));
});

test('isValidDateString validates real calendar dates', () => {
    assert.equal(isValidDateString('2024-02-29'), true);
    assert.equal(isValidDateString('2023-02-29'), false);
    assert.equal(isValidDateString('2024-13-01'), false);
    assert.equal(isValidDateString('29-02-2024'), false);
    assert.equal(isValidDateString(null), false);
});

test('dateToLocalYmd formats a timestamp', () => {
    const stamp = new Date(2026, 0, 5, 12, 0, 0).getTime();
    assert.equal(dateToLocalYmd(stamp), '2026-01-05');
    assert.equal(dateToLocalYmd('nope'), null);
});

test('normalizeCategory never invents categories', () => {
    const categories = ['Food', 'Utilities', 'Others'];
    assert.equal(normalizeCategory('food', categories), 'Food');
    assert.equal(normalizeCategory(' FOOD ', categories), 'Food');
    assert.equal(normalizeCategory('Travel', categories), 'Others');
    assert.equal(normalizeCategory('', categories), 'Others');
    assert.equal(normalizeCategory('Travel', []), 'Others');
    assert.equal(normalizeCategory(null, []), 'Others');
});

test('normalizeReceiptResult skips unreadable items instead of inventing amounts', () => {
    const result = normalizeReceiptResult(
        {
            merchant: 'Corner Shop',
            totalAmount: '₹250.00',
            billDate: '2026-01-10',
            primaryCategory: 'food',
            items: [
                { name: 'Milk', amount: '40', category: 'Food' },
                { name: 'Broken line', amount: 'abc' },
                { name: 'Bread', amount: '35.5' }
            ]
        },
        ['Food', 'Others']
    );

    assert.equal(result.merchant, 'Corner Shop');
    assert.equal(result.totalAmount, 250);
    assert.equal(result.billDate, '2026-01-10');
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].category, 'Food');
    assert.equal(result.items[1].category, 'Others');
    assert.ok(result.warnings.some(warning => warning.includes('unreadable amount')));
});

test('normalizeReceiptResult handles unparseable input safely', () => {
    const result = normalizeReceiptResult(null, ['Others']);
    assert.equal(result.totalAmount, 0);
    assert.deepEqual(result.items, []);
    assert.equal(result.merchant, 'Local Store');
    assert.ok(result.warnings.length > 0);
});

test('computeReceiptDifference detects balanced and mismatched totals', () => {
    const balanced = computeReceiptDifference(100, [{ amount: '60' }, { amount: 40 }]);
    assert.equal(balanced.itemsTotal, 100);
    assert.equal(balanced.difference, 0);
    assert.equal(balanced.isBalanced, true);

    const mismatch = computeReceiptDifference(100, [{ amount: 90 }]);
    assert.equal(mismatch.difference, 10);
    assert.equal(mismatch.isBalanced, false);
});

test('SMS filters exclude OTP, credit, failure, requests and promos', () => {
    assert.equal(isExcludedSmsBody('Your OTP is 123456. Do not share.'), true);
    assert.equal(isExcludedSmsBody('Rs 500 credited to your account'), true);
    assert.equal(isExcludedSmsBody('Transaction failed. Rs 500 debited will be reversed'), true);
    assert.equal(isExcludedSmsBody('Payment request of Rs 500 from ABC'), true);
    assert.equal(isExcludedSmsBody('Loan offer! Apply now for Rs 500000'), true);
    assert.equal(isExcludedSmsBody('Rs 250 debited from A/c for UPI txn'), false);
});

test('isDebitSmsBody requires both a debit and an amount', () => {
    assert.equal(isDebitSmsBody('Rs 250 debited from A/c for UPI txn'), true);
    assert.equal(isDebitSmsBody('Rs 250 was debited from your account'), true);
    assert.equal(isDebitSmsBody('Rs 250 transferred to your account'), true);
    assert.equal(isDebitSmsBody('Your balance is Rs 250'), false);
    assert.equal(isDebitSmsBody('You paid at the store'), false);
});

test('redactSmsBody hides balances, accounts, UPI ids and OTPs but keeps amounts', () => {
    const redacted = redactSmsBody(
        'Rs 250 debited from A/c XX1234 to swiggy@okaxis. Avl Bal: Rs 9000. OTP is 445566.'
    );
    assert.ok(redacted.includes('Rs 250'));
    assert.ok(!redacted.includes('1234'));
    assert.ok(!redacted.includes('swiggy@okaxis'));
    assert.ok(!redacted.includes('9000'));
    assert.ok(!redacted.includes('445566'));
});

test('normalizeSmsParse drops unsafe, duplicate and unknown messages', () => {
    const messages = [
        { id: '1', address: 'AD-HDFCBK', body: 'Rs 250 debited from A/c XX1234 to swiggy@okaxis', date: new Date(2026, 0, 10).getTime() },
        { id: '2', address: 'AD-ICICI', body: 'Your OTP is 123456', date: Date.now() },
        { id: '3', address: 'AD-SBI', body: 'Rs 500 credited to your account', date: Date.now() },
        { id: '4', address: 'AD-AXIS', body: 'Rs 300 debited from A/c', date: Date.now() }
    ];

    const parsed = normalizeSmsParse(
        [
            { smsId: '1', merchant: 'Swiggy', amount: '250', date: '2026-01-10', category: 'Food', type: 'debit' },
            { smsId: '1', merchant: 'Swiggy duplicate', amount: '250', date: '2026-01-10', category: 'Food', type: 'debit' },
            { smsId: '2', merchant: 'OTP', amount: '1', type: 'debit' },
            { smsId: '3', merchant: 'Credit', amount: '500', type: 'credit' },
            { smsId: '99', merchant: 'Unknown id', amount: '10', type: 'debit' },
            { smsId: '4', merchant: '', amount: '300', date: '2026-01-11', category: 'UnknownCat', type: 'debit' }
        ],
        messages,
        ['Food', 'Travel', 'Others']
    );

    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].merchant, 'Swiggy');
    assert.equal(parsed[0].amount, 250);
    assert.equal(parsed[0].source, 'HDFCBK');
    assert.equal(parsed[0].needsReview, false);
    assert.equal(parsed[1].merchant, 'Unknown Merchant');
    assert.equal(parsed[1].category, 'Others');
    assert.equal(parsed[1].needsReview, true);
});

test('buildCategoryBudgetBreakdown keeps unallocated spending safe', () => {
    const breakdown = buildCategoryBudgetBreakdown(
        { Food: 500, Utilities: 200 },
        { Food: { total: 600, count: 3 }, Travel: { total: 150, count: 1 } }
    );

    const food = breakdown.find(row => row.category === 'Food');
    const utilities = breakdown.find(row => row.category === 'Utilities');
    const travel = breakdown.find(row => row.category === 'Travel');

    assert.equal(food.percentUsed, 120);
    assert.equal(food.isOverBudget, true);
    assert.equal(utilities.spent, 0);
    assert.equal(travel.percentUsed, null);
    assert.equal(travel.isOverBudget, false);
});

test('computeBudgetStatus follows overall > category > approaching priority', () => {
    const breakdown = buildCategoryBudgetBreakdown(
        { Food: 100, Utilities: 100 },
        { Food: 150, Utilities: 120 }
    );

    const overallOver = computeBudgetStatus({
        budgetAmount: 200,
        totalSpent: 270,
        categoryBreakdown: breakdown
    });
    assert.equal(overallOver.level, 'danger');
    assert.equal(overallOver.reason, 'overall');

    const categoryOver = computeBudgetStatus({
        budgetAmount: 1000,
        totalSpent: 270,
        categoryBreakdown: breakdown
    });
    assert.equal(categoryOver.level, 'warning');
    assert.equal(categoryOver.reason, 'category');
    assert.equal(
        categoryOver.message,
        '2 categories have exceeded their allocated limits: Food and Utilities. Overall spending is still within budget.'
    );

    const approaching = computeBudgetStatus({
        budgetAmount: 100,
        totalSpent: 85,
        categoryBreakdown: []
    });
    assert.equal(approaching.level, 'warning');
    assert.equal(approaching.reason, 'approaching');

    const good = computeBudgetStatus({
        budgetAmount: 100,
        totalSpent: 20,
        categoryBreakdown: []
    });
    assert.equal(good.level, 'good');
});

test('formatCategoryList formats natural lists', () => {
    assert.equal(formatCategoryList([]), '');
    assert.equal(formatCategoryList(['Food']), 'Food');
    assert.equal(formatCategoryList(['Food', 'Travel']), 'Food and Travel');
    assert.equal(formatCategoryList(['Food', 'Travel', 'Utilities']), 'Food, Travel, and Utilities');
});

test('receipt fingerprint is stable and changes with content', () => {
    const receipt = {
        merchant: 'Corner Shop',
        billDate: '2026-01-10',
        totalAmount: 250,
        items: [{ name: 'Milk', amount: 40, category: 'Food' }]
    };

    const first = buildReceiptFingerprint(receipt);
    const second = buildReceiptFingerprint({ ...receipt, merchant: 'corner shop' });
    const changed = buildReceiptFingerprint({ ...receipt, totalAmount: 251 });

    assert.equal(first, second);
    assert.notEqual(first, changed);
    assert.match(first, /^rcpt_[0-9a-f]+$/);
});
