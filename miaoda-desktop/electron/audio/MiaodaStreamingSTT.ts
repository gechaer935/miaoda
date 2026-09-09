import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { MiaodaAuthClient } from '../services/MiaodaAuthClient';

type WsState = 'idle' | 'connecting' | 'open' | 'closed';

const TARGET_RATE = 16_000;
const MAX_BUFFERED_CHUNKS = 240;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 5000;

export class MiaodaStreamingSTT extends EventEmitter {
    private ws: WebSocket | null = null;
    private state: WsState = 'idle';
    private isActive = false;
    private sampleRate = 16000;
    private numChannels = 1;
    private bitsPerSample = 16;
    private languageKey?: string;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pendingChunks: Buffer[] = [];
    private upstreamReady = false;

    constructor(private model: string) {
        super();
        console.log(`[MiaodaStreamingSTT] Initialized, model=${model}`);
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.connect();
    }

    public stop(): void {
        this.isActive = false;
        this.clearReconnectTimer();
        this.pendingChunks = [];
        try {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'finish' }));
            }
        } catch { /* ignore */ }
        this.closeWs();
    }

    public finalize(): void {
        try {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'finish' }));
            }
        } catch { /* ignore */ }
    }

    public notifySpeechEnded(): void {
        // The server-side ASR VAD emits final text based on max_sentence_silence.
        // Do not finish the upstream stream here; the user may continue speaking.
    }

    public write(audioData: Buffer): void {
        if (!this.isActive || audioData.length === 0) return;
        const pcm16k = this.sampleRate === TARGET_RATE && this.numChannels === 1
            ? audioData
            : this.resampleTo16kHz(audioData);

        if (this.ws?.readyState === WebSocket.OPEN && this.upstreamReady) {
            this.ws.send(pcm16k);
            return;
        }

        this.pendingChunks.push(pcm16k);
        while (this.pendingChunks.length > MAX_BUFFERED_CHUNKS) {
            this.pendingChunks.shift();
        }
        if (this.state !== 'connecting') {
            this.connect();
        }
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        console.log(`[MiaodaStreamingSTT] sampleRate=${rate}`);
        this.sampleRate = rate;
    }

    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        console.log(`[MiaodaStreamingSTT] channels=${count}`);
        this.numChannels = count;
    }

    public setRecognitionLanguage(key: string): void {
        this.languageKey = key;
        if (this.isActive) {
            this.reconnect();
        }
    }

    public setCredentials(_keyFilePath: string): void {
        // No-op. The Java backend owns the DashScope key.
    }

    private connect(): void {
        if (!this.isActive || this.state === 'connecting' || this.ws?.readyState === WebSocket.OPEN) return;
        this.state = 'connecting';
        let url: string;
        try {
            url = MiaodaAuthClient.getInstance().getAsrWebSocketUrl({
                language: this.resolveMiaodaLanguage(),
                asrModel: this.model,
                sampleRate: TARGET_RATE,
            });
        } catch (error) {
            this.state = 'closed';
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
            return;
        }

        const token = MiaodaAuthClient.getInstance().getAuthToken();
        if (!token) {
            this.state = 'closed';
            this.emit('error', new Error('Miaoda auth token is missing'));
            return;
        }
        // Keep bearer credentials out of the WebSocket URL. Query strings can
        // be retained by proxy logs, crash reports and browser history.
        const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
        this.ws = ws;
        this.upstreamReady = false;

        ws.on('open', () => {
            if (this.ws !== ws) return;
            this.state = 'open';
            this.reconnectAttempts = 0;
        });

        ws.on('message', (data) => this.handleMessage(data));

        ws.on('error', (error) => {
            if (this.ws !== ws) return;
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        });

        ws.on('close', () => {
            if (this.ws !== ws) return;
            this.state = 'closed';
            this.ws = null;
            if (this.isActive) {
                this.scheduleReconnect();
            }
        });
    }

    private reconnect(): void {
        this.closeWs();
        if (this.isActive) {
            this.connect();
        }
    }

    private scheduleReconnect(): void {
        if (!this.isActive || this.reconnectTimer) return;
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS);
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private closeWs(): void {
        const ws = this.ws;
        this.ws = null;
        this.state = 'closed';
        this.upstreamReady = false;
        if (!ws) return;
        try {
            ws.removeAllListeners();
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        } catch { /* ignore */ }
    }

    private flushPendingChunks(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.upstreamReady) return;
        const chunks = this.pendingChunks;
        this.pendingChunks = [];
        for (const chunk of chunks) {
            if (this.ws.readyState !== WebSocket.OPEN) {
                this.pendingChunks.unshift(chunk);
                return;
            }
            this.ws.send(chunk);
        }
    }

    private handleMessage(data: WebSocket.RawData): void {
        let payload: any;
        try {
            const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            payload = JSON.parse(text);
        } catch {
            return;
        }

        if (payload.type === 'ready') {
            if (String(payload.model || '').startsWith('mock-')) {
                this.emit('error', new Error('后端未配置 DASHSCOPE_API_KEY，当前无法实时识别音频'));
                return;
            }
            this.upstreamReady = true;
            this.emit('connected');
            this.flushPendingChunks();
            return;
        }
        if (payload.type === 'error') {
            this.emit('error', new Error(payload.message || 'Miaoda ASR error'));
            return;
        }
        if (payload.type !== 'partial' && payload.type !== 'final') return;
        const text = String(payload.text || '').trim();
        if (!text) return;
        this.emit('transcript', {
            text,
            isFinal: payload.type === 'final',
            confidence: 1.0,
            speechEnded: Boolean(payload.speechEnded),
            segmentId: payload.segmentId == null ? undefined : String(payload.segmentId),
        });
    }

    private resolveMiaodaLanguage(): string {
        const lang = this.languageKey && this.languageKey !== 'auto' ? RECOGNITION_LANGUAGES[this.languageKey] : undefined;
        if (this.languageKey === 'chinese' || lang?.iso639 === 'zh' || lang?.bcp47?.toLowerCase().startsWith('zh')) {
            return 'zh';
        }
        if (lang?.iso639) return lang.iso639;
        return 'zh';
    }

    private resampleTo16kHz(raw: Buffer): Buffer {
        const numSamples = Math.floor(raw.length / 2);
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = raw.readInt16LE(i * 2);
        }

        let monoS16: Int16Array;
        if (this.numChannels > 1) {
            const monoLen = Math.floor(inputS16.length / this.numChannels);
            monoS16 = new Int16Array(monoLen);
            for (let i = 0; i < monoLen; i++) {
                let sum = 0;
                for (let c = 0; c < this.numChannels; c++) {
                    sum += inputS16[i * this.numChannels + c];
                }
                monoS16[i] = Math.round(sum / this.numChannels);
            }
        } else {
            monoS16 = inputS16;
        }

        if (this.sampleRate === TARGET_RATE) {
            return Buffer.from(monoS16.buffer);
        }

        const factor = this.sampleRate / TARGET_RATE;
        const outLen = Math.floor(monoS16.length / factor);
        const outS16 = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
            outS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outS16.buffer);
    }
}
