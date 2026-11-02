module.exports = function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    if (err?.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            code: 'AI_REQUEST_TOO_LARGE',
            message: 'The AI request is too large. Try a smaller image.'
        });
    }

    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            code: 'AI_INVALID_REQUEST',
            message: 'The AI request body is not valid JSON.'
        });
    }

    const statusCode = Number(err?.statusCode) || 500;
    if (statusCode >= 500) {
        console.error('[SERVER] Unhandled error:', err?.message || 'Unknown error');
    }

    return res.status(statusCode).json({
        success: false,
        code: statusCode >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED',
        message: statusCode >= 500 ? 'Internal server error.' : 'Request failed.'
    });
};
