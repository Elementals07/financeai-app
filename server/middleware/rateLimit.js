function createRateLimiter({ windowMs = 60000, max = 30 } = {}) {
    const buckets = new Map();

    return function rateLimiter(req, res, next) {
        if (!Number.isFinite(max) || max <= 0) return next();

        const now = Date.now();
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        const bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            if (buckets.size > 10000) {
                for (const [bucketKey, value] of buckets) {
                    if (value.resetAt <= now) buckets.delete(bucketKey);
                }
            }
            return next();
        }

        if (bucket.count >= max) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                success: false,
                code: 'AI_RATE_LIMITED',
                message: 'Too many AI requests. Please try again shortly.'
            });
        }

        bucket.count += 1;
        return next();
    };
}

module.exports = { createRateLimiter };
