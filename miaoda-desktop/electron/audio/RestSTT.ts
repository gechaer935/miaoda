/**
 * RestSTT - REST-based Speech-to-Text for Groq, OpenAI Whisper, Zhipu GLM-ASR, ElevenLabs, Azure, and IBM Watson
 *
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk: Buffer)
 *
 * Buffers raw PCM chunks, prepends a WAV header, and uploads via REST every ~3 seconds.
 * Supports two upload modes:
 *   - Multipart FormData (Groq, OpenAI, Zhipu GLM-ASR, ElevenLabs)
 *   - Raw binary body (Azure, IBM Watson)
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import FormData from 'form-data';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { MiaodaAuthClient } from '../services/MiaodaAuthClient';

export type RestSttProvider = 'groq' | 'openai' | 'zhipu' | 'elevenlabs' | 'azure' | 'ibmwatson';

interface RestSttProviderConfig {
    endpoint: string;
    model: string;
    authHeader: Record<string, string>;
    uploadType: 'multipart' | 'binary';
    extraFormFields?: Record<string, string>;
    /** Extract transcript text from the API response */
    extractTranscript: (data: any) => string;
}

type ProviderConfigFactory = (apiKey: string, region?: string, languageKey?: string) => RestSttProviderConfig;

type RecoverySegment = {
    sequence: number;
    createdAt: number;
    wavBuffer: Buffer;
    retryCount: number;
    speechEnded: boolean;
    lastError?: unknown;
};

type FlushReason = 'segment' | 'speech_ended' | 'finalize';

const PROVIDER_CONFIGS: Record<RestSttProvider, ProviderConfigFactory> = {
    groq: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
            model: 'whisper-large-v3-turbo',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                temperature: '0',
                response_format: 'json',
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    openai: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.openai.com/v1/audio/transcriptions',
            model: 'whisper-1',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    zhipu: (_apiKey, _region, languageKey) => {
        const lang = languageKey && languageKey !== 'auto' ? RECOGNITION_LANGUAGES[languageKey] : undefined;
        const isChinese = languageKey === 'chinese'
            || lang?.iso639 === 'zh'
            || lang?.bcp47?.toLowerCase().startsWith('zh');
        return {
            endpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions',
            model: 'glm-asr-2512',
            authHeader: { Authorization: `Bearer ${_apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                stream: 'false',
                ...(isChinese ? {
                    prompt: '请按中文语境转写，保留中文技术术语和常见英文缩写，例如进程、线程、虚拟内存、用户态、内核态、CPU、API、HTTP。'
                } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    elevenlabs: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.elevenlabs.io/v1/speech-to-text',
            model: 'scribe_v2',
            authHeader: { 'xi-api-key': apiKey },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language_code: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    azure: (apiKey, region = 'eastus', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${finalLang}`,
            model: '',
            authHeader: { 'Ocp-Apim-Subscription-Key': apiKey },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                return data?.DisplayText ?? '';
            },
        };
    },
    ibmwatson: (apiKey, region = 'us-south', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://api.${region}.speech-to-text.watson.cloud.ibm.com/v1/recognize?language=${finalLang}`,
            model: '',
            authHeader: { Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}` },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                try {
                    return data?.results?.[0]?.alternatives?.[0]?.transcript ?? '';
                } catch {
                    return '';
                }
            },
        };
    },
};

// Minimum buffer size before sending (avoid sending tiny fragments)
// 16kHz * 2 bytes/sample * 1 channel * 0.125 seconds = 4000 bytes
// Lowered from 16000 to allow short command utterances ("Yes", "Stop") to flush instantly.
const MIN_BUFFER_BYTES = 4000;

function parsePositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRetryDelays(raw: string | undefined, fallback: number[]): number[] {
    if (!raw) return fallback;
    const values = raw.split(',')
        .map(item => Number.parseInt(item.trim(), 10))
        .filter(value => Number.isFinite(value) && value > 0);
    return values.length > 0 ? values : fallback;
}

const ASR_RECOVERY_ENABLED = process.env.MIAODA_ASR_RECOVERY_ENABLED !== 'false';
const ASR_SEGMENT_MS = parsePositiveIntEnv('MIAODA_ASR_SEGMENT_MS', 3000);
const ASR_PREROLL_MS = parsePositiveIntEnv('MIAODA_ASR_PREROLL_MS', 500);
const ASR_SEGMENT_TIMEOUT_MS = parsePositiveIntEnv('MIAODA_ASR_SEGMENT_TIMEOUT_MS', 8000);
const ASR_RETRY_MAX = parsePositiveIntEnv('MIAODA_ASR_RETRY_MAX', 2);
const ASR_RETRY_DELAYS_MS = parseRetryDelays(process.env.MIAODA_ASR_RETRY_DELAYS_MS, [1000, 3000]);
const ASR_RETRY_TTL_MS = parsePositiveIntEnv('MIAODA_ASR_RETRY_TTL_MS', 25000);
const ASR_CACHE_WINDOW_MS = parsePositiveIntEnv('MIAODA_ASR_CACHE_WINDOW_MS', 30000);
const ASR_CACHE_MAX_BYTES = parsePositiveIntEnv('MIAODA_ASR_CACHE_MAX_MB', 50) * 1024 * 1024;

function currentAsrPreRollMs(): number {
    try {
        return MiaodaAuthClient.getInstance().getAsrPreRollEnabled() ? ASR_PREROLL_MS : 0;
    } catch {
        return ASR_PREROLL_MS;
    }
}

// Fixed segment interval. Speech-ended events may still flush earlier, but
// continuous speech is cut into bounded chunks so a single ASR failure only
// risks a few seconds and can be retried from the recovery queue.
const SAFETY_NET_INTERVAL_MS = ASR_SEGMENT_MS;

// Silence threshold - if RMS is below this, skip the upload
const SILENCE_RMS_THRESHOLD = 50;
const MIAODA_SERVER_STT_KEY = '__MIAODA_SERVER_STT__';

export class RestSTT extends EventEmitter {
    private provider: RestSttProvider;
    private apiKey: string;
    private region?: string;
    private config: RestSttProviderConfig;
    private modelOverride?: string;

    private chunks: Buffer[] = [];
    private totalBufferedBytes = 0;
    private safetyNetTimer: NodeJS.Timeout | null = null;
    private isActive = false;
    private isUploading = false;
    private flushPending = false;  // Bug #2 fix: queue flush when upload in progress
    private flushPendingReason: FlushReason = 'segment';
    private preRollPcm: Buffer = Buffer.alloc(0);
    private nextSequence = 0;
    private nextEmitSequence = 0;
    private retryQueue = new Map<number, RecoverySegment>();
    private completedSegments = new Map<number, { transcript: string; speechEnded: boolean }>();
    private retryTimers = new Set<NodeJS.Timeout>();

    // Audio config (must match SystemAudioCapture output)
    private sampleRate = 16000;
    private numChannels = 1;
    private bitsPerSample = 16;
    private languageKey?: string;

    constructor(provider: RestSttProvider, apiKey: string, modelOverride?: string, region?: string) {
        super();
        this.provider = provider;
        this.apiKey = apiKey;
        this.region = region;
        this.modelOverride = modelOverride;
        this.config = PROVIDER_CONFIGS[provider](apiKey, region);
        if (modelOverride) {
            this.config.model = modelOverride;
        }
        console.log(`[RestSTT] Initialized for provider: ${provider}, model: ${this.config.model || '(default)'}`);
    }

    /**
     * Update API key (e.g., when user saves a new key)
     */
    public setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        this.config = PROVIDER_CONFIGS[this.provider](apiKey, this.region);
        if (this.modelOverride) {
            this.config.model = this.modelOverride;
        }
        console.log(`[RestSTT] API key updated for ${this.provider}`);
    }

    /**
     * Update sample rate to match the audio source
     */
    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        console.log(`[RestSTT] Updating sample rate to ${rate}Hz`);
        this.sampleRate = rate;
    }

    /**
     * Update channel count
     */
    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        console.log(`[RestSTT] Updating channel count to ${count}`);
        this.numChannels = count;
    }

    /**
     * Update recognition language
     */
    public setRecognitionLanguage(key: string): void {
        console.log(`[RestSTT] Updating recognition language to: ${key}`);
        this.languageKey = key;
        this.config = PROVIDER_CONFIGS[this.provider](this.apiKey, this.region, key);
        if (this.modelOverride) {
            this.config.model = this.modelOverride;
        }
    }

    /**
     * No-op for RestSTT (no Google credentials needed)
     */
    public setCredentials(_keyFilePath: string): void {
        console.log(`[RestSTT] setCredentials called (no-op for REST provider)`);
    }

    /**
     * Start the upload timer
     */
    public start(): void {
        if (this.isActive) return;

        console.log(`[RestSTT] Starting (${this.provider})...`);
        this.isActive = true;
        this.chunks = [];
        this.totalBufferedBytes = 0;
        this.preRollPcm = Buffer.alloc(0);
        this.nextSequence = 0;
        this.nextEmitSequence = 0;
        this.retryQueue.clear();
        this.completedSegments.clear();
        this.clearRetryTimers();

        // Fixed-segment timer: flush continuous speech every ASR_SEGMENT_MS.
        // Primary flush can still be driven earlier by Rust speech_ended events.
        this.safetyNetTimer = setInterval(() => {
            this.flushAndUpload('segment');
        }, SAFETY_NET_INTERVAL_MS);
    }

    /**
     * Stop the upload timer and flush remaining buffer
     */
    public stop(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Stopping (${this.provider})...`);
        this.isActive = false;

        if (this.safetyNetTimer) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = null;
        }
        this.clearRetryTimers();
        this.retryQueue.clear();
        this.completedSegments.clear();

        // Flush remaining audio
        this.flushAndUpload('finalize');
    }

    /**
     * Write raw PCM audio data to the internal buffer
     */
    public write(audioData: Buffer): void {
        if (!this.isActive) return;
        this.chunks.push(audioData);
        this.totalBufferedBytes += audioData.length;
    }

    /**
     * Called when the native SilenceSuppressor detects speech has ended.
     * The internal Rust engine already applies a 150-200ms VAD hangover to avoid
     * word-breaks, so we flush immediately without adding redundant TS debouncing.
     */
    public notifySpeechEnded(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Speech ended detected by native VAD — flushing buffer immediately`);
        this.flushAndUpload('speech_ended');
    }

    public finalize(): void {
        if (!this.isActive) return;
        console.log(`[RestSTT] Finalize — flushing buffer immediately`);
        this.flushAndUpload('finalize');
    }

    /**
     * Concatenate buffered chunks, add WAV header, and upload to REST API
     */
    private async flushAndUpload(reason: FlushReason = 'segment'): Promise<void> {
        // Gate every flush on isActive. Without this, the
        // finally-re-entrancy at line ~334 (`if (this.flushPending) this.flushAndUpload()`)
        // can fire AFTER stop() has set isActive=false, and the body below
        // would happily upload trailing audio to the REST provider for the
        // rest of the process lifetime. The re-arm block below would also
        // resurrect a fresh setInterval if safetyNetTimer happened to be
        // non-null in some race window. Bailing here closes both holes.
        if (!this.isActive) return;

        // Skip if no data
        if (this.chunks.length === 0 || this.totalBufferedBytes < MIN_BUFFER_BYTES) return;

        // Bug #2 fix: if currently uploading, queue a flush for when it completes
        if (this.isUploading) {
            this.flushPending = true;
            if (reason !== 'segment') {
                this.flushPendingReason = reason;
            }
            return;
        }

        // Reset safety-net timer to prevent double-flush. The outer
        // `if (!this.isActive) return` above guarantees we never re-arm
        // after stop() — but keep the timer guard here too as belt-and-braces
        // in case a future caller invokes flushAndUpload from a path that
        // skips the isActive check.
        if (this.safetyNetTimer && this.isActive) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = setInterval(() => {
                this.flushAndUpload('segment');
            }, SAFETY_NET_INTERVAL_MS);
        }

        // Grab current buffer and reset
        const currentChunks = this.chunks;
        this.chunks = [];
        const currentBytes = this.totalBufferedBytes;
        this.totalBufferedBytes = 0;

        // Concatenate all chunks
        const rawPcm = Buffer.concat(currentChunks);

        // Check for silence (skip upload if audio is too quiet)
        if (this.isSilent(rawPcm)) {
            if (Math.random() < 0.1) {
                console.log(`[RestSTT] Skipping silent buffer (${rawPcm.length} bytes)`);
            }
            return;
        }

        const preRollMs = currentAsrPreRollMs();
        const uploadRawPcm = preRollMs > 0 && this.preRollPcm.length > 0
            ? Buffer.concat([this.preRollPcm, rawPcm])
            : rawPcm;
        this.preRollPcm = this.tailPcm(rawPcm, preRollMs);

        // Resample to 16kHz mono before upload. At 48kHz stereo this produces a
        // 6x smaller WAV file, reducing upload latency and keeping file sizes well
        // under the Groq/OpenAI 25MB limit even for 10-second safety-net flushes.
        const TARGET_RATE = 16_000;
        const pcm16k = this.sampleRate === TARGET_RATE && this.numChannels === 1
            ? uploadRawPcm
            : this.resampleTo16kHz(uploadRawPcm);

        // Add WAV header — stamp with actual rate/channel after resampling (always 16kHz mono)
        const wavBuffer = this.addWavHeader(pcm16k, TARGET_RATE);
        const segment: RecoverySegment = {
            sequence: this.nextSequence++,
            createdAt: Date.now(),
            wavBuffer,
            retryCount: 0,
            speechEnded: reason !== 'segment',
        };

        this.isUploading = true;

        try {
            const transcript = await this.uploadAudio(segment.wavBuffer, ASR_SEGMENT_TIMEOUT_MS);

            this.completeSegment(segment.sequence, transcript || '', segment.speechEnded);
        } catch (err) {
            this.handleSegmentFailure(segment, err);
        } finally {
            this.isUploading = false;

            // Bug #2 fix: if a flush was requested while we were uploading, process it now
            if (this.flushPending) {
                const pendingReason = this.flushPendingReason;
                this.flushPending = false;
                this.flushPendingReason = 'segment';
                this.flushAndUpload(pendingReason);
            }
        }
    }

    private tailPcm(rawPcm: Buffer, durationMs: number): Buffer {
        if (durationMs <= 0 || rawPcm.length === 0) return Buffer.alloc(0);
        const bytesPerMs = Math.max(1, Math.floor(this.sampleRate * this.numChannels * (this.bitsPerSample / 8) / 1000));
        const maxBytes = durationMs * bytesPerMs;
        if (rawPcm.length <= maxBytes) return Buffer.from(rawPcm);
        return Buffer.from(rawPcm.subarray(rawPcm.length - maxBytes));
    }

    private completeSegment(sequence: number, transcript: string, speechEnded = false): void {
        this.retryQueue.delete(sequence);
        this.completedSegments.set(sequence, { transcript: transcript.trim(), speechEnded });
        this.drainCompletedSegments();
    }

    private drainCompletedSegments(): void {
        while (this.completedSegments.has(this.nextEmitSequence)) {
            const completed = this.completedSegments.get(this.nextEmitSequence);
            const transcript = completed?.transcript || '';
            this.completedSegments.delete(this.nextEmitSequence);
            if (transcript.length > 0) {
                console.log(`[RestSTT] Transcript received`, {
                    sequence: this.nextEmitSequence,
                    length: transcript.length,
                    speechEnded: Boolean(completed?.speechEnded),
                });
                this.emit('transcript', {
                    text: transcript,
                    isFinal: true,
                    confidence: 1.0,
                    sequence: this.nextEmitSequence,
                    speechEnded: Boolean(completed?.speechEnded),
                });
            }
            this.nextEmitSequence++;
        }
    }

    private handleSegmentFailure(segment: RecoverySegment, err: unknown): void {
        segment.lastError = err;
        const ageMs = Date.now() - segment.createdAt;
        if (!ASR_RECOVERY_ENABLED || segment.retryCount >= ASR_RETRY_MAX || ageMs >= ASR_RETRY_TTL_MS) {
            console.error(`[RestSTT] Upload failed permanently`, {
                sequence: segment.sequence,
                retryCount: segment.retryCount,
                ageMs,
                error: err instanceof Error ? err.message : String(err),
            });
            this.retryQueue.delete(segment.sequence);
            this.completeSegment(segment.sequence, '', segment.speechEnded);
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
            return;
        }

        this.retryQueue.set(segment.sequence, segment);
        this.enforceRecoveryLimits();
        const retryDelay = ASR_RETRY_DELAYS_MS[Math.min(segment.retryCount, ASR_RETRY_DELAYS_MS.length - 1)] || 1000;
        segment.retryCount++;
        console.warn(`[RestSTT] Upload failed, scheduled retry`, {
            sequence: segment.sequence,
            retryCount: segment.retryCount,
            retryDelay,
            ageMs,
        });

        const timer = setTimeout(() => {
            this.retryTimers.delete(timer);
            this.retrySegment(segment);
        }, retryDelay);
        this.retryTimers.add(timer);
    }

    private async retrySegment(segment: RecoverySegment): Promise<void> {
        if (!this.retryQueue.has(segment.sequence)) return;
        if (Date.now() - segment.createdAt >= ASR_RETRY_TTL_MS) {
            this.handleSegmentFailure(segment, segment.lastError || new Error('ASR segment retry TTL expired'));
            return;
        }
        try {
            const transcript = await this.uploadAudio(segment.wavBuffer, ASR_SEGMENT_TIMEOUT_MS);
            this.completeSegment(segment.sequence, transcript || '', segment.speechEnded);
        } catch (err) {
            this.handleSegmentFailure(segment, err);
        }
    }

    private enforceRecoveryLimits(): void {
        const now = Date.now();
        for (const [sequence, segment] of this.retryQueue) {
            if (now - segment.createdAt > ASR_CACHE_WINDOW_MS) {
                this.retryQueue.delete(sequence);
                this.completeSegment(sequence, '', segment.speechEnded);
            }
        }

        let totalBytes = 0;
        const segments = Array.from(this.retryQueue.values()).sort((a, b) => a.createdAt - b.createdAt);
        for (const segment of segments) {
            totalBytes += segment.wavBuffer.length;
        }
        for (const segment of segments) {
            if (totalBytes <= ASR_CACHE_MAX_BYTES) break;
            this.retryQueue.delete(segment.sequence);
            totalBytes -= segment.wavBuffer.length;
            this.completeSegment(segment.sequence, '', segment.speechEnded);
        }
    }

    private clearRetryTimers(): void {
        for (const timer of this.retryTimers) {
            clearTimeout(timer);
        }
        this.retryTimers.clear();
    }

    /**
     * Upload WAV audio to the REST endpoint
     */
    private async uploadAudio(wavBuffer: Buffer, timeoutMs: number): Promise<string> {
        if (this.config.uploadType === 'binary') {
            return this.uploadBinary(wavBuffer, timeoutMs);
        }
        return this.uploadMultipart(wavBuffer, timeoutMs);
    }

    /**
     * Upload via multipart FormData (Groq, OpenAI, ElevenLabs)
     */
    private async uploadMultipart(wavBuffer: Buffer, timeoutMs: number): Promise<string> {
        if (this.provider === 'zhipu' && this.apiKey === MIAODA_SERVER_STT_KEY) {
            const transcript = await MiaodaAuthClient.getInstance().transcribeAudio({
                buffer: wavBuffer,
                filename: 'audio.wav',
                language: this.resolveMiaodaLanguage(),
                asrModel: this.config.model,
                timeoutMs,
            });
            return transcript.text || '';
        }

        const form = new FormData();

        form.append('file', wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });

        // ElevenLabs uses 'model_id' instead of 'model'
        if (this.provider === 'elevenlabs') {
            form.append('model_id', this.config.model);
        } else {
            form.append('model', this.config.model);
        }

        if (this.config.extraFormFields) {
            for (const [key, value] of Object.entries(this.config.extraFormFields)) {
                form.append(key, value);
            }
        }

        const response = await axios.post(this.config.endpoint, form, {
            headers: {
                ...this.config.authHeader,
                ...form.getHeaders(),
            },
            timeout: timeoutMs,
        });

        return this.config.extractTranscript(response.data);
    }

    private resolveMiaodaLanguage(): string {
        const lang = this.languageKey && this.languageKey !== 'auto' ? RECOGNITION_LANGUAGES[this.languageKey] : undefined;
        if (this.languageKey === 'chinese' || lang?.iso639 === 'zh' || lang?.bcp47?.toLowerCase().startsWith('zh')) {
            return 'zh';
        }
        if (lang?.iso639) return lang.iso639;
        return 'auto';
    }

    /**
     * Upload via raw binary body (Azure, IBM Watson)
     */
    private async uploadBinary(wavBuffer: Buffer, timeoutMs: number): Promise<string> {
        const response = await axios.post(this.config.endpoint, wavBuffer, {
            headers: {
                ...this.config.authHeader,
                'Content-Type': 'audio/wav',
            },
            timeout: timeoutMs,
        });

        return this.config.extractTranscript(response.data);
    }

    /**
     * Resample Int16LE PCM from inputRate/numChannels → 16kHz mono.
     * Uses integer decimation (same approach as Rust DSP and OpenAIStreamingSTT).
     * Returns a new Buffer containing the resampled 16-bit mono PCM.
     */
    private resampleTo16kHz(raw: Buffer): Buffer {
        const TARGET_RATE = 16_000;

        // Build Int16Array from the raw buffer using safe byte-by-byte reads
        // to avoid alignment issues with unaligned ArrayBuffer slices.
        const numSamples = Math.floor(raw.length / 2);
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = raw.readInt16LE(i * 2);
        }

        // Already at target rate and mono — return as-is
        if (this.sampleRate === TARGET_RATE && this.numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }

        // Mix down multi-channel to mono
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

        // Decimate to target rate
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

    /**
     * Check if audio buffer is essentially silence
     */
    private isSilent(pcmBuffer: Buffer): boolean {
        let sum = 0;
        const step = 20; // Sample every 20th sample for speed
        let count = 0;

        for (let i = 0; i < pcmBuffer.length - 1; i += 2 * step) {
            const sample = pcmBuffer.readInt16LE(i);
            sum += sample * sample;
            count++;
        }

        if (count === 0) return true;
        const rms = Math.sqrt(sum / count);
        return rms < SILENCE_RMS_THRESHOLD;
    }

    /**
     * Add a WAV RIFF header to raw PCM data.
     * channels defaults to 1 (mono) because callers always resample to mono first.
     * Critical: Most REST STT APIs require a valid WAV file, NOT raw PCM.
     */
    private addWavHeader(samples: Buffer, sampleRate: number = 16_000, channels: number = 1): Buffer {
        const buffer = Buffer.alloc(44 + samples.length);
        // RIFF chunk descriptor
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length, 4);
        buffer.write('WAVE', 8);
        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * channels * (this.bitsPerSample / 8), 28); // ByteRate
        buffer.writeUInt16LE(channels * (this.bitsPerSample / 8), 32);              // BlockAlign
        buffer.writeUInt16LE(this.bitsPerSample, 34);
        // data sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length, 40);
        // Copy raw PCM data
        samples.copy(buffer, 44);

        return buffer;
    }
}
