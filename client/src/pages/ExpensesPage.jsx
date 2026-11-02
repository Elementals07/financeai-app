import { useState, useEffect, useCallback } from 'react';
import API from '../api/axios';
import ExpenseForm from '../components/Expenses/ExpenseForm';
import ExpenseList from '../components/Expenses/ExpenseList';
import BillScannerModal from '../components/Expenses/BillScannerModal';
import SmsTransactionModal from '../components/Expenses/SmsTransactionModal';
import smsService from '../services/smsService';
import toast from 'react-hot-toast';
import { 
    HiOutlinePlus, 
    HiOutlineCamera, 
    HiOutlineFunnel,
    HiOutlineArrowDownTray,
    HiOutlineCreditCard
} from 'react-icons/hi2';
import { useCategories } from '../hooks/useCategories';

const TIME_FILTERS = ['Today', 'This Week', 'This Month', 'Specific Date', 'All Time'];

const ExpensesPage = () => {
    const { categoryNames } = useCategories();
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [showSmsModal, setShowSmsModal] = useState(false);
    const [smsTransactions, setSmsTransactions] = useState([]);
    const [scanningSms, setScanningSms] = useState(false);
    const [editExpense, setEditExpense] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    
    const [filterMonth, setFilterMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [filterCategory, setFilterCategory] = useState('All');
    const [timeFilter, setTimeFilter] = useState('This Month');
    const [specificDate, setSpecificDate] = useState(() => new Date().toISOString().slice(0, 10));

    const fetchExpenses = useCallback(async (pageNum = 1, isLoadMore = false) => {
        if (!isLoadMore) setLoading(true);
        else setLoadingMore(true);

        try {
            let url = `/expenses?page=${pageNum}&limit=25&`;
            const params = [];

            const now = new Date();
            const getLocalDateString = (date) => {
                const d = new Date(date);
                d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                return d.toISOString().slice(0, 10);
            };

            if (timeFilter === 'Today') {
                const today = getLocalDateString(now);
                params.push(`startDate=${today}`, `endDate=${today}`);
            } else if (timeFilter === 'This Week') {
                const dayOfWeek = now.getDay();
                const startOfWeek = new Date(now);
                startOfWeek.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                params.push(`startDate=${getLocalDateString(startOfWeek)}`, `endDate=${getLocalDateString(endOfWeek)}`);
            } else if (timeFilter === 'This Month') {
                params.push(`month=${filterMonth}`);
            } else if (timeFilter === 'Specific Date') {
                params.push(`startDate=${specificDate}`, `endDate=${specificDate}`);
            }

            if (filterCategory !== 'All') {
                params.push(`category=${encodeURIComponent(filterCategory)}`);
            }

            url += params.join('&');
            const res = await API.get(url);

            const newExpenses = res.data.data || [];
            if (isLoadMore) {
                setExpenses(prev => [...prev, ...newExpenses]);
            } else {
                setExpenses(newExpenses);
            }

            setHasMore(newExpenses.length === 25);
        } catch {
            toast.error('Failed to load expenses');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [filterMonth, filterCategory, timeFilter, specificDate]);

    useEffect(() => {
        setPage(1);
        fetchExpenses(1, false);
    }, [fetchExpenses]);

    const handleLoadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchExpenses(nextPage, true);
    };

    const handleCreate = async (data) => {
        await API.post('/expenses', data);
        fetchExpenses(1, false);
    };

    const handleUpdate = async (data) => {
        if (!editExpense) return;
        await API.put(`/expenses/${editExpense.id}`, data);
        fetchExpenses(1, false);
        setEditExpense(null);
    };

    const handleDelete = async (id) => {
        try {
            await API.delete(`/expenses/${id}`);
            setExpenses(prev => prev.filter(e => e.id !== id));
            setDeletingId(null);
            toast.success('Expense deleted');
        } catch {
            toast.error('Failed to delete expense');
        }
    };

    const handleScanSms = async () => {
        setScanningSms(true);
        const toastId = toast.loading('Reading bank & UPI messages...');
        try {
            const messages = await smsService.fetchRecentBankSms(30);
            if (messages.length === 0) {
                toast.dismiss(toastId);
                toast.success('No new untracked bank messages found!');
                return;
            }

            toast.loading(`Found ${messages.length} messages. AI categorizing...`, { id: toastId });
            const parsed = await smsService.analyzeSmsWithAI(messages);
            toast.dismiss(toastId);

            if (parsed.length === 0) {
                toast('No debit transactions found in messages.', { icon: 'ℹ️' });
                return;
            }

            setSmsTransactions(parsed);
            setShowSmsModal(true);
        } catch (err) {
            toast.dismiss(toastId);
            toast.error('Could not scan SMS: ' + (err.message || 'Permission denied'));
        } finally {
            setScanningSms(false);
        }
    };

    const totalFilteredAmount = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    return (
        <div>
            {/* Page Header with Primary Actions */}
            <div className="page-header">
                <div className="page-header-row">
                    <div>
                        <div className="page-tag">
                            Transaction Management
                        </div>
                        <h1 className="page-title">Expenses</h1>
                        <p className="page-subtitle">
                            Record daily spending, filter by date or category, and scan receipts.
                        </p>
                    </div>

                    <div className="desktop-only-action" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => setShowScanner(true)}
                            aria-label="Scan bill or receipt"
                        >
                            <HiOutlineCamera aria-hidden="true" />
                            Scan Bill
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => { setEditExpense(null); setShowForm(true); }}
                            aria-label="Add a new expense"
                        >
                            <HiOutlinePlus aria-hidden="true" />
                            Add Expense
                        </button>
                    </div>
                </div>
            </div>

            {/* Compact Filter Area */}
            <div className="card filter-card" style={{ marginBottom: '1.25rem', padding: '0.875rem 1rem' }}>
                <div className="filter-controls-wrapper">
                    {/* Time Filter Scrollable Strip on Mobile */}
                    <div className="time-filter-strip">
                        <span className="filter-label">
                            <HiOutlineFunnel aria-hidden="true" />
                        </span>
                        <div className="filter-scroll-strip">
                            {TIME_FILTERS.map(tf => (
                                <button
                                    key={tf}
                                    type="button"
                                    onClick={() => setTimeFilter(tf)}
                                    className={`btn btn-sm ${timeFilter === tf ? 'btn-primary' : 'btn-outline'}`}
                                    style={{ minHeight: '34px', padding: '0 12px', fontSize: '0.8125rem', whiteSpace: 'nowrap', flexShrink: 0 }}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Secondary Filters: Month / Date / Category */}
                    <div className="secondary-filters-row">
                        {timeFilter === 'This Month' && (
                            <input
                                type="month"
                                value={filterMonth}
                                onChange={(e) => setFilterMonth(e.target.value)}
                                className="form-input"
                                style={{ minHeight: '36px', padding: '0.25rem 0.5rem', fontSize: '0.85rem', flex: 1 }}
                                aria-label="Select month filter"
                            />
                        )}

                        {timeFilter === 'Specific Date' && (
                            <input
                                type="date"
                                value={specificDate}
                                onChange={(e) => setSpecificDate(e.target.value)}
                                className="form-input"
                                style={{ minHeight: '36px', padding: '0.25rem 0.5rem', fontSize: '0.85rem', flex: 1 }}
                                aria-label="Select specific date filter"
                            />
                        )}

                        <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            className="form-select"
                            style={{ minHeight: '36px', padding: '0.25rem 0.75rem', fontSize: '0.85rem', flex: 1 }}
                            aria-label="Filter by category"
                        >
                            <option value="All">All Categories</option>
                            {categoryNames.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Subtotal callout with Fast SMS Sync */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                            <strong>{expenses.length}</strong> {expenses.length === 1 ? 'item' : 'items'}
                        </span>
                        <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={handleScanSms}
                            disabled={scanningSms}
                            title="Auto-scan bank & UPI debit SMS"
                            style={{ height: '28px', padding: '0 8px', fontSize: '0.75rem', borderRadius: 'var(--radius-full)' }}
                        >
                            <HiOutlineCreditCard aria-hidden="true" style={{ color: 'var(--color-primary)' }} />
                            <span>{scanningSms ? 'Scanning...' : 'Sync Bank SMS'}</span>
                        </button>
                    </div>

                    <span style={{ color: 'var(--text-primary)' }}>
                        Total: <strong className="num" style={{ color: '#9B1C1C', fontSize: '1.05rem', fontWeight: 700 }}>₹{totalFilteredAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
                    </span>
                </div>
            </div>

            {/* Transaction List Component */}
            <ExpenseList
                expenses={expenses}
                loading={loading}
                deletingId={deletingId}
                onStartDelete={(id) => setDeletingId(id)}
                onCancelDelete={() => setDeletingId(null)}
                onDelete={handleDelete}
                onEdit={(exp) => { setEditExpense(exp); setShowForm(true); }}
            />

            {/* Pagination / Load More */}
            {hasMore && !loading && (
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                    <button
                        type="button"
                        className="btn btn-outline"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                    >
                        <HiOutlineArrowDownTray aria-hidden="true" />
                        {loadingMore ? 'Loading more...' : 'Load More Expenses'}
                    </button>
                </div>
            )}

            {/* Add / Edit Expense Modal */}
            {showForm && (
                <ExpenseForm
                    editData={editExpense}
                    onSubmit={editExpense ? handleUpdate : handleCreate}
                    onClose={() => { setShowForm(false); setEditExpense(null); }}
                />
            )}

            {/* Guided Bill Scanner Modal */}
            {showScanner && (
                <BillScannerModal
                    onClose={() => setShowScanner(false)}
                    onSuccess={() => fetchExpenses(1, false)}
                />
            )}

            {/* AI SMS Transaction Tracker Modal */}
            {showSmsModal && (
                <SmsTransactionModal
                    transactions={smsTransactions}
                    onClose={() => setShowSmsModal(false)}
                    onSaved={() => fetchExpenses(1, false)}
                />
            )}

            {/* Mobile Floating Action Buttons */}
            <div className="mobile-fab-group">
                <button
                    type="button"
                    className="mobile-fab"
                    onClick={handleScanSms}
                    disabled={scanningSms}
                    aria-label="Scan Bank SMS"
                    title="Sync Bank SMS"
                    style={{
                        width: '42px',
                        height: '42px',
                        background: 'linear-gradient(135deg, #4F46E5, #06B6D4)',
                        fontSize: '1.2rem',
                        boxShadow: '0 3px 12px rgba(79, 70, 229, 0.4)',
                        alignSelf: 'center'
                    }}
                >
                    <HiOutlineCreditCard aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="mobile-fab mobile-fab-secondary"
                    onClick={() => setShowScanner(true)}
                    aria-label="Scan bill"
                    title="Scan Bill"
                >
                    <HiOutlineCamera aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="mobile-fab mobile-fab-primary"
                    onClick={() => { setEditExpense(null); setShowForm(true); }}
                    aria-label="Add new expense"
                    title="Add Expense"
                >
                    <HiOutlinePlus aria-hidden="true" />
                </button>
            </div>
        </div>
    );
};

export default ExpensesPage;
