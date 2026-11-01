import { useState, useRef, useEffect } from 'react';
import API from '../../api/axios';
import toast from 'react-hot-toast';
import { useCategories } from '../../hooks/useCategories';
import { cameraService } from '../../services/cameraService';
import { 
    HiOutlineCamera, 
    HiOutlinePhoto,
    HiOutlineArrowPath, 
    HiOutlineCheck, 
    HiOutlineXMark,
    HiOutlineDocumentText,
    HiOutlinePlus,
    HiOutlineTrash
} from 'react-icons/hi2';

const BillScannerModal = ({ onClose, onSuccess }) => {
    const { categoryNames } = useCategories();
    const fileInputRef = useRef(null);

    const [imagePreview, setImagePreview] = useState(null);
    const [mimeType, setMimeType] = useState('image/jpeg');
    const [scanning, setScanning] = useState(false);
    const [saving, setSaving] = useState(false);

    // Step state: 1 = Upload, 2 = Review & Edit, 3 = Confirmation
    const [step, setStep] = useState(1);

    // Scanned & user-editable fields
    const [merchant, setMerchant] = useState('');
    const [totalAmount, setTotalAmount] = useState('');
    const [category, setCategory] = useState(categoryNames[0] || 'Food');
    const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [splitItems, setSplitItems] = useState(false);
    const [items, setItems] = useState([]);

    // Handle Escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

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
            console.error('Camera error:', err);
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
            console.error('Gallery error:', err);
        }
    };

    // Send to OCR API endpoint
    const processImageScan = async (base64, type) => {
        setScanning(true);
        try {
            const res = await API.post('/ai/scan-bill', {
                image: base64,
                mimeType: type || mimeType
            });

            const data = res.data.data;
            setMerchant(data.merchant || '');
            setTotalAmount(data.totalAmount ? String(data.totalAmount) : '');
            
            if (data.primaryCategory && categoryNames.includes(data.primaryCategory)) {
                setCategory(data.primaryCategory);
            } else if (categoryNames.length > 0) {
                setCategory(categoryNames[0]);
            }

            if (data.billDate) {
                setBillDate(data.billDate);
            } else {
                setBillDate(new Date().toISOString().slice(0, 10));
            }

            if (Array.isArray(data.items) && data.items.length > 1) {
                setItems(data.items.map(it => ({
                    name: it.name || '',
                    amount: it.amount ? String(it.amount) : '',
                    category: categoryNames.includes(it.category) ? it.category : (categoryNames[0] || 'Food')
                })));
            } else {
                setItems([]);
                setSplitItems(false);
            }

            setStep(2); // Move to review step
            toast.success('Bill scanned successfully! Please review details.');
        } catch (err) {
            toast.error('Could not auto-read the bill. You can still enter details manually.');
            setStep(2); // Allow manual entry even if scanning had issues
        } finally {
            setScanning(false);
        }
    };

    const handleItemChange = (index, field, value) => {
        const updated = [...items];
        updated[index][field] = value;
        setItems(updated);
    };

    const handleRemoveItem = (index) => {
        const updated = items.filter((_, i) => i !== index);
        setItems(updated);
        if (updated.length <= 1) {
            setSplitItems(false);
        }
    };

    const handleAddItem = () => {
        setItems([...items, { name: '', amount: '', category: categoryNames[0] || 'Food' }]);
    };

    const itemsTotal = items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

    const handleSave = async () => {
        // Validation before saving
        if (splitItems) {
            if (items.length === 0) {
                toast.error('Add at least one item or uncheck itemized breakdown');
                return;
            }
            for (const it of items) {
                if (!it.amount || isNaN(parseFloat(it.amount)) || parseFloat(it.amount) <= 0) {
                    toast.error(`Please specify a valid amount for all items`);
                    return;
                }
            }
        } else {
            const parsed = parseFloat(totalAmount);
            if (!totalAmount || isNaN(parsed) || parsed <= 0) {
                toast.error('Please enter a valid bill amount');
                return;
            }
        }

        setSaving(true);
        try {
            if (splitItems && items.length > 0) {
                // Batch create items
                const batchPayload = items.map(it => ({
                    amount: parseFloat(it.amount),
                    category: it.category || category,
                    description: (merchant ? `${merchant}: ${it.name}` : it.name).trim() || 'Scanned item',
                    date: billDate
                }));
                await API.post('/expenses/batch', { items: batchPayload });
                toast.success(`${items.length} itemized expenses recorded!`);
            } else {
                // Single expense
                await API.post('/expenses', {
                    amount: parseFloat(totalAmount),
                    category,
                    date: billDate,
                    description: merchant ? `Bill: ${merchant}` : 'Scanned receipt'
                });
                toast.success('Bill expense recorded successfully!');
            }

            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save scanned expense');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="scanner-modal-title">
            <div className="modal" style={{ maxWidth: '620px' }} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header">
                    <div>
                        <h2 id="scanner-modal-title" className="modal-title">
                            Scan Bill or Receipt
                        </h2>
                        <p className="modal-subtitle">
                            {step === 1 ? 'Step 1 of 2: Upload receipt' : 'Step 2 of 2: Review and confirm values'}
                        </p>
                    </div>
                    <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
                        <HiOutlineXMark aria-hidden="true" />
                    </button>
                </div>

                <div className="modal-body">
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
                                    Supports grocery receipts, restaurant bills, and invoices (JPG, PNG, WebP)
                                </p>
                                
                                {scanning ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                                        <div className="spinner" style={{ width: '20px', height: '20px' }} />
                                        Extracting merchant, date, and amounts...
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

                    {/* STEP 2: Review, Correct & Confirm */}
                    {step === 2 && (
                        <div>
                            {/* Scanning Feedback Alert */}
                            <div className="status-banner good" style={{ marginBottom: '1.25rem' }}>
                                <HiOutlineCheck className="status-banner-icon" aria-hidden="true" />
                                <div className="status-banner-text">
                                    <strong>Bill details extracted.</strong> Please review and adjust any field below before confirming.
                                </div>
                            </div>

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
                                        onClick={() => { setStep(1); setImagePreview(null); }}
                                    >
                                        <HiOutlineArrowPath aria-hidden="true" /> Re-scan
                                    </button>
                                </div>
                            )}

                            {/* Merchant / Store */}
                            <div className="form-group">
                                <label htmlFor="scan-merchant" className="form-label">Store / Merchant</label>
                                <input
                                    id="scan-merchant"
                                    type="text"
                                    value={merchant}
                                    onChange={(e) => setMerchant(e.target.value)}
                                    className="form-input"
                                    placeholder="e.g. Supermarket, Café, Pharmacy"
                                />
                            </div>

                            {/* Date & Category in 2 columns */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label htmlFor="scan-date" className="form-label">Date</label>
                                    <input
                                        id="scan-date"
                                        type="date"
                                        value={billDate}
                                        onChange={(e) => setBillDate(e.target.value)}
                                        className="form-input"
                                        required
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label htmlFor="scan-category" className="form-label">Category</label>
                                    <select
                                        id="scan-category"
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
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
                                    Total Amount <span style={{ color: 'var(--color-danger)' }}>*</span>
                                </label>
                                <div className="input-amount-wrapper">
                                    <span className="input-currency-prefix" aria-hidden="true">₹</span>
                                    <input
                                        id="scan-total"
                                        type="number"
                                        step="any"
                                        min="0.01"
                                        value={totalAmount}
                                        onChange={(e) => setTotalAmount(e.target.value)}
                                        className="form-input input-amount-lg num"
                                        placeholder="0.00"
                                        required
                                    />
                                </div>
                            </div>

                            {/* Optional Itemized Split */}
                            {items.length > 0 && (
                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                        <input
                                            type="checkbox"
                                            id="split-items-checkbox"
                                            checked={splitItems}
                                            onChange={(e) => setSplitItems(e.target.checked)}
                                            style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }}
                                        />
                                        <label htmlFor="split-items-checkbox" style={{ fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}>
                                            Record as {items.length} separate items (Itemized)
                                        </label>
                                    </div>

                                    {splitItems && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--bg-surface-subtle)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
                                            {items.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <input
                                                        type="text"
                                                        value={item.name}
                                                        onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                                        placeholder="Item name"
                                                        className="form-input"
                                                        style={{ flex: 2, height: '36px', fontSize: '0.8125rem' }}
                                                    />
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        value={item.amount}
                                                        onChange={(e) => handleItemChange(idx, 'amount', e.target.value)}
                                                        placeholder="Amount"
                                                        className="form-input num"
                                                        style={{ flex: 1, height: '36px', fontSize: '0.8125rem' }}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline btn-sm"
                                                        onClick={() => handleRemoveItem(idx)}
                                                        aria-label="Remove item"
                                                        style={{ minWidth: '36px', height: '36px', padding: 0 }}
                                                    >
                                                        <HiOutlineTrash aria-hidden="true" />
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                className="btn btn-outline btn-sm"
                                                onClick={handleAddItem}
                                                style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
                                            >
                                                <HiOutlinePlus aria-hidden="true" /> Add Line Item
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div className="modal-footer">
                    <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    {step === 2 && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? 'Recording...' : 'Confirm & Save Expense'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BillScannerModal;
