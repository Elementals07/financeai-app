/**
 * Live API Audio Service for Gemini 3.8 Live
 * Implements 16kHz input audio capture and 24kHz output audio playback
 * according to the Gemini Live API specifications.
 */

function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
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

export class LiveAudioSession {
  constructor({ onMessage, onStateChange, onError, apiKey }) {
    this.onMessage = onMessage || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});
    this.apiKey = apiKey || '';
    this.ws = null;
    this.inputAudioCtx = null;
    this.outputAudioCtx = null;
    this.mediaStream = null;
    this.processor = null;
    this.source = null;
    this.nextStartTime = 0;
    this.activeSources = [];
    this.connected = false;
  }

  async start() {
    try {
      this.onStateChange('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ai/live${this.apiKey ? `?key=${encodeURIComponent(this.apiKey)}` : ''}`;
      this.ws = new WebSocket(wsUrl);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), 10000);
        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          this.onStateChange('connected');
          resolve();
        };
        this.ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Could not connect to Live AI server'));
        };
      });

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.audio) {
            this.playAudioChunk(msg.audio);
          }
          if (msg.interrupted) {
            this.stopPlayback();
          }
          this.onMessage(msg);
        } catch (e) {
          console.error('[LiveAudio] Error processing server message:', e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.onStateChange('disconnected');
        this.stop();
      };

      // Set up Audio Contexts
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.inputAudioCtx = new AudioCtx({ sampleRate: 16000 });
      this.outputAudioCtx = new AudioCtx({ sampleRate: 24000 });

      // Request Microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      this.source = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);
      // ScriptProcessor captures 4096 samples at 16kHz
      this.processor = this.inputAudioCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = floatTo16BitPCM(inputData);
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Audio = btoa(binary);
        this.ws.send(JSON.stringify({ audio: base64Audio }));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.inputAudioCtx.destination);
      this.onStateChange('active');
    } catch (err) {
      this.stop();
      this.onError(err);
      throw err;
    }
  }

  sendTextMessage(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ text }));
    }
  }

  playAudioChunk(base64Chunk) {
    if (!this.outputAudioCtx) return;
    try {
      const float32Data = base64ToFloat32Array(base64Chunk);
      const audioBuffer = this.outputAudioCtx.createBuffer(1, float32Data.length, 24000);
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
    } catch (e) {
      console.error('[LiveAudio] Error playing audio chunk:', e);
    }
  }

  stopPlayback() {
    this.activeSources.forEach(s => {
      try {
        s.stop();
      } catch {
        void 0;
      }
    });
    this.activeSources = [];
    if (this.outputAudioCtx) {
      this.nextStartTime = this.outputAudioCtx.currentTime;
    }
  }

  stop() {
    this.stopPlayback();
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        void 0;
      }
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        void 0;
      }
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch {
        void 0;
      }
      this.inputAudioCtx = null;
    }
    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch {
        void 0;
      }
      this.outputAudioCtx = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        void 0;
      }
      this.ws = null;
    }
    this.connected = false;
    this.onStateChange('idle');
  }
}
