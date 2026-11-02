import { Capacitor } from '@capacitor/core';
import localGeminiService from './localGeminiService';

const PROCESSED_SMS_KEY = 'financeai_processed_sms_ids';

function getProcessedIds() {
    try {
        const stored = localStorage.getItem(PROCESSED_SMS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function saveProcessedId(id) {
    try {
        const ids = getProcessedIds();
        if (!ids.includes(String(id))) {
            ids.push(String(id));
            localStorage.setItem(PROCESSED_SMS_KEY, JSON.stringify(ids.slice(-300))); // keep last 300
        }
    } catch (e) {
        console.error('Failed to save processed SMS id', e);
    }
}

// Sample fallback bank messages for testing/demo on web or when no SMS found
const SAMPLE_BANK_SMS = [
    {
        id: 'mock-1',
        address: 'VM-HDFCBK',
        body: 'Alert: Rs 340.00 debited from A/C **1204 to Swiggy on 01-Nov-26 via UPI Ref 630419482. Avl Bal Rs 42,100.',
        date: Date.now() - 3600000 * 2
    },
    {
        id: 'mock-2',
        address: 'VK-SBIINB',
        body: 'Dear SBI User, your A/C 9081 has a debit of INR 1,299.00 on 31-Oct-26 towards Amazon India. UPI: 6301289410.',
        date: Date.now() - 3600000 * 24
    },
    {
        id: 'mock-3',
        address: 'AX-AXISBK',
        body: 'Paid Rs 750.00 to Shell Petrol Pump via UPI Ref 62981745 on 30-Oct-26 from Axis Bank A/C *445.',
        date: Date.now() - 3600000 * 48
    }
];

export const smsService = {
    /**
     * Reads recent bank/UPI debit messages from device SMS inbox
     * Filters out already imported/processed transactions
     */
    async fetchRecentBankSms(days = 30) {
        const processedIds = getProcessedIds();
        let rawMessages = [];

        if (Capacitor.isNativePlatform() && Capacitor.Plugins.SmsReader) {
            try {
                const res = await Capacitor.Plugins.SmsReader.getRecentBankSms({ days });
                rawMessages = res.messages || [];
            } catch (err) {
                console.warn('Native SMS Reader error or permission denied:', err);
                throw err;
            }
        } else {
            // Web fallback
            rawMessages = SAMPLE_BANK_SMS;
        }

        // Filter out already processed messages
        const unparsed = rawMessages.filter(m => !processedIds.includes(String(m.id)));
        return unparsed;
    },

    /**
     * Sends raw messages to Gemini to extract structured expenses
     */
    async analyzeSmsWithAI(messages) {
        if (!messages || messages.length === 0) return [];
        return await localGeminiService.parseBankSms(messages);
    },

    /**
     * Mark an SMS ID as processed
     */
    markProcessed(id) {
        saveProcessedId(id);
    }
};

export default smsService;
