require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const aiRoutes = require('./routes/aiRoutes');
const errorHandler = require('./middleware/errorHandler');
const { createRateLimiter } = require('./middleware/rateLimit');
const { defaultService } = require('./services/aiService');

const app = express();
app.disable('x-powered-by');
const PORT = Number(process.env.PORT) || 5000;
const allowedOrigins = [
    ...(process.env.CLIENT_URL || 'http://localhost:5173').split(','),
    'http://localhost:5173',
    'http://localhost',
    'https://localhost',
    'capacitor://localhost'
]
    .map(origin => origin.trim())
    .filter(Boolean);

app.set('trust proxy', 1);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        const error = new Error('Origin is not allowed.');
        error.statusCode = 403;
        return callback(error);
    }
}));

app.use(express.json({ limit: '12mb' }));

const rateLimiter = createRateLimiter({
    max: Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 30
});

app.use('/api/ai', rateLimiter, aiRoutes);

app.get('/api/health', (req, res) => {
    const keyCount = defaultService.getKeyCount();
    res.status(keyCount > 0 ? 200 : 503).json({
        success: keyCount > 0,
        service: 'financeai-ai-proxy',
        ai: {
            configured: keyCount > 0,
            keyCount,
            model: defaultService.getModel()
        },
        timestamp: new Date().toISOString()
    });
});

app.use(errorHandler);

if (require.main === module) {
    app.listen(PORT, () => {
        const keyCount = defaultService.getKeyCount();
        console.log(`FinanceAI AI proxy listening on http://localhost:${PORT}`);
        console.log(`Active Gemini keys: ${keyCount}`);
        if (keyCount === 0) {
            console.warn('No Gemini keys configured. Set GEMINI_API_KEY_1..5 in server/.env.');
        }
    });
}

module.exports = app;
