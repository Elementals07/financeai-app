import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api/axios';
import toast from 'react-hot-toast';

export const useCategories = () => {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchCategories = useCallback(async () => {
        try {
            const res = await API.get('/categories');
            if (Array.isArray(res.data?.data)) {
                setCategories(res.data.data);
            }
        } catch (error) {
            console.error('Failed to load categories', error);
            // Fallback to minimal defaults in case of network error
            setCategories(prev => prev.length > 0 ? prev : [{ id: 0, name: 'Others', color: '#69736C' }]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCategories();
    }, [fetchCategories]);

    const addCategory = async (name, color) => {
        try {
            const res = await API.post('/categories', { name, color });
            if (res.data?.data) {
                setCategories(prev => [...prev, res.data.data]);
            } else {
                await fetchCategories();
            }
            toast.success('Category created successfully');
            return true;
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to add category');
            return false;
        }
    };

    const deleteCategory = async (id) => {
        try {
            await API.delete(`/categories/${id}`);
            setCategories(prev => prev.filter(c => c.id !== id));
            toast.success('Category deleted');
            return true;
        } catch (error) {
            toast.error(error.response?.data?.message || 'Cannot delete system categories');
            return false;
        }
    };

    const updateCategory = async (id, color) => {
        try {
            await API.put(`/categories/${id}`, { color });
            setCategories(prev => prev.map(c => c.id === id ? { ...c, color } : c));
            toast.success('Category color updated');
            return true;
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to update category');
            return false;
        }
    };

    // Helper map for quick color lookups
    const colorMap = useMemo(() => categories.reduce((map, cat) => {
        map[cat.name] = cat.color;
        return map;
    }, {}), [categories]);

    const categoryNames = useMemo(() => categories.map(c => c.name), [categories]);

    return {
        categories,
        categoryNames,
        colorMap,
        loading,
        fetchCategories,
        addCategory,
        deleteCategory,
        updateCategory
    };
};
