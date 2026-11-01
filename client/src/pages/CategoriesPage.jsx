import { useState } from 'react';
import { useCategories } from '../hooks/useCategories';
import { 
    HiOutlinePlus, 
    HiOutlineTrash, 
    HiOutlinePencilSquare, 
    HiOutlineCheck, 
    HiOutlineXMark,
    HiOutlineTag,
    HiOutlineExclamationTriangle,
    HiOutlineInformationCircle
} from 'react-icons/hi2';
import toast from 'react-hot-toast';

// Curated accessible color palette with human-readable labels
const PALETTE = [
    { hex: '#2D3FBF', name: 'Deep Indigo' },
    { hex: '#0EA5C9', name: 'Electric Teal' },
    { hex: '#3B82F6', name: 'Sky Blue' },
    { hex: '#EF4444', name: 'Bright Red' },
    { hex: '#8B5CF6', name: 'Violet' },
    { hex: '#EC4899', name: 'Pink' },
    { hex: '#F59E0B', name: 'Amber' },
    { hex: '#10B981', name: 'Emerald' },
    { hex: '#6366F1', name: 'Indigo' },
    { hex: '#6B7280', name: 'Slate Grey' }
];

const CategoriesPage = () => {
    const { categories, addCategory, deleteCategory, updateCategory, loading } = useCategories();
    const [newName, setNewName] = useState('');
    const [selectedColor, setSelectedColor] = useState(PALETTE[0].hex);
    const [isCreating, setIsCreating] = useState(false);
    
    // Category being edited
    const [editingCategory, setEditingCategory] = useState(null);
    const [editColor, setEditColor] = useState('');
    
    // Category pending deletion confirmation
    const [deletingCategory, setDeletingCategory] = useState(null);

    const handleAdd = async (e) => {
        e.preventDefault();
        const trimmed = newName.trim();
        if (!trimmed) {
            toast.error('Please enter a category name');
            return;
        }

        const success = await addCategory(trimmed, selectedColor);
        if (success) {
            setNewName('');
            setIsCreating(false);
        }
    };

    const handleUpdateColor = async (id, color) => {
        const success = await updateCategory(id, color);
        if (success) {
            setEditingCategory(null);
        }
    };

    const handleConfirmDelete = async () => {
        if (!deletingCategory) return;
        await deleteCategory(deletingCategory.id);
        setDeletingCategory(null);
    };

    return (
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
            {/* Page Header */}
            <div className="page-header">
                <div className="page-header-row">
                    <div>
                        <div className="page-tag">Organization</div>
                        <h1 className="page-title">Spending Categories</h1>
                        <p className="page-subtitle">
                            Organize your expenses into distinct categories and colors to track where your money goes.
                        </p>
                    </div>

                    {!isCreating && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setIsCreating(true)}
                        >
                            <HiOutlinePlus aria-hidden="true" />
                            Create Category
                        </button>
                    )}
                </div>
            </div>

            {/* Creation Card */}
            {isCreating && (
                <div className="card" style={{ marginBottom: '1.5rem', border: '2px solid var(--color-primary)' }}>
                    <div className="card-header">
                        <h2 className="card-title">New Spending Category</h2>
                        <button 
                            type="button" 
                            className="btn btn-outline btn-sm"
                            onClick={() => { setIsCreating(false); setNewName(''); }}
                        >
                            <HiOutlineXMark aria-hidden="true" /> Cancel
                        </button>
                    </div>

                    <form onSubmit={handleAdd}>
                        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                            <label htmlFor="category-name-input" className="form-label">
                                Category Name <span style={{ color: 'var(--color-danger)' }}>*</span>
                            </label>
                            <input
                                id="category-name-input"
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g. Subscriptions, Hobbies, Pet Care"
                                className="form-input"
                                autoFocus
                                required
                            />
                        </div>

                        {/* Accessible Color Swatches */}
                        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                            <label className="form-label">Category Color</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
                                {PALETTE.map(({ hex, name }) => {
                                    const isSelected = selectedColor === hex;
                                    return (
                                        <button
                                            key={hex}
                                            type="button"
                                            onClick={() => setSelectedColor(hex)}
                                            title={name}
                                            aria-label={`Select ${name} color`}
                                            style={{
                                                width: '38px',
                                                height: '38px',
                                                borderRadius: 'var(--radius-sm)',
                                                backgroundColor: hex,
                                                border: isSelected ? '3px solid var(--color-primary)' : '2px solid #FFFFFF',
                                                boxShadow: isSelected ? '0 0 0 2px var(--color-primary)' : '0 1px 3px rgba(0,0,0,0.2)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#FFFFFF'
                                            }}
                                        >
                                            {isSelected && <HiOutlineCheck style={{ strokeWidth: 3 }} />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => setIsCreating(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                            >
                                <HiOutlineCheck aria-hidden="true" />
                                Save Category
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Categories List Table */}
            <div className="table-card">
                <div className="table-header">
                    <div>
                        <h2 className="card-title">All Categories</h2>
                        <p className="card-subtitle">Default system categories and custom ones</p>
                    </div>
                </div>

                {loading ? (
                    <div style={{ padding: '1.5rem' }}>
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="loading-skeleton" style={{ height: '44px', marginBottom: '0.5rem' }} />
                        ))}
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th scope="col" style={{ width: '40px' }}>Color</th>
                                    <th scope="col">Category Name</th>
                                    <th scope="col" style={{ width: '130px' }}>Type</th>
                                    <th scope="col" style={{ textAlign: 'right', width: '160px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categories.map(cat => {
                                    const isGlobal = !cat.user_id;
                                    const isEditing = editingCategory?.id === cat.id;

                                    return (
                                        <tr key={cat.id || cat.name}>
                                            <td>
                                                <span
                                                    className="category-dot"
                                                    style={{ backgroundColor: isEditing ? editColor : cat.color, width: '14px', height: '14px' }}
                                                    aria-hidden="true"
                                                />
                                            </td>
                                            <td>
                                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                    {cat.name}
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isGlobal ? 'var(--text-muted)' : 'var(--color-primary)' }}>
                                                    {isGlobal ? 'System Default' : 'Custom'}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                {isEditing ? (
                                                    <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                                                        <select
                                                            value={editColor}
                                                            onChange={(e) => setEditColor(e.target.value)}
                                                            className="form-select"
                                                            style={{ minHeight: '32px', padding: '0.2rem 0.5rem', fontSize: '0.8rem', width: 'auto' }}
                                                            aria-label="Choose new color"
                                                        >
                                                            {PALETTE.map(p => (
                                                                <option key={p.hex} value={p.hex}>{p.name}</option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            type="button"
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => handleUpdateColor(cat.id, editColor)}
                                                            title="Save color"
                                                        >
                                                            <HiOutlineCheck aria-hidden="true" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline btn-sm"
                                                            onClick={() => setEditingCategory(null)}
                                                            title="Cancel"
                                                        >
                                                            <HiOutlineXMark aria-hidden="true" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline btn-sm"
                                                            onClick={() => { setEditingCategory(cat); setEditColor(cat.color); }}
                                                            aria-label={`Change color for ${cat.name}`}
                                                            style={{ minHeight: '34px', padding: '0 8px' }}
                                                        >
                                                            <HiOutlinePencilSquare aria-hidden="true" />
                                                            <span>Color</span>
                                                        </button>
                                                        {!isGlobal && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-danger-outline btn-sm"
                                                                onClick={() => setDeletingCategory(cat)}
                                                                aria-label={`Delete custom category ${cat.name}`}
                                                                style={{ minHeight: '34px', padding: '0 8px' }}
                                                            >
                                                                <HiOutlineTrash aria-hidden="true" />
                                                                <span>Delete</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Deletion Explanation Modal */}
            {deletingCategory && (
                <div className="modal-overlay" onClick={() => setDeletingCategory(null)} role="dialog" aria-modal="true">
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Delete Category: {deletingCategory.name}</h2>
                            <button type="button" className="modal-close-btn" onClick={() => setDeletingCategory(null)}>
                                <HiOutlineXMark aria-hidden="true" />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="status-banner warning" style={{ marginBottom: '1rem' }}>
                                <HiOutlineExclamationTriangle className="status-banner-icon" aria-hidden="true" />
                                <div className="status-banner-text">
                                    <strong>What happens to existing expenses:</strong> Deleting &ldquo;{deletingCategory.name}&rdquo; will automatically reassign any past expenses in this category to &ldquo;Others&rdquo;. Your previous transactions and financial amounts will not be erased.
                                </div>
                            </div>
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                Are you sure you want to permanently remove this category?
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-outline" onClick={() => setDeletingCategory(null)}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-danger" onClick={handleConfirmDelete}>
                                Yes, Delete Category
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CategoriesPage;
