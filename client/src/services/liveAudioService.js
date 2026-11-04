/**
 * Live Audio Service for the Gemini Live API.
 *
 * Connects directly to Google's BidiGenerateContent WebSocket using the API
 * key stored on the device. This avoids depending on `window.location.host`,
 * which points at the Capacitor asset host (https://localhost) inside an
 * Android WebView and therefore cannot reach a development server.
 */

import { logAiEvent } from './aiLogger.js';

const LIVE_WS_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const LIVE_MODELS = [
  'gemini-3.8-live',
  'gemini-live-2.5-flash-native-audio',
  'gemini-2.0-flash-live-001'
];
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const SETUP_TIMEOUT_MS = 15000;

const LIVE_SYSTEM_PROMPT = 'You are an intelligent, articulate real-time voice financial advisor for FinanceAI. You have expert knowledge of budgeting, expenses, saving targets in Indian Rupees (₹), and financial health. Answer questions conversationally, concisely, and helpfully.';

function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function downsampleBuffer(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    result[i] = end > start ? sum / (end - start) : 0;
  }
  return result;
}

function base64ToFloat32Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function parseWsPayload(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return JSON.parse(await data.text());
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data));
  }
  if (ArrayBuffer.isView(data)) {
    return JSON.parse(new TextDecoder().decode(data));
  }
  return JSON.parse(String(data));
}

function sanitizeLiveError(message) {
  return String(message || '')
    .replace(/AIza[0-9A-Za-z_.-]+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export class LiveAudioSession {
  constructor({ onMessage, onStateChange, onError, apiKey }) {
    this.onMessage = onMessage || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});
    this.apiKey = apiKey || '';
    this.ws = null;
    this.pendingWs = null;
    this.pendingReject = null;
    this.inputAudioCtx = null;
    this.outputAudioCtx = null;
    this.mediaStream = null;
    this.processor = null;
    this.source = null;
    this.inputSampleRate = INPUT_SAMPLE_RATE;
    this.nextStartTime = 0;
    this.activeSources = [];
    this.connected = false;
    this.cancelled = false;
    this.activeModel = null;
  }

  async start() {
    if (!this.apiKey) {
      throw new Error('No Gemini API key configured. Open AI Settings and add a key first.');
    }

    this.cancelled = false;
    this.onStateChange('connecting');
    logAiEvent('live.start', { models: LIVE_MODELS });

    try {
      await this.openMicrophone();
      logAiEvent('live.microphone-ready');
      if (this.cancelled) throw new Error('Live voice session cancelled.');

      let lastError = null;
      for (const model of LIVE_MODELS) {
        if (this.cancelled) throw new Error('Live voice session cancelled.');
        try {
          logAiEvent('live.connect', { model });
          await this.connectModel(model);
          this.activeModel = model;
          this.connected = true;
          this.startAudioStream();
          logAiEvent('live.connected', { model });
          this.onStateChange('active');
          return;
        } catch (err) {
          lastError = err;
          logAiEvent('live.connect-failed', { model, reason: err.message });
        }
      }

      throw lastError || new Error('Could not connect to the Gemini Live API.');
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  async openMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not available in this environment.');
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: INPUT_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Audio playback is not supported in this environment.');
    }

    try {
      this.inputAudioCtx = new AudioCtx({ sampleRate: INPUT_SAMPLE_RATE });
    } catch {
      this.inputAudioCtx = new AudioCtx();
    }
    this.outputAudioCtx = new AudioCtx();
    this.inputSampleRate = this.inputAudioCtx.sampleRate || INPUT_SAMPLE_RATE;

    await Promise.allSettled([
      this.inputAudioCtx.resume(),
      this.outputAudioCtx.resume()
    ]);

    this.source = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);
    this.processor = this.inputAudioCtx.createScriptProcessor(4096, 1, 1);
    this.source.connect(this.processor);
    this.processor.connect(this.inputAudioCtx.destination);

    this.processor.onaudioprocess = (event) => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        const inputData = event.inputBuffer.getChannelData(0);
        const resampled = downsampleBuffer(inputData, this.inputSampleRate, INPUT_SAMPLE_RATE);
        const pcm16 = floatTo16BitPCM(resampled);
        const base64Audio = bytesToBase64(new Uint8Array(pcm16.buffer));
        this.ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64Audio,
              mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`
            }
          }
        }));
      } catch {
        // A single dropped audio frame should not tear down the session.
      }
    };
  }

  startAudioStream() {
    if (this.processor && !this.processorStarted) {
      this.processorStarted = true;
    }
  }

  connectModel(model) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws = null;
      let timer = null;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        this.pendingReject = null;
        if (timer) clearTimeout(timer);
        if (error) {
          this.pendingWs = null;
          try {
            ws?.close();
          } catch {
            // Already closed.
          }
          reject(error);
          return;
        }
        this.pendingWs = null;
        this.ws = ws;
        resolve();
      };

      try {
        const url = `${LIVE_WS_ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`;
        ws = new WebSocket(url);
        this.pendingWs = ws;
        this.pendingReject = finish;
      } catch {
        finish(new Error('Could not open a WebSocket to the Gemini Live API.'));
        return;
      }

      timer = setTimeout(() => {
        finish(new Error(`Gemini Live (${model}) did not respond. Check your connection and API key.`));
      }, SETUP_TIMEOUT_MS);

      ws.onopen = () => {
        if (this.cancelled) {
          finish(new Error('Live voice session cancelled.'));
          return;
        }
        ws.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Zephyr' }
                }
              }
            },
            systemInstruction: { parts: [{ text: LIVE_SYSTEM_PROMPT }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          }
        }));
      };

      ws.onmessage = async (event) => {
        let message;
        try {
          message = await parseWsPayload(event.data);
        } catch {
          return;
        }

        if (!settled) {
          if (message?.setupComplete) {
            finish();
            return;
          }
          if (message?.error) {
            finish(new Error(
              `Gemini Live rejected the session: ${sanitizeLiveError(message.error.message) || 'unknown error'}`
            ));
          }
          return;
        }

        this.handleServerMessage(message);
      };

      ws.onerror = () => {
        finish(new Error(`Could not connect to Gemini Live (${model}). Check your internet connection.`));
      };

      ws.onclose = (event) => {
        if (!settled) {
          const reason = sanitizeLiveError(event?.reason);
          finish(new Error(
            `Gemini Live model ${model} is unavailable${reason ? `: ${reason}` : ''}.`
          ));
          return;
        }

        if (this.ws === ws) {
          this.ws = null;
          this.connected = false;
          this.cleanupAudio();
          this.onStateChange('idle');
        }
      };
    });
  }

  handleServerMessage(message) {
    if (message?.error) {
      const error = new Error(sanitizeLiveError(message.error.message) || 'Live voice session error.');
      logAiEvent('live.server-error', { reason: error.message });
      this.onError(error);
      this.onMessage({ error: error.message });
      return;
    }

    const serverContent = message?.serverContent;
    if (!serverContent) return;

    for (const part of serverContent.modelTurn?.parts ?? []) {
      if (part?.inlineData?.data) {
        this.playAudioChunk(part.inlineData.data);
      }
      if (part?.text) {
        this.onMessage({ text: part.text });
      }
    }

    if (serverContent.outputTranscription?.text) {
      this.onMessage({ outputTranscript: serverContent.outputTranscription.text });
    }

    if (serverContent.interrupted) {
      this.stopPlayback();
      this.onMessage({ interrupted: true });
    }

    if (serverContent.turnComplete) {
      this.onMessage({ turnComplete: true });
    }
  }

  sendTextMessage(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { text } }));
    }
  }

  playAudioChunk(base64Chunk) {
    if (!this.outputAudioCtx) return;
    try {
      const float32Data = base64ToFloat32Array(base64Chunk);
      const audioBuffer = this.outputAudioCtx.createBuffer(
        1,
        float32Data.length,
        OUTPUT_SAMPLE_RATE
      );
      audioBuffer.getChannelData(0).set(float32Data);

      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioCtx.destination);

      const currentTime = this.outputAudioCtx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.04;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
      };
    } catch {
      // Ignore malformed or unsupported audio frames.
    }
  }

  stopPlayback() {
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    });
    this.activeSources = [];
    if (this.outputAudioCtx) {
      this.nextStartTime = this.outputAudioCtx.currentTime;
    }
  }

  cleanupAudio() {
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        // Already disconnected.
      }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // Already disconnected.
      }
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch {
        // Already closed.
      }
      this.inputAudioCtx = null;
    }
    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch {
        // Already closed.
      }
      this.outputAudioCtx = null;
    }
    this.processorStarted = false;
  }

  stop() {
    this.cancelled = true;
    logAiEvent('live.stop', { model: this.activeModel });
    this.stopPlayback();

    const rejectPending = this.pendingReject;
    this.pendingReject = null;
    rejectPending?.(new Error('Live voice session cancelled.'));

    const pending = this.pendingWs;
    this.pendingWs = null;
    if (pending) {
      try {
        pending.onclose = null;
        pending.onerror = null;
        pending.onmessage = null;
        pending.close();
      } catch {
        // Already closed.
      }
    }

    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      } catch {
        // Already closed.
      }
    }

    this.cleanupAudio();
    this.onStateChange('idle');
  }
}
