/**
 * Authentication, Session & Account Isolation Tests
 *
 * Covers the nine required scenarios plus demo-seed idempotency.
 * Runs against Dexie with fake-indexeddb (real Web Crypto PBKDF2 hashing).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import 'fake-indexeddb/auto';

import { db, initLocalDatabase } from '../src/services/localDatabase.js';
import { localExpenseService, SESSION_EXPIRED_MESSAGE, authError } from '../src/services/localExpenseService.js';
import {
    getStoredToken,
    getStoredUserId,
    getStoredUser,
    clearSession
} from '../src/services/authSession.js';

const AMY = { name: 'Amy Analyst', email: 'amy@test.com', password: 'secret123' };

test('initialises demo account with hashed password', async () => {
    const demo = await initLocalDatabase();
    assert.equal(demo.is_demo, true);
    assert.equal(demo.email, 'user@financeai.com');
    assert.match(demo.password_hash, /.+/);
    assert.ok(
        !demo.password_hash.toLowerCase().includes('demo@123'),
        'password must be stored hashed, not plaintext'
    );
    assert.equal(demo.password_algo, 'PBKDF2-SHA256');
    assert.ok(demo.password_iterations >= 100000);
});

test('demo seeding is idempotent (no duplicate transactions on relaunch)', async () => {
    const demo = await initLocalDatabase();
    const before = await db.transactions.where('user_id').equals(demo.id).count();
    await initLocalDatabase();
    await initLocalDatabase();
    const after = await db.transactions.where('user_id').equals(demo.id).count();
    assert.equal(after, before, 'repeat init must not duplicate demo rows');
    assert.ok(after > 500, `expected rich demo dataset, got ${after}`);
});

// ── Test 1: Demo login ───────────────────────────────────────────────────────
test('demo login opens the seeded demo account with demo data', async () => {
    const { user } = await localExpenseService.loginDemo();
    assert.equal(user.is_demo, true);
    assert.equal(user.id, 1);

    // Explicit session points at the demo profile
    assert.equal(getStoredUserId(), 1);
    assert.match(getStoredToken(), /standalone_token_1/);

    const list = await localExpenseService.list({});
    assert.ok(list.data.length > 0, 'demo account must show preloaded transactions');
    assert.ok(list.pagination.total > 0);

    const budget = await localExpenseService.getBudget();
    assert.ok(budget.hasBudget, 'demo budgets must be visible');

    const savings = await localExpenseService.getSavingsHistory();
    assert.ok(savings.length > 0);
});

// ── Test 2: Registration ─────────────────────────────────────────────────────
test('registration creates an independent account with an empty ledger', async () => {
    const { token, user } = await localExpenseService.register(AMY.name, AMY.email, AMY.password);

    assert.notEqual(user.id, 1, 'new account must get a unique id');
    assert.equal(user.email, AMY.email);
    assert.equal(user.name, AMY.name);
    assert.match(token, new RegExp(`standalone_token_${user.id}`));
    assert.equal(getStoredUserId(), user.id, 'registration must authenticate the new account');

    // Password hashed, never plaintext
    assert.ok(!String(user.password_hash || '').includes(AMY.password));
    assert.equal(user.password_algo, 'PBKDF2-SHA256');

    // Empty ledger & no demo budgets for the new account
    const list = await localExpenseService.list({});
    assert.equal(list.data.length, 0);
    assert.equal(list.pagination.total, 0);

    const budget = await localExpenseService.getBudget();
    assert.deepEqual(budget.allocations, {}, 'new account must have no demo budget allocations');
    assert.equal(budget.totalSpent, 0);

    const savings = await localExpenseService.getSavingsHistory();
    assert.equal(savings.length, 0);
});

// ── Test 3: Login ────────────────────────────────────────────────────────────
test('logout then login restores the same registered account', async () => {
    clearSession();
    assert.equal(getStoredToken(), null, 'logout must clear token');
    assert.equal(getStoredUserId(), null, 'logout must clear session user id');
    await assert.rejects(
        () => localExpenseService.getCurrentUser(),
        err => err.message === SESSION_EXPIRED_MESSAGE,
        'no session data may exist after logout'
    );

    const { user } = await localExpenseService.login(AMY.email, AMY.password);
    assert.equal(user.email, AMY.email);
    assert.equal(user.name, AMY.name, 'exact same account must be restored');
    assert.equal(getStoredUserId(), user.id);
});

// ── Test 4: Invalid credentials ──────────────────────────────────────────────
test('login rejects wrong password and unknown email', async () => {
    const sessionBefore = getStoredUserId();

    await assert.rejects(
        () => localExpenseService.login(AMY.email, 'wrong-password'),
        err => err.response?.data?.message === 'Incorrect password. Please try again.'
    );

    await assert.rejects(
        () => localExpenseService.login('nobody@test.com', 'whatever123'),
        err => /No account found/i.test(err.response?.data?.message)
    );

    assert.equal(getStoredUserId(), sessionBefore, 'failed logins must not change the session');
});

// ── Test 5: Duplicate registration ───────────────────────────────────────────
test('duplicate registration is rejected without changing the existing account', async () => {
    await assert.rejects(
        () => localExpenseService.register('Amy Impostor', AMY.email, 'secret999'),
        err => /already exists/i.test(err.response?.data?.message)
    );

    const existing = await db.user_profile.where('email').equalsIgnoreCase(AMY.email).first();
    assert.equal(existing.name, AMY.name, 'original account untouched');
    assert.notEqual(existing.password_hash, undefined);
    // A different old password must still be required to sign in
    await assert.rejects(
        () => localExpenseService.login(AMY.email, 'secret999'),
        err => err.response?.data?.message === 'Incorrect password. Please try again.'
    );
});

// ── Test 6: Account isolation ────────────────────────────────────────────────
test('accounts cannot see each other\'s transactions', async () => {
    // Account A: Amy creates an expense
    await localExpenseService.login(AMY.email, AMY.password);
    const created = await localExpenseService.create({ amount: 100, category: 'Food', description: 'A only lunch' });
    assert.ok(created.id);

    // Account B: demo must not see it
    await localExpenseService.loginDemo();
    const demoList = await localExpenseService.list({});
    assert.ok(!demoList.data.some(t => t.description === 'A only lunch'));

    // Back to A: the expense still exists
    await localExpenseService.login(AMY.email, AMY.password);
    const amyList = await localExpenseService.list({});
    assert.ok(amyList.data.some(t => t.id === created.id && t.amount === 100));

    // Editing / deleting is also scoped
    await localExpenseService.update(created.id, { amount: 150, category: 'Food' });
    const demoListAgain = await localExpenseService.loginDemo().then(() => localExpenseService.list({}));
    assert.ok(!demoListAgain.data.some(t => t.id === created.id));
});

// ── Test 7: Session persistence ──────────────────────────────────────────────
test('session persists across an app relaunch for the right account', async () => {
    await localExpenseService.login(AMY.email, AMY.password);

    // Simulate relaunch: a fresh init + /auth/me resolution driven purely by
    // the persisted session (token + auth_user_id)
    await initLocalDatabase();
    const current = await localExpenseService.getCurrentUser();
    assert.equal(current.email, AMY.email, 'same account restored, not the demo account');
    assert.notEqual(current.password_hash, AMY.password, 'hash must never equal the plaintext password');
    assert.equal(getStoredUser()?.email, AMY.email);
});

// ── Test 8: Logout ───────────────────────────────────────────────────────────
test('logout clears every piece of authentication state', async () => {
    clearSession();
    const demo = await initLocalDatabase(); // relaunch semantics

    assert.equal(getStoredToken(), null);
    assert.equal(getStoredUserId(), null);
    assert.equal(getStoredUser(), null);

    // An invalid/missing session must NOT auto-authenticate the demo user
    await assert.rejects(
        () => localExpenseService.getCurrentUser(),
        err => err.response?.status === 401 && err.message === SESSION_EXPIRED_MESSAGE
    );
    assert.equal(demo.is_demo, true, 'demo account still exists after logout, but is not signed in');
});

// ── Test 9: Demo isolation (both directions) ─────────────────────────────────
test('personal and demo account data stay independent in both directions', async () => {
    // Modify demo data
    await localExpenseService.loginDemo();
    const demoExpense = await localExpenseService.create({ amount: 777, category: 'Utilities', description: 'demo-only bill' });

    // Personal account unaffected
    await localExpenseService.login(AMY.email, AMY.password);
    const amyList = await localExpenseService.list({});
    assert.ok(!amyList.data.some(t => t.description === 'demo-only bill'));
    const amyOnly = await localExpenseService.list({});
    assert.ok(amyOnly.data.some(t => t.description === 'A only lunch'));

    // And in the opposite direction: Amy's change never touched the demo data
    await localExpenseService.loginDemo();
    const demoList = await localExpenseService.list({});
    assert.ok(demoList.data.some(t => t.id === demoExpense.id && t.amount === 777));
    assert.ok(!demoList.data.some(t => t.description === 'A only lunch'));
});

test('validation errors are user-friendly', async () => {
    clearSession();
    await assert.rejects(
        () => localExpenseService.register('', 'bad-email', '123'),
        err => /full name|valid email|password/i.test(err.response?.data?.message)
    );
    await assert.rejects(
        () => localExpenseService.register('Valid Name', 'not-an-email', 'secret123'),
        err => /valid email/i.test(err.response?.data?.message)
    );
    await assert.rejects(
        () => localExpenseService.register('Valid Name', 'new@x.com', '123'),
        err => /6 characters/i.test(err.response?.data?.message)
    );
});

// Guard: smoke-check the error-shape helper itself
test('authError always mirrors HTTP error payload shape', async () => {
    const err = authError('boom');
    assert.equal(err.response.status, 400);
    assert.deepEqual(err.response.data, { success: false, message: 'boom' });
});
