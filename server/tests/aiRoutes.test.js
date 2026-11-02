const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

let mockGemini;
let appServer;
let baseUrl;

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function textResponse(text) {
    return {
        candidates: [{
            content: {
                role: 'model',
                parts: [{ text }]
            }
        }]
    };
}

function startMockGemini() {
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            let payload = {};
            try {
                payload = JSON.parse(raw);
            } catch {
                return sendJson(res, 400, { error: 'invalid JSON' });
            }

            const contents = Array.isArray(payload.contents) ? payload.contents : [];
            const serialized = JSON.stringify(contents);

            if (serialized.includes('inlineData')) {
                return sendJson(res, 200, textResponse(JSON.stringify({
                    merchant: 'D-MART',
                    totalAmount: 250,
                    billDate: '2026-11-02',
                    primaryCategory: 'Groceries',
                    items: []
                })));
            }

            if (serialized.includes('SMS:')) {
                return sendJson(res, 200, textResponse(JSON.stringify([{
                    smsId: '1',
                    merchant: 'Swiggy',
                    amount: 250,
                    date: '2026-11-02',
                    category: 'Food',
                    type: 'debit',
                    confidence: 0.99,
                    uncertain: false
                }])));
            }

            if (Array.isArray(payload.tools) && serialized.includes('functionResponse')) {
                return sendJson(res, 200, textResponse('You spent 1234 total.'));
            }

            if (Array.isArray(payload.tools)) {
                return sendJson(res, 200, {
                    candidates: [{
                        content: {
                            role: 'model',
                            parts: [{
                                functionCall: {
                                    name: 'get_period_summary',
                                    args: { startMonth: '2026-09', endMonth: '2026-10' }
                                }
                            }]
                        }
                    }]
                });
            }

            return sendJson(res, 200, textResponse('OK'));
        });
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function postGenerate(payload, headers = {}) {
    return fetch(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload)
    });
}

function candidateText(response) {
    return (response?.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || '')
        .join('\n')
        .trim();
}

test.before(async () => {
    mockGemini = await startMockGemini();

    process.env.GEMINI_ENDPOINT = `http://127.0.0.1:${mockGemini.address().port}/v1beta`;
    process.env.GEMINI_API_KEY_1 = 'test-key-one';
    process.env.GEMINI_API_KEY_2 = 'test-key-two';
    process.env.GEMINI_API_KEY_3 = '';
    process.env.GEMINI_API_KEY_4 = '';
    process.env.GEMINI_API_KEY_5 = '';
    process.env.AI_RATE_LIMIT_PER_MINUTE = '100';

    const app = require('../server');
    appServer = app.listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    baseUrl = `http://127.0.0.1:${appServer.address().port}/api/ai`;
});

test.after(async () => {
    if (appServer) await new Promise(resolve => appServer.close(resolve));
    if (mockGemini) await new Promise(resolve => mockGemini.close(resolve));
});

test('health reports the configured key count without exposing keys', async () => {
    const response = await fetch(baseUrl.replace('/ai', '/health'));
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ai.configured, true);
    assert.equal(data.ai.keyCount, 2);
    assert.doesNotMatch(JSON.stringify(data), /test-key/);
});

test('analysis payloads pass through the proxy', async () => {
    const response = await postGenerate({
        systemInstruction: { parts: [{ text: 'Be terse.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }]
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(candidateText(data), 'OK');
});

test('tool-enabled chat supports a follow-up function response', async () => {
    const tools = [{
        functionDeclarations: [{
            name: 'get_period_summary',
            description: 'Get totals.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    startMonth: { type: 'STRING' },
                    endMonth: { type: 'STRING' }
                },
                required: ['startMonth', 'endMonth']
            }
        }]
    }];
    const contents = [{ role: 'user', parts: [{ text: 'Use get_period_summary.' }] }];

    const first = await postGenerate({ contents, tools });
    const firstData = await first.json();
    const functionCall = firstData.candidates[0].content.parts[0].functionCall;

    assert.equal(functionCall.name, 'get_period_summary');

    contents.push(firstData.candidates[0].content);
    contents.push({
        role: 'user',
        parts: [{
            functionResponse: {
                name: functionCall.name,
                response: { totalSpent: 1234 }
            }
        }]
    });

    const second = await postGenerate({ contents, tools });
    const secondData = await second.json();

    assert.equal(second.status, 200);
    assert.match(candidateText(secondData), /1234/);
});

test('receipt OCR payloads pass through the proxy', async () => {
    const response = await postGenerate({
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { data: 'ZmFrZQ==', mimeType: 'image/jpeg' } },
                { text: 'Extract the receipt.' }
            ]
        }],
        generationConfig: { responseMimeType: 'application/json' }
    });
    const data = await response.json();
    const receipt = JSON.parse(candidateText(data));

    assert.equal(response.status, 200);
    assert.equal(receipt.merchant, 'D-MART');
    assert.equal(receipt.totalAmount, 250);
});

test('SMS parsing payloads pass through the proxy', async () => {
    const response = await postGenerate({
        contents: [{
            role: 'user',
            parts: [{ text: 'SMS: Debited Rs.250 to swiggy@okaxis' }]
        }],
        generationConfig: { responseMimeType: 'application/json' }
    });
    const data = await response.json();
    const transactions = JSON.parse(candidateText(data));

    assert.equal(response.status, 200);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].amount, 250);
});

test('accepts the Capacitor app origin', async () => {
    const response = await postGenerate({
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }]
    }, { Origin: 'capacitor://localhost' });

    assert.equal(response.status, 200);
});

test('rejects malformed payloads before calling Gemini', async () => {
    const response = await postGenerate({ contents: [] });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.code, 'AI_INVALID_REQUEST');
});
