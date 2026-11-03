import { GoogleGenAI, Modality } from '@google/genai';
import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = 3000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Server-side active key cache
let serverKey = (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1 || '').trim();

function getAllServerKeys(): string[] {
  const envKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5
  ]
    .map(k => (k || '').trim())
    .filter(Boolean);

  const set = new Set<string>();
  if (serverKey) set.add(serverKey);
  for (const k of envKeys) set.add(k);
  return Array.from(set);
}

function resolveApiKey(req?: Request, queryKey?: string): string {
  const headerKey = (req?.headers['x-gemini-key'] as string || '').trim();
  const bodyKey = (req?.body?.apiKey as string || '').trim();
  const qKey = (queryKey || '').trim();
  if (headerKey) return headerKey;
  if (bodyKey) return bodyKey;
  if (qKey) return qKey;
  const all = getAllServerKeys();
  return all[0] || '';
}

function getCandidateKeys(preferredKey?: string): string[] {
  const set = new Set<string>();
  if (preferredKey?.trim()) set.add(preferredKey.trim());
  for (const k of getAllServerKeys()) set.add(k);
  return Array.from(set);
}

function getGenAIClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey: apiKey || 'placeholder-api-key',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

const ANALYSIS_SYSTEM_PROMPT = `You are an elite, direct Personal Financial Advisor for an Indian user. You have analyzed their spending history and baseline across multiple months.

CORE PRINCIPLES:
1. **Dynamic & Authentic**: Provide advice tailored to this user's exact numbers and anomalies. Do NOT recite generic slogans, repetitive mantras, or canned speeches.
2. **Real Solutions, Not Vague Suggestions**: Never say "continue to monitor" or "consider setting a budget". Prescribe specific, calculated targets in Rupees (₹) with estimated savings impact.
3. **Structured & Scannable**:
   - Avoid long essay paragraphs or walls of text.
   - Use headings (### or ####) to separate major points.
   - Summarize key financial metrics with piped stats (e.g. **Income:** ₹X | **Spent:** ₹Y | **Saved:** ₹Z) so they display as clean cards.
   - Use bullet points (* or -) with relevant icons (🚨 for high-risk drains, ⚠️ for warnings, ✅ for wins).
   - Use numbered action steps (1., 2., 3.) for concrete fixes tailored to their primary financial challenges.
   - Use 💡 for key takeaways and 🎯 for targets.
- All amounts in Indian Rupees (₹).`;

const CHAT_SYSTEM_PROMPT = `You are a knowledgeable, direct personal finance advisor for an Indian user. You have their complete financial data (income, monthly spending by category, historical baselines, budget status, micro-spending patterns) provided below.

YOUR JOB:
- Answer the user's specific question using their actual numbers
- Compare current behavior to their own historical baseline whenever relevant
- Be conversational, not robotic — talk like a knowledgeable friend, not a finance textbook
- If they ask "can I afford X?", look at their remaining budget, savings rate, and spending velocity before answering
- If they ask about a category, tell them how it compares to their historical average
- Be honest. If their finances look risky, say so clearly with the specific numbers
- All amounts in Indian Rupees (₹)
- Keep responses focused — 1–3 paragraphs maximum for most questions`;

async function generateWithRetryAndFallback(options: {
  contents: any;
  systemInstruction?: string;
  responseMimeType?: string;
  apiKey?: string;
}) {
  const candidateKeys = getCandidateKeys(options.apiKey);
  if (candidateKeys.length === 0) {
    throw new Error('No Gemini API key configured. Please open AI Settings in the sidebar to add your Gemini API key.');
  }

  const preferredModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const models = Array.from(new Set([
    preferredModel,
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash'
  ])).filter(Boolean);

  let lastError: any = null;

  for (const key of candidateKeys) {
    const client = getGenAIClient(key);
    for (const model of models) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout calling ${model}`)), 12000)
        );
        const callPromise = client.models.generateContent({
          model,
          contents: options.contents,
          config: {
            systemInstruction: options.systemInstruction,
            responseMimeType: options.responseMimeType
          }
        });

        const response: any = await Promise.race([callPromise, timeoutPromise]);
        if (response && (response.text || response.candidates?.length)) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[SERVER AI] Key ending ${key.slice(-4)} model ${model} error:`, err.message || err);
        // If 400 invalid key, immediately try next key
        if (err.status === 400 || err.status === 401 || err.status === 403) {
          break; // move to next candidate key
        }
        // If 429 quota exhausted, try next model or next key
        continue;
      }
    }
  }

  throw lastError || new Error('Gemini models are temporarily busy. Please retry in a moment.');
}

// ─── 1. Health & Config Endpoints ─────────────────────────────────────────────
app.get('/api/health', (req: Request, res: Response) => {
  const activeKey = resolveApiKey(req);
  res.json({
    status: 'ok',
    service: 'financeai-fullstack',
    aiConfigured: Boolean(activeKey),
    model: 'gemini-3.8-flash',
    liveModel: 'gemini-3.8-live',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/ai/configure-key', (req: Request, res: Response) => {
  const { key, keys } = req.body;
  const newKey = (key || (Array.isArray(keys) ? keys[0] : '') || '').trim();
  if (newKey) {
    serverKey = newKey;
    process.env.GEMINI_API_KEY = newKey;
    try {
      fs.writeFileSync(path.resolve(__dirname, '.env'), `GEMINI_API_KEY=${newKey}\n`);
    } catch {
      // In-memory key remains active if disk write fails
    }
    return res.json({ success: true, message: 'Server Gemini API key configured successfully' });
  }
  res.status(400).json({ success: false, message: 'No valid key provided' });
});

// ─── 2. AI Analyze Endpoint ───────────────────────────────────────────────────
app.post('/api/ai/analyze', async (req: Request, res: Response) => {
  try {
    const effectiveKey = resolveApiKey(req);
    const { promptText, context } = req.body;
    const finalPrompt = promptText || (context ? `${context}\n\nBased on the above financial data, provide a structured, scannable personal financial advisor analysis.` : 'Analyze spending trends.');

    const response = await generateWithRetryAndFallback({
      contents: finalPrompt,
      systemInstruction: ANALYSIS_SYSTEM_PROMPT,
      apiKey: effectiveKey
    });

    res.json({
      success: true,
      analysis: response.text || 'No analysis could be generated.'
    });
  } catch (err: any) {
    console.error('[API /api/ai/analyze error]:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to generate financial analysis'
    });
  }
});

// ─── 3. AI Chat Endpoint (Standard) ───────────────────────────────────────────
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const effectiveKey = resolveApiKey(req);
    const { message, orientationContext, history } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const contents: any[] = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history.slice(-6)) {
        contents.push({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }]
        });
      }
    }

    const currentPrompt = orientationContext
      ? `${orientationContext}\n\n[USER QUESTION]\n${message}`
      : message;

    contents.push({
      role: 'user',
      parts: [{ text: currentPrompt }]
    });

    const response = await generateWithRetryAndFallback({
      contents,
      systemInstruction: CHAT_SYSTEM_PROMPT,
      apiKey: effectiveKey
    });

    res.json({
      success: true,
      reply: response.text || 'I checked your accounts, but could not produce a response.'
    });
  } catch (err: any) {
    console.error('[API /api/ai/chat error]:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to process chat message'
    });
  }
});

// ─── 4. AI Chat Streaming Endpoint (SSE) ───────────────────────────────────────
app.post('/api/ai/chat/stream', async (req: Request, res: Response) => {
  const { message, orientationContext, history } = req.body;
  if (!message) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  const effectiveKey = resolveApiKey(req);
  if (!effectiveKey) {
    return res.status(400).json({
      success: false,
      message: 'No Gemini API key configured. Please open AI Settings in the sidebar to add your key.'
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const client = getGenAIClient(effectiveKey);
    const contents: any[] = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history.slice(-6)) {
        contents.push({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }]
        });
      }
    }

    const currentPrompt = orientationContext
      ? `${orientationContext}\n\n[USER QUESTION]\n${message}`
      : message;

    contents.push({
      role: 'user',
      parts: [{ text: currentPrompt }]
    });

    let stream: any = null;
    const candidateKeys = getCandidateKeys(effectiveKey);
    const preferredModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
    const streamModels = Array.from(new Set([
      preferredModel,
      'gemini-2.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash'
    ])).filter(Boolean);

    for (const key of candidateKeys) {
      const client = getGenAIClient(key);
      for (const model of streamModels) {
        try {
          stream = await client.models.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction: CHAT_SYSTEM_PROMPT
            }
          });
          if (stream) break;
        } catch (err: any) {
          console.warn(`[Stream Error key ending ${key.slice(-4)} model ${model}]:`, err.message || err);
          if (err.status === 400 || err.status === 401 || err.status === 403) break;
        }
      }
      if (stream) break;
    }

    if (!stream) {
      throw new Error('Unable to connect stream to Gemini models.');
    }

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    console.error('[API /api/ai/chat/stream error]:', err);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Stream generation failed' })}\n\n`);
    res.end();
  }
});

// ─── 5. AI Receipt Scanner (Vision OCR) ───────────────────────────────────────
app.post('/api/ai/scan-bill', async (req: Request, res: Response) => {
  try {
    const effectiveKey = resolveApiKey(req);
    const { image, mimeType = 'image/jpeg', categories = [] } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, message: 'Image data is required' });
    }

    const cleanBase64 = String(image)
      .replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
      .trim();

    const validCategories = Array.isArray(categories) && categories.length > 0
      ? categories.join(', ')
      : 'Food, Travel, Rent, Entertainment, Shopping, Utilities, Health, Education, Others';

    const prompt = `You are an expert OCR receipt parsing engine for an Indian personal finance app.
Extract the receipt into a single valid JSON object with these fields:
1. "merchant": Store, vendor, shop, hospital, or company name (e.g. "D-Mart", "Swiggy", "Indian Oil"). If unknown, use "Local Store".
2. "totalAmount": The final amount paid in Rupees as a number (e.g. 1450.50). Never invent or estimate this value; use 0 if not readable.
3. "billDate": The date printed on the bill in exact "YYYY-MM-DD" format.
4. "dateDetected": true if date found on bill, false if null.
5. "primaryCategory": The single best category matching exactly one of: [${validCategories}].
6. "summary": A brief 1-sentence description of the bill.
7. "items": An array of clearly listed line items, each with "name", "amount", "category" (matching one of [${validCategories}]). If line items are not distinguishable, return empty array [].
8. "warnings": An array of short warning strings if anything is unreadable.

Rules:
- Use ONLY the category names listed above. Never invent a category.
- Return ONLY valid JSON format.`;

    const response = await generateWithRetryAndFallback({
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType
            }
          },
          { text: prompt }
        ]
      },
      responseMimeType: 'application/json',
      apiKey: effectiveKey
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      success: true,
      message: 'Receipt scanned successfully',
      data: parsed
    });
  } catch (err: any) {
    console.error('[API /api/ai/scan-bill error]:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to scan receipt'
    });
  }
});

// ─── 6. AI SMS Parsing ────────────────────────────────────────────────────────
app.post('/api/ai/parse-sms', async (req: Request, res: Response) => {
  try {
    const effectiveKey = resolveApiKey(req);
    const { messages = [], categories = [] } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const validCategories = Array.isArray(categories) && categories.length > 0
      ? categories.join(', ')
      : 'Food, Travel, Rent, Entertainment, Shopping, Utilities, Health, Education, Others';

    const prompt = `You are a strict financial NLP parser for Indian banking and UPI messages.
Extract only completed money-out (debit/expense) transactions from the messages below.
Valid Categories to assign: [${validCategories}].

Rules:
1. "smsId": The exact "id" from the input message.
2. "merchant": The business, merchant, or person receiving the payment.
3. "amount": The debited amount as a positive number.
4. "date": Transaction date in "YYYY-MM-DD" format.
5. "category": Best matched category from [${validCategories}].
6. "type": "debit".
7. "confidence": A number from 0 to 1.
8. "uncertain": boolean.

Input SMS List:
${JSON.stringify(messages, null, 2)}

Return ONLY a JSON array of extracted debits.`;

    const response = await generateWithRetryAndFallback({
      contents: prompt,
      responseMimeType: 'application/json',
      apiKey: effectiveKey
    });

    const parsed = JSON.parse(response.text || '[]');
    res.json({ success: true, data: parsed });
  } catch (err: any) {
    console.error('[API /api/ai/parse-sms error]:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to parse SMS messages'
    });
  }
});

// ─── 7. Universal Generate Endpoint (for Direct / Legacy calls) ────────────────
app.post('/api/ai/generate', async (req: Request, res: Response) => {
  try {
    const effectiveKey = resolveApiKey(req);
    const payload = req.body;
    let contents: any = payload.contents;

    if (!contents && payload.prompt) {
      contents = payload.prompt;
    }

    const systemInstruction = payload.systemInstruction?.parts?.map((p: any) => p.text).join('\n') || undefined;

    const response = await generateWithRetryAndFallback({
      contents,
      systemInstruction,
      responseMimeType: payload.generationConfig?.responseMimeType,
      apiKey: effectiveKey
    });

    res.json({
      candidates: [
        {
          content: {
            parts: [{ text: response.text || '' }]
          }
        }
      ]
    });
  } catch (err: any) {
    console.error('[API /api/ai/generate error]:', err);
    res.status(500).json({
      error: {
        message: err.message || 'Gemini server processing error',
        status: err.status || 'INTERNAL'
      }
    });
  }
});

// ─── 7b. Download APK endpoint ────────────────────────────────────────────────
app.get(['/api/download/apk', '/FinanceAI.apk'], (_req: Request, res: Response) => {
  const apkPath = path.resolve(__dirname, 'apk/FinanceAI.apk');
  if (fs.existsSync(apkPath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="FinanceAI.apk"');
    res.sendFile(apkPath);
  } else {
    res.status(404).json({ error: 'APK file not found' });
  }
});

// ─── 8. WebSocket Server for Live API (gemini-3.8-live) ───────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
  if (pathname === '/api/ai/live' || pathname === '/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', async (clientWs: WebSocket, request: http.IncomingMessage) => {
  console.log('[Live API WS] Client connected');
  let liveSession: any = null;

  const urlObj = new URL(request.url || '', `http://${request.headers.host}`);
  const queryKey = urlObj.searchParams.get('key') || '';
  const effectiveKey = resolveApiKey(undefined, queryKey);

  if (!effectiveKey) {
    clientWs.send(JSON.stringify({
      error: 'No Gemini API key configured. Please add a key in AI Settings.'
    }));
    clientWs.close();
    return;
  }

  try {
    const client = getGenAIClient(effectiveKey);
    liveSession = await client.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
        },
        systemInstruction: 'You are an intelligent, articulate real-time voice financial advisor for FinanceAI. You have expert knowledge of budgeting, expenses, saving targets in Indian Rupees (₹), and financial health. Answer questions conversationally, concisely, and helpfully.'
      },
      callbacks: {
        onmessage: (message: any) => {
          for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
            }
            if (part.text) {
              clientWs.send(JSON.stringify({ text: part.text }));
            }
          }
          if (message.serverContent?.outputTranscription?.text) {
            clientWs.send(JSON.stringify({ outputTranscript: message.serverContent.outputTranscription.text }));
          }
          if (message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onerror: (err: any) => {
          console.error('[Live API Session error]:', err);
          clientWs.send(JSON.stringify({ error: err.message || 'Live session error' }));
        },
        onclose: () => {
          console.log('[Live API Session closed]');
          clientWs.send(JSON.stringify({ closed: true }));
        }
      }
    });

    clientWs.send(JSON.stringify({ status: 'connected', model: 'gemini-3.8-live' }));
  } catch (err: any) {
    console.error('[Live API Connect error]:', err);
    clientWs.send(JSON.stringify({ error: err.message || 'Failed to connect to Gemini Live' }));
    clientWs.close();
    return;
  }

  clientWs.on('message', (data: Buffer | string) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (!liveSession) return;

      if (parsed.audio) {
        liveSession.sendRealtimeInput({
          audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' }
        });
      } else if (parsed.text) {
        liveSession.sendRealtimeInput({
          text: parsed.text
        });
      }
    } catch (e: any) {
      console.error('[Live API WS parse error]:', e);
    }
  });

  clientWs.on('close', () => {
    console.log('[Live API WS] Client disconnected');
    if (liveSession) {
      try {
        liveSession.close();
      } catch {
        // Closed cleanly
      }
    }
  });
});

// ─── 9. Mount Vite or Serve Static Files ──────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
      root: path.resolve(__dirname, 'client'),
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'client/dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`FinanceAI full-stack server running on http://0.0.0.0:${PORT}`);
    console.log(`Gemini API configured on server: ${Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1 || serverKey)}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
