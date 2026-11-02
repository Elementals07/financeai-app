const express = require('express');
const { AiServiceError, defaultService } = require('../services/aiService');

const router = express.Router();

router.post('/generate', async (req, res, next) => {
    try {
        const result = await defaultService.request(req.body);
        res.json(result);
    } catch (error) {
        if (error instanceof AiServiceError) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
        next(error);
    }
});

module.exports = router;
