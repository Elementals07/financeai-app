import { useState, useRef, useEffect } from 'react';
import API from '../../api/axios';
import toast from 'react-hot-toast';
import { useCategories } from '../../hooks/useCategories';
import { cameraService } from '../../services/cameraService';
import { computeReceiptDifference } from '../../services/financeParsers';
import { buildReceiptFingerprint } from '../../utils/receiptFingerprint';
import {
    HiOutlineCamera,
    HiOutlinePhoto,
    HiOutlineArrowPath,
    HiOutlineCheck,
    HiOutlineXMark,
    HiOutlinePlus,
    HiOutlineTrash,
    HiOutlineExclamationTriangle,
    HiOutlineInformationCircle
} from 'react-icons/hi2';

const today = () => new Date().toISOString().slice(0, 10);

const formatMoney = (value) => {
    const num = Number(value);
    return (Number.isFinite(num) ? Math.abs(num) : 0).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
};

const BillScannerModal = ({ onClose, onSuccess }) => {
    const { categoryNames } = useCategories();
    const fileInputRef = useRef(null);

    const [imagePreview, setImagePreview] = useState(null);
    const [mimeType, setMimeType] = useState('image/jpeg');
    const [scanning, setScanning] = useState(false);
    const [saving, setSaving] = useState(false);

    // Step state: 1 = Upload, 2 = Review & reconcile
    const [step, setStep] = useState(1);

    // Scanned & user-editable fields
    const [merchant, setMerchant] = useState('');
    const [totalAmount, setTotalAmount] = useState('');
    const [category, setCategory] = useState(categoryNames[0] || 'Food');
    const [billDate, setBillDate] = useState(today);
    const [items, setItems] = useState([]);
    const [saveMode, setSaveMode] = useState('split');

    const [scanError, setScanError] = useState(null);
    const [aiWarnings, setAiWarnings] = useState([]);
    const [receiptConfirmed, setReceiptConfirmed] = useState(false);
    const [duplicateWarning, setDuplicateWarning] = useState(null);
    const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

    // Handle Escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Keep the primary category valid once categories load
    useEffect(() => {
        if (categoryNames.length > 0 && !categoryNames.includes(category)) {
            setCategory(categoryNames[0]);
        }
    }, [categoryNames, category]);

    const resolveCategory = (value) => {
        if (categoryNames.includes(value)) return value;
        if (categoryNames.length > 0) return categoryNames[0];
        return value || 'Others';
    };

    const markEdited = () => {
        setReceiptConfirmed(false);
        setDuplicateWarning(null);
        setDuplicateAcknowledged(false);
    };

    // Handle file selection
    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file (PNG, JPG, or WebP)');
            return;
        }

        if (file.size > 8 * 1024 * 1024) {
            toast.error('Image size must be under 8MB');
            return;
        }

        setMimeType(file.type);
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            setImagePreview(result);
            processImageScan(result, file.type);
        };
        reader.readAsDataURL(file);
    };

    // Native Camera capture
    const handleNativeCamera = async () => {
        try {
            const photo = await cameraService.captureFromCamera();
            if (photo && photo.base64) {
                const fullBase64 = `data:${photo.mimeType};base64,${photo.base64}`;
                setImagePreview(fullBase64);
                setMimeType(photo.mimeType);
                processImageScan(fullBase64, photo.mimeType);
            }
        } catch (err) {
            if (err?.message) toast.error(err.message);
        }
    };

    // Native Gallery pick
    const handleNativeGallery = async () => {
        try {
            const photo = await cameraService.pickFromGallery();
            if (photo && photo.base64) {
                const fullBase64 = `data:${photo.mimeType};base64,${photo.base64}`;
                setImagePreview(fullBase64);
                setMimeType(photo.mimeType);
                processImageScan(fullBase64, photo.mimeType);
            }
        } catch (err) {
            if (err?.message) toast.error(err.message);
        }
    };

    // Send to OCR API endpoint
    const processImageScan = async (base64, type) => {
        setScanning(true);
        setScanError(null);
        setAiWarnings([]);
        setReceiptConfirmed(false);
        setDuplicateAcknowledged(false);
        setDuplicateWarning(null);

        try {
            const res = await API.post('/ai/scan-bill', {
                image: base64,
                mimeType: type || mimeType
            });

            const data = res.data.data || {};
            const detectedItems = Array.isArray(data.items) ? data.items : [];

            setMerchant(data.merchant || '');
            setTotalAmount(data.totalAmount ? String(data.totalAmount) : '');
            setCategory(resolveCategory(data.primaryCategory));
            setBillDate(data.billDate || today());
            setItems(detectedItems.map(item => ({
                name: item.name || '',
                amount: item.amount !== undefined && item.amount !== null ? String(item.amount) : '',
                category: resolveCategory(item.category)
            })));
            setAiWarnings(Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : []);
            setSaveMode(detectedItems.length > 0 ? 'split' : 'single');

            setStep(2);
            toast.success('Bill extracted. Review the details and choose how to save it.');
        } catch (err) {
            setScanError(err?.message || 'The receipt could not be read automatically.');
            toast.error('Could not auto-read the bill. You can still enter the details manually.');
            setSaveMode('single');
            setStep(2); // Allow manual entry even if scanning had issues
        } finally {
            setScanning(false);
        }
    };

    const handleItemChange = (index, field, value) => {
        setItems(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
        markEdited();
    };

    const handleRemoveItem = (index) => {
        setItems(prev => prev.filter((_, i) => i !== index));
        markEdited();
    };

    const handleAddItem = () => {
        setItems(prev => [...prev, { name: '', amount: '', category: categoryNames[0] || 'Food' }]);
        markEdited();
    };

    const handleRescan = () => {
        setStep(1);
        setImagePreview(null);
        setItems([]);
        setSaveMode('split');
        setScanError(null);
        setAiWarnings([]);
        setReceiptConfirmed(false);
        setDuplicateAcknowledged(false);
        setDuplicateWarning(null);
    };

    const parsedTotal = parseFloat(totalAmount);
    const hasItems = items.length > 0;
    const shouldSaveItemized = saveMode === 'split' && hasItems;
    const {
        itemsTotal,
        difference,
        isBalanced
    } = computeReceiptDifference(parsedTotal, items);
    const needsDifferenceConfirmation =
        shouldSaveItemized &&
        Number.isFinite(parsedTotal) &&
        parsedTotal > 0 &&
        !isBalanced;

    const handleSave = async () => {
        if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) {
            toast.error('Please enter a valid receipt total');
            return;
        }
        if (!billDate) {
            toast.error('Please select the bill date');
            return;
        }
        if (!category) {
            toast.error('Please select a category');
            return;
        }

        if (shouldSaveItemized) {
            const invalidItem = items.find(item => {
                const amount = parseFloat(item.amount);
                return !Number.isFinite(amount) || amount <= 0;
            });
            if (invalidItem) {
                toast.error('Every line item must have an amount greater than zero');
                return;
            }
            if (needsDifferenceConfirmation && !receiptConfirmed) {
                toast.error('Confirm how the receipt total and line-item total differ before saving');
                return;
            }
        }

        const itemsForFingerprint = hasItems
            ? items.map((item, index) => ({
                name: String(item.name || '').trim() || `Item ${index + 1}`,
                amount: parseFloat(item.amount),
                category: resolveCategory(item.category)
            }))
            : [];

        const fingerprint = buildReceiptFingerprint({
            merchant,
            billDate,
            totalAmount: parsedTotal,
            items: itemsForFingerprint
        });

        setSaving(true);
        try {
            if (!duplicateAcknowledged) {
                const dupRes = await API.get(
                    `/expenses/receipt-fingerprint?fingerprint=${encodeURIComponent(fingerprint)}`
                );
                if (dupRes.data?.data?.exists) {
                    setDuplicateAcknowledged(true);
                    setDuplicateWarning(
                        'An identical receipt appears to be recorded already. Check your expenses. If this is genuinely a second bill, confirm again to save anyway.'
                    );
                    toast.error('Possible duplicate receipt detected');
                    return;
                }
            }

            if (shouldSaveItemized) {
                const batchPayload = itemsForFingerprint.map(item => ({
                    amount: item.amount,
                    category: item.category,
                    description: (merchant ? `${merchant}: ${item.name}` : item.name).trim() || 'Scanned item',
                    date: billDate,
                    receipt_fingerprint: fingerprint
                }));
                const res = await API.post('/expenses/batch', { items: batchPayload });
                toast.success(res.data.message || `${batchPayload.length} itemized expenses recorded`);
            } else {
                await API.post('/expenses', {
                    amount: parsedTotal,
                    category: resolveCategory(category),
                    date: billDate,
                    description: merchant ? `Bill: ${merchant}` : 'Scanned receipt',
                    receipt_fingerprint: fingerprint
                });
                toast.success('Receipt saved as one expense');
            }

            if (onSuccess) {
                await onSuccess();
            }
            onClose();
        } catch (err) {
            toast.error(err?.message || 'Failed to save scanned expense');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="scanner-modal-title">
            <div className="modal" style={{ maxWidth: '640px', display: 'flex', flexDirection: 'column', maxHeight: '88vh', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <div>
                        <h2 id="scanner-modal-title" className="modal-title">
                            Scan Bill or Receipt
                        </h2>
                        <p className="modal-subtitle">
                            {step === 1
                                ? 'Step 1 of 2: Upload receipt'
                                : saveMode === 'single'
                                    ? 'Step 2 of 2: Review and save as one expense'
                                    : 'Step 2 of 2: Review, split and reconcile'}
                        </p>
                    </div>
                    <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
                        <HiOutlineXMark aria-hidden="true" />
                    </button>
                </div>

                <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
                    {/* STEP 1: Upload or Photograph */}
                    {step === 1 && (
                        <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handleFileSelect}
                                style={{ display: 'none' }}
                                id="bill-file-input"
                            />

                            <div
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    border: '2px dashed var(--border-strong)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '2.5rem 1.5rem',
                                    backgroundColor: 'var(--bg-surface-subtle)',
                                    cursor: 'pointer',
                                    transition: 'border-color var(--transition-fast)'
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                                aria-label="Upload bill photo or document"
                            >
                                <div className="empty-state-icon" style={{ margin: '0 auto 1rem', width: '64px', height: '64px' }}>
                                    <HiOutlineCamera aria-hidden="true" style={{ fontSize: '2rem', color: 'var(--color-primary)' }} />
                                </div>
                                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>
                                    {scanning ? 'Reading bill details...' : 'Select or Photograph a Bill'}
                                </h3>
                                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                                    By default each product line is categorised separately. You can also save the full receipt as one expense.
                                </p>

                                {scanning ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                                        <div className="spinner" style={{ width: '20px', height: '20px' }} />
                                        Extracting merchant, date and line items...
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                                            onClick={handleNativeCamera}
                                        >
                                            <HiOutlineCamera aria-hidden="true" />
                                            Take Photo
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                                            onClick={handleNativeGallery}
                                        >
                                            <HiOutlinePhoto aria-hidden="true" />
                                            Choose from Gallery
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Review, Correct & Reconcile */}
                    {step === 2 && (
                        <div>
                            {scanError ? (
                                <div className="status-banner danger" style={{ marginBottom: '1rem' }}>
                                    <HiOutlineExclamationTriangle className="status-banner-icon" aria-hidden="true" />
                                    <div className="status-banner-text">
                                        <strong>Automatic reading failed.</strong> Enter the receipt manually below. Nothing is saved until you confirm.
                                    </div>
                                </div>
                            ) : (
                                <div className="status-banner good" style={{ marginBottom: '1rem' }}>
                                    <HiOutlineCheck className="status-banner-icon" aria-hidden="true" />
                                    <div className="status-banner-text">
                                        <strong>Bill details extracted.</strong> Review the details and choose how to save this receipt.
                                    </div>
                                </div>
                            )}

                            {aiWarnings.length > 0 && (
                                <div className="status-banner warning" style={{ marginBottom: '1rem' }}>
                                    <HiOutlineExclamationTriangle className="status-banner-icon" aria-hidden="true" />
                                    <div className="status-banner-text">
                                        <strong>OCR notes:</strong> {aiWarnings.join(' ')}
                                    </div>
                                </div>
                            )}

                            {duplicateWarning && (
                                <div className="status-banner danger" style={{ marginBottom: '1rem' }}>
                                    <HiOutlineExclamationTriangle className="status-banner-icon" aria-hidden="true" />
                                    <div className="status-banner-text">
                                        <strong>Possible duplicate.</strong> {duplicateWarning}
                                    </div>
                                </div>
                            )}

                            {/* Image Preview Thumbnail (Collapsible) */}
                            {imagePreview && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem' }}>
                                    <img
                                        src={imagePreview}
                                        alt="Scanned Bill Preview"
                                        style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-color)' }}
                                    />
                                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                        Photo captured. You can re-scan if needed.
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-outline btn-sm"
                                        onClick={handleRescan}
                                    >
                                        <HiOutlineArrowPath aria-hidden="true" /> Re-scan
                                    </button>
                                </div>
                            )}

                            {/* Saving mode */}
                            <div className="form-group">
                                <span className="form-label">How should this receipt be saved?</span>
                                <div
                                    role="radiogroup"
                                    aria-label="Receipt save mode"
                                    style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.5rem' }}
                                >
                                    <label style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '0.5rem',
                                        padding: '0.7rem 0.75rem',
                                        borderRadius: 'var(--radius-sm)',
                                        border: `1px solid ${saveMode === 'split' ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                        background: saveMode === 'split' ? 'var(--color-primary-subtle)' : 'var(--bg-surface-subtle)',
                                        cursor: 'pointer'
                                    }}>
                                        <input
                                            type="radio"
                                            name="receipt-save-mode"
                                            value="split"
                                            checked={saveMode === 'split'}
                                            onChange={() => setSaveMode('split')}
                                            style={{ marginTop: '2px', accentColor: 'var(--color-primary)' }}
                                        />
                                        <span>
                                            <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700 }}>Split & categorize items</span>
                                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                                Save each detected line item as its own expense.
                                            </span>
                                        </span>
                                    </label>

                                    <label style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '0.5rem',
                                        padding: '0.7rem 0.75rem',
                                        borderRadius: 'var(--radius-sm)',
                                        border: `1px solid ${saveMode === 'single' ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                        background: saveMode === 'single' ? 'var(--color-primary-subtle)' : 'var(--bg-surface-subtle)',
                                        cursor: 'pointer'
                                    }}>
                                        <input
                                            type="radio"
                                            name="receipt-save-mode"
                                            value="single"
                                            checked={saveMode === 'single'}
                                            onChange={() => setSaveMode('single')}
                                            style={{ marginTop: '2px', accentColor: 'var(--color-primary)' }}
                                        />
                                        <span>
                                            <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700 }}>Save as one expense</span>
                                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                                Record the full receipt total under the default category.
                                            </span>
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* Merchant / Store */}
                            <div className="form-group">
                                <label htmlFor="scan-merchant" className="form-label">Store / Merchant</label>
                                <input
                                    id="scan-merchant"
                                    type="text"
                                    value={merchant}
                                    onChange={(e) => { setMerchant(e.target.value); markEdited(); }}
                                    className="form-input"
                                    placeholder="e.g. Supermarket, Café, Pharmacy"
                                />
                            </div>

                            {/* Date & Category in 2 columns */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label htmlFor="scan-date" className="form-label">Bill Date</label>
                                    <input
                                        id="scan-date"
                                        type="date"
                                        value={billDate}
                                        onChange={(e) => { setBillDate(e.target.value); markEdited(); }}
                                        className="form-input"
                                        required
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label htmlFor="scan-category" className="form-label">Default Category</label>
                                    <select
                                        id="scan-category"
                                        value={resolveCategory(category)}
                                        onChange={(e) => { setCategory(e.target.value); markEdited(); }}
                                        className="form-select"
                                    >
                                        {categoryNames.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Total Amount */}
                            <div className="form-group">
                                <label htmlFor="scan-total" className="form-label">
                                    Receipt Total <span style={{ color: 'var(--color-danger)' }}>*</span>
                                </label>
                                <div className="input-amount-wrapper">
                                    <span className="input-currency-prefix" aria-hidden="true">₹</span>
                                    <input
                                        id="scan-total"
                                        type="number"
                                        step="any"
                                        min="0.01"
                                        value={totalAmount}
                                        onChange={(e) => { setTotalAmount(e.target.value); markEdited(); }}
                                        className="form-input input-amount-lg num"
                                        placeholder="0.00"
                                        required
                                    />
                                </div>
                            </div>

                            {saveMode === 'single' && (
                                <div className="status-banner info" style={{ marginBottom: '1.25rem' }}>
                                    <HiOutlineInformationCircle className="status-banner-icon" aria-hidden="true" />
                                    <div className="status-banner-text">
                                        <strong>One expense will be saved.</strong> The full receipt total of ₹{formatMoney(parsedTotal)} will be recorded under {resolveCategory(category)}. Detected line items remain available if you switch back.
                                    </div>
                                </div>
                            )}

                            {/* Receipt summary / reconciliation */}
                            {saveMode === 'split' && (
                            <div style={{
                                background: 'var(--bg-surface-subtle)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: '0.875rem 1rem',
                                marginBottom: '1.25rem'
                            }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
                                    Receipt Summary
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Receipt total</span>
                                    <strong className="num">₹{formatMoney(parsedTotal)}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Sum of line items</span>
                                    <strong className="num">₹{formatMoney(itemsTotal)}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', paddingTop: '0.35rem', borderTop: '1px solid var(--border-color)' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Difference</span>
                                    <strong className="num" style={{ color: isBalanced ? 'var(--color-success, #15803d)' : (difference > 0 ? 'var(--color-warning, #b45309)' : 'var(--color-danger)') }}>
                                        {difference > 0 ? '+' : difference < 0 ? '-' : ''}₹{formatMoney(difference)}
                                    </strong>
                                </div>

                                {hasItems && !isBalanced && Number.isFinite(parsedTotal) && parsedTotal > 0 && (
                                    <div style={{ marginTop: '0.625rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                        {difference > 0
                                            ? `The receipt total is ₹${formatMoney(difference)} higher than the line items. This usually covers taxes, discounts or charges that are not itemised. The difference is not distributed across products.`
                                            : `The line items exceed the receipt total by ₹${formatMoney(difference)}. Check the scanned amounts or the receipt total.`}
                                    </div>
                                )}
                            </div>
                            )}

                            {needsDifferenceConfirmation && (
                                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8125rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={receiptConfirmed}
                                        onChange={(e) => setReceiptConfirmed(e.target.checked)}
                                        style={{ width: '18px', height: '18px', marginTop: '1px', accentColor: 'var(--color-primary)' }}
                                    />
                                    <span>
                                        I have reviewed the difference and confirm it is intentional (taxes, discounts or unlisted charges). Do not distribute it across products.
                                    </span>
                                </label>
                            )}

                            {/* Line items */}
                            {saveMode === 'split' ? (
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Line Items ({items.length})</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {hasItems ? 'Each item is saved as its own expense.' : 'No line items detected. This will be saved as one expense.'}
                                        </div>
                                    </div>
                                    <button type="button" className="btn btn-outline btn-sm" onClick={handleAddItem}>
                                        <HiOutlinePlus aria-hidden="true" /> Add Item
                                    </button>
                                </div>

                                {hasItems ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                        {items.map((item, idx) => (
                                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: 'var(--bg-surface-subtle)', padding: '0.625rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <input
                                                        type="text"
                                                        value={item.name}
                                                        onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                                        placeholder="Item name (e.g. Sunflower Oil 1L)"
                                                        className="form-input"
                                                        style={{ flex: 1, height: '36px', fontSize: '0.8125rem' }}
                                                        aria-label={`Item ${idx + 1} name`}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline btn-sm"
                                                        onClick={() => handleRemoveItem(idx)}
                                                        aria-label={`Remove item ${idx + 1}`}
                                                        style={{ minWidth: '36px', height: '36px', padding: 0, color: 'var(--color-danger)' }}
                                                    >
                                                        <HiOutlineTrash aria-hidden="true" />
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <select
                                                        value={resolveCategory(item.category)}
                                                        onChange={(e) => handleItemChange(idx, 'category', e.target.value)}
                                                        className="form-select"
                                                        style={{ flex: 1.4, height: '36px', fontSize: '0.8125rem', padding: '0 6px' }}
                                                        aria-label={`Item ${idx + 1} category`}
                                                    >
                                                        {categoryNames.map(c => (
                                                            <option key={c} value={c}>{c}</option>
                                                        ))}
                                                    </select>
                                                    <div className="input-amount-wrapper" style={{ flex: 1 }}>
                                                        <span style={{ position: 'absolute', left: '8px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>₹</span>
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            min="0.01"
                                                            value={item.amount}
                                                            onChange={(e) => handleItemChange(idx, 'amount', e.target.value)}
                                                            placeholder="Amount"
                                                            className="form-input num"
                                                            style={{ paddingLeft: '1.4rem', height: '36px', fontSize: '0.8125rem' }}
                                                            aria-label={`Item ${idx + 1} amount`}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', paddingTop: '0.25rem' }}>
                                            Items total: <strong className="num" style={{ color: 'var(--color-primary)', marginLeft: '6px' }}>₹{formatMoney(itemsTotal)}</strong>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', background: 'var(--bg-surface-subtle)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.875rem', textAlign: 'center' }}>
                                        No products were detected. Use “Add Item” to split this bill manually, or save it as one expense.
                                    </div>
                                )}
                            </div>
                            ) : (
                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Line Items ({items.length})</div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', background: 'var(--bg-surface-subtle)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.875rem' }}>
                                        {hasItems
                                            ? `${items.length} detected line item${items.length === 1 ? '' : 's'} will not be saved individually. Switch to "Split & categorize items" to edit and save them.`
                                            : 'No line items were detected. The full receipt total will be saved as one expense.'}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Sticky Footer Buttons — Always Visible */}
                <div className="modal-footer" style={{ flexShrink: 0, display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving} style={{ flex: step === 2 ? 1 : 'none' }}>
                        Cancel
                    </button>
                    {step === 2 && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSave}
                            disabled={saving}
                            style={{ flex: 2 }}
                        >
                            {saving
                                ? 'Saving...'
                                : shouldSaveItemized
                                    ? `Save ${items.length} Itemized Expense${items.length === 1 ? '' : 's'}`
                                    : saveMode === 'single'
                                        ? 'Save as One Expense'
                                        : 'Save Expense'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BillScannerModal;
