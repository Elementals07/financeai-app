import { Capacitor } from '@capacitor/core';
import { localGeminiService } from './localGeminiService';
import { localExpenseService } from './localExpenseService';
import { isExcludedSmsBody } from './financeParsers';

const MAX_MESSAGES = 60;

function dedupeById(messages) {
    const seen = new Set();
    return messages.filter(message => {
        const id = String(message?.id ?? '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

export const smsService = {
    isAvailable() {
        return Capacitor.isNativePlatform() && Boolean(Capacitor.Plugins.SmsReader);
    },

    /**
     * Reads recent bank/UPI debit messages from the device inbox, excluding
     * messages already persisted as transactions and strong non-transaction
     * patterns. No message content is logged here.
     */
    async fetchRecentBankSms(days = 30) {
        if (!this.isAvailable()) {
            throw new Error('Bank SMS sync is only available in the FinanceAI Android app.');
        }

        const safeDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);
        const res = await Capacitor.Plugins.SmsReader.getRecentBankSms({ days: safeDays });
        const rawMessages = Array.isArray(res?.messages) ? res.messages : [];

        const processedIds = new Set(await localExpenseService.getProcessedSmsIds());

        const candidates = dedupeById(rawMessages)
            .filter(message => message && message.body)
            .filter(message => !isExcludedSmsBody(message.body))
            .filter(message => !processedIds.has(String(message.id)))
            .slice(0, MAX_MESSAGES);

        return candidates;
    },

    /**
     * Sends only locally filtered messages to the AI backend for structured parsing.
     */
    async analyzeSmsWithAI(messages) {
        if (!Array.isArray(messages) || messages.length === 0) return [];
        return await localGeminiService.parseBankSms(messages);
    }
};

export default smsService;
