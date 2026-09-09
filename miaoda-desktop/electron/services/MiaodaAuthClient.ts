import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app, safeStorage } from 'electron';
import { SettingsManager } from './SettingsManager';

export type MiaodaQuota = {
  remainingInterviewSeconds: number;
  remainingWrittenQuestions: number;
  status?: string;
  expiresAt?: string | null;
};

export type MiaodaAuthState = {
  apiBaseUrl: string;
  deviceId: string;
  username?: string;
  authMode?: 'account';
  tokenExpiresAt?: string;
  isAuthenticated: boolean;
  quota?: MiaodaQuota;
  connectionError?: string;
};

export type MiaodaRedemptionResult = {
  kind: 'standard' | 'experience' | string;
  addedInterviewSeconds: number;
  addedWrittenQuestions: number;
  remainingInterviewSeconds: number;
  remainingWrittenQuestions: number;
  authState: MiaodaAuthState;
};

export type MiaodaWrittenSolveResult = {
  questionText: string;
  answer: string;
  recognitionModel: string;
  answerModel: string;
  charged: boolean;
  cost: number;
  uploadMs?: number;
  visionMs?: number;
  answerMs?: number;
  solverMs?: number;
  serverMs?: number;
};

export type MiaodaInterviewAnswerResult = {
  answer: string;
  model?: string;
};

export type MiaodaInterviewAnswerStreamEvent =
  | { type: 'accepted'; receivedAtUnixMs?: number }
  | { type: 'token'; token: string }
  | { type: 'done'; answer: string; model?: string }
  | { type: 'error'; message: string };

export type MiaodaInterviewTranslationResult = {
  translation: string;
  model?: string;
};

export type MiaodaInterviewTranslationStreamEvent =
  | { type: 'accepted'; receivedAtUnixMs?: number }
  | { type: 'token'; token: string }
  | { type: 'done'; translation: string; model?: string }
  | { type: 'error'; message: string };

export type MiaodaAsrResult = {
  text: string;
  model?: string;
};

export type MiaodaCompanionPairing = { pairId: string; qrUrl: string; code: string; expiresAt: string };
export type MiaodaCompanionPairingState = {
  pairId: string;
  status: 'pending' | 'claimed' | 'active' | 'revoked' | string;
  expiresAt: string;
  claimedAt?: string | null;
  lastSeenAt?: string | null;
};

type LoginResponse = {
  token: string;
  expiresAt: string;
  card: {
    remainingInterviewSeconds: number;
    remainingWrittenQuestions: number;
    maxDevices: number;
  };
  authMode?: 'account';
  user?: {
    username: string;
  };
};

const LOCAL_API_BASE_URL = 'http://127.0.0.1:3001';
const PRODUCTION_API_BASE_URL = 'https://api.example.invalid';
const DEFAULT_ASR_MODEL = 'fun-asr-realtime';
const VALID_ASR_MODELS = new Set([
  'paraformer-realtime-v2',
  'fun-asr-realtime',
  'qwen3-asr-flash-realtime',
]);

export class MiaodaAuthClient {
  private static instance: MiaodaAuthClient;

  public static getInstance(): MiaodaAuthClient {
    if (!MiaodaAuthClient.instance) {
      MiaodaAuthClient.instance = new MiaodaAuthClient();
    }
    return MiaodaAuthClient.instance;
  }

  private settings(): SettingsManager {
    return SettingsManager.getInstance();
  }

  private getSetting<T>(key: string): T | undefined {
    return this.settings().get(key as never) as T | undefined;
  }

  private setSetting(key: string, value: unknown): void {
    this.settings().set(key as never, value as never);
  }

  private normalizeApiBaseUrl(value: string, allowLocalHttp = false): string {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    const parsed = new URL(normalized);
    const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('API base URL cannot contain credentials, a query, or a fragment');
    }
    if (parsed.protocol !== 'https:' && !(allowLocalHttp && localHost && parsed.protocol === 'http:')) {
      throw new Error('API base URL must use HTTPS');
    }
    return normalized;
  }

  public getApiBaseUrl(): string {
    const environmentUrl = String(process.env.MIAODA_API_BASE_URL || '').trim();
    if (environmentUrl) {
      try {
        return this.normalizeApiBaseUrl(environmentUrl, process.env.NODE_ENV === 'development');
      } catch {
        // Ignore unsafe environment overrides in packaged clients.
      }
    }

    const configuredUrl = String(this.getSetting<string>('miaodaApiBaseUrl') || '').trim();
    if (process.env.NODE_ENV === 'development') {
      // Older development runs persisted the production fallback before the
      // local launcher started exporting MIAODA_API_BASE_URL. Heal that stale
      // value so `npm run app:dev` still talks to the local Java server.
      if (!configuredUrl || configuredUrl === PRODUCTION_API_BASE_URL) return LOCAL_API_BASE_URL;
    }

    try {
      return this.normalizeApiBaseUrl(configuredUrl || PRODUCTION_API_BASE_URL, process.env.NODE_ENV === 'development');
    } catch {
      return PRODUCTION_API_BASE_URL;
    }
  }

  public setApiBaseUrl(url: string): MiaodaAuthState {
    const normalized = this.normalizeApiBaseUrl(url, process.env.NODE_ENV === 'development');
    this.setSetting('miaodaApiBaseUrl', normalized);
    return this.getState();
  }

  public getAsrModel(): string {
    const model = this.getSetting<string>('miaodaAsrModel');
    return model && VALID_ASR_MODELS.has(model) ? model : DEFAULT_ASR_MODEL;
  }

  public getAsrPreRollEnabled(): boolean {
    return this.getSetting<boolean>('miaodaAsrPreRollEnabled') !== false;
  }

  public setAsrPreRollEnabled(enabled: boolean): boolean {
    const value = Boolean(enabled);
    this.setSetting('miaodaAsrPreRollEnabled', value);
    return value;
  }

  public getAuthToken(): string | undefined {
    const encrypted = String(this.getSetting<string>('miaodaAuthTokenEncrypted') || '').trim();
    if (encrypted) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        }
      } catch {
        return undefined;
      }
    }
    const legacy = String(this.getSetting<string>('miaodaAuthToken') || '').trim();
    if (legacy) {
      try {
        if (safeStorage.isEncryptionAvailable()) this.storeAuthToken(legacy);
      } catch {
        // Keep the legacy value until OS-backed encryption becomes available.
      }
    }
    return legacy || undefined;
  }

  private storeAuthToken(token: string): void {
    const value = String(token || '').trim();
    if (!value) {
      this.setSetting('miaodaAuthTokenEncrypted', '');
      this.setSetting('miaodaAuthToken', '');
      return;
    }
    try {
      if (safeStorage.isEncryptionAvailable()) {
        this.setSetting('miaodaAuthTokenEncrypted', safeStorage.encryptString(value).toString('base64'));
        this.setSetting('miaodaAuthToken', '');
        return;
      }
    } catch {
      // Fall back only on systems where the OS credential encryption service
      // is unavailable; the server-side session still expires and is revocable.
    }
    this.setSetting('miaodaAuthToken', value);
  }

  public getAsrWebSocketUrl(input: { language?: string; asrModel?: string; sampleRate?: number } = {}): string {
    if (!this.getAuthToken()) throw new Error('Miaoda auth token is missing');
    const base = this.getApiBaseUrl().replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    const params = new URLSearchParams({
      language: input.language || 'zh',
      model: input.asrModel || this.getAsrModel(),
      sampleRate: String(input.sampleRate || 16000),
    });
    return `${base}/ws/asr?${params.toString()}`;
  }

  public setAsrModel(model: string): string {
    const normalized = String(model || '').trim();
    if (!VALID_ASR_MODELS.has(normalized)) {
      throw new Error(`Unsupported ASR model: ${normalized}`);
    }
    this.setSetting('miaodaAsrModel', normalized);
    return normalized;
  }

  public getDeviceId(): string {
    const existing = this.getSetting<string>('miaodaDeviceId');
    if (existing) return existing;
    const generated = randomUUID();
    this.setSetting('miaodaDeviceId', generated);
    return generated;
  }

  public getState(): MiaodaAuthState {
    const token = this.getAuthToken();
    const tokenExpiresAt = this.getSetting<string>('miaodaAuthExpiresAt');
    const quota = this.getSetting<MiaodaQuota>('miaodaLastQuota');
    const isAuthenticated = Boolean(token && tokenExpiresAt && new Date(tokenExpiresAt).getTime() > Date.now());
    return {
      apiBaseUrl: this.getApiBaseUrl(),
      deviceId: this.getDeviceId(),
      username: this.getSetting<string>('miaodaUsername'),
      authMode: this.getSetting<'account'>('miaodaAuthMode'),
      tokenExpiresAt,
      isAuthenticated,
      quota
    };
  }

  /**
   * Validate the locally cached desktop session against the server. A JWT may
   * still be inside its local expiry window while its server-side session was
   * revoked or the backend signing secret/database was rotated. In that case
   * transparently obtain a fresh token with the already stored card key.
   */
  public async refreshSession(): Promise<MiaodaAuthState> {
    this.clearLegacyCardSession();
    const current = this.getState();
    if (current.authMode !== 'account') return current;

    if (current.isAuthenticated) {
      try {
        await this.getQuota();
        return this.getState();
      } catch (error) {
        if (!this.isAuthenticationError(error)) {
          return { ...current, connectionError: this.friendlyConnectionError(error) };
        }
      }
    }

    this.storeAuthToken('');
    this.setSetting('miaodaAuthExpiresAt', '');
    return { ...this.getState(), connectionError: current.connectionError || '登录已过期，请重新输入用户名和密码' };
  }

  private clearLegacyCardSession(): void {
    const authMode = this.getSetting<string>('miaodaAuthMode');
    const cardKey = String(this.getSetting<string>('miaodaCardKey') || '').trim();
    const token = String(this.getAuthToken() || '').trim();
    if (authMode === 'account' || (!authMode && !cardKey && !token)) return;

    this.storeAuthToken('');
    this.setSetting('miaodaAuthExpiresAt', '');
    this.setSetting('miaodaCardKey', undefined);
    this.setSetting('miaodaLastQuota', undefined);
    this.setSetting('miaodaAuthMode', undefined);
  }

  public async loginAccount(username: string, password: string): Promise<MiaodaAuthState> {
    const normalizedUsername = String(username || '').trim();
    if (!normalizedUsername || !password) throw new Error('用户名或密码错误');

    const result = await this.request<LoginResponse>('/api/auth/account-login', {
      method: 'POST',
      skipAuth: true,
      body: {
        username: normalizedUsername,
        password,
        deviceId: this.getDeviceId(),
        deviceName: os.hostname(),
        platform: process.platform,
      },
    });

    return this.storeAccountSession(result, normalizedUsername);
  }

  public async registerAccount(username: string, password: string): Promise<MiaodaAuthState> {
    const normalizedUsername = String(username || '').trim();
    const usernameLength = Array.from(normalizedUsername).length;
    const passwordLength = Array.from(String(password || '')).length;
    if (usernameLength < 4 || usernameLength > 32) throw new Error('用户名须为 4～32 个字符');
    if (passwordLength < 8 || passwordLength > 24) throw new Error('密码长度须为 8～24 个字符');

    const result = await this.request<LoginResponse>('/api/auth/register', {
      method: 'POST',
      skipAuth: true,
      body: {
        username: normalizedUsername,
        password,
        deviceId: this.getDeviceId(),
        deviceName: os.hostname(),
        platform: process.platform,
      },
    });

    return this.storeAccountSession(result, normalizedUsername);
  }

  private storeAccountSession(result: LoginResponse, fallbackUsername: string): MiaodaAuthState {
    this.storeAuthToken(result.token);
    this.setSetting('miaodaAuthExpiresAt', result.expiresAt);
    this.setSetting('miaodaCardKey', undefined);
    this.setSetting('miaodaUsername', result.user?.username || fallbackUsername);
    this.setSetting('miaodaAuthMode', 'account');
    this.setSetting('miaodaLastQuota', {
      remainingInterviewSeconds: result.card.remainingInterviewSeconds,
      remainingWrittenQuestions: result.card.remainingWrittenQuestions,
    });
    return this.getState();
  }

  public async redeemCard(cardKey: string): Promise<MiaodaRedemptionResult> {
    if (this.getSetting<'account'>('miaodaAuthMode') !== 'account') {
      throw new Error('请先使用用户名和密码登录');
    }
    const normalizedCardKey = String(cardKey || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!normalizedCardKey) throw new Error('请输入卡密');

    const result = await this.request<Omit<MiaodaRedemptionResult, 'authState'>>('/api/account/redeem', {
      method: 'POST',
      body: { cardKey: normalizedCardKey },
    });
    this.setSetting('miaodaLastQuota', {
      remainingInterviewSeconds: result.remainingInterviewSeconds,
      remainingWrittenQuestions: result.remainingWrittenQuestions,
    });
    return { ...result, authState: this.getState() };
  }

  public async logout(): Promise<MiaodaAuthState> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch {
      // Local logout must still clear an expired or unreachable session.
    }
    this.storeAuthToken('');
    this.setSetting('miaodaAuthExpiresAt', '');
    this.setSetting('miaodaLastQuota', undefined);
    return this.getState();
  }

  public async getQuota(): Promise<MiaodaQuota> {
    const quota = await this.request<MiaodaQuota>('/api/me/quota');
    this.setSetting('miaodaLastQuota', quota);
    return quota;
  }

  public async heartbeat(interviewActive: boolean): Promise<MiaodaQuota & { ok: boolean; chargedSeconds: number }> {
    const result = await this.request<MiaodaQuota & { ok: boolean; chargedSeconds: number }>('/api/session/heartbeat', {
      method: 'POST',
      body: { interviewActive }
    });
    this.setSetting('miaodaLastQuota', {
      remainingInterviewSeconds: result.remainingInterviewSeconds,
      remainingWrittenQuestions: result.remainingWrittenQuestions,
      status: result.status,
      expiresAt: result.expiresAt
    });
    return result;
  }

  public async answerInterview(input: {
    question: string;
    job?: string;
    language?: string;
    model?: string;
    resumeText?: string;
    context?: string[];
    turnId?: string;
    pipelineId?: string;
    attemptId?: number;
  }): Promise<MiaodaInterviewAnswerResult> {
    return this.request<MiaodaInterviewAnswerResult>('/api/interview/answer', {
      method: 'POST',
      body: {
        question: input.question,
        job: input.job,
        language: input.language,
        model: input.model,
        resumeText: input.resumeText,
        context: input.context || [],
        turnId: input.turnId,
        pipelineId: input.pipelineId,
        attemptId: input.attemptId,
      }
    });
  }

  public async streamInterviewAnswer(
    input: {
      question: string;
      job?: string;
      language?: string;
      model?: string;
      resumeText?: string;
      context?: string[];
      turnId?: string;
      pipelineId?: string;
      attemptId?: number;
    },
    onEvent: (event: MiaodaInterviewAnswerStreamEvent) => void,
  ): Promise<MiaodaInterviewAnswerResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    this.addClientVersionHeader(headers);
    const token = this.getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(`${this.getApiBaseUrl()}/api/interview/answer-stream`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          question: input.question,
          job: input.job,
          language: input.language,
          model: input.model,
          resumeText: input.resumeText,
          context: input.context || [],
          turnId: input.turnId,
          pipelineId: input.pipelineId,
          attemptId: input.attemptId,
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `Request failed with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalAnswer = '';
      let finalModel: string | undefined;
      let receivedDone = false;

      const handleBlock = (block: string) => {
        let eventType = 'message';
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventType = line.slice('event:'.length).trim();
          if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
        }
        if (dataLines.length === 0) return;
        const payload = JSON.parse(dataLines.join('\n'));
        if (eventType === 'accepted') {
          onEvent({ type: 'accepted', receivedAtUnixMs: Number(payload.receivedAtUnixMs) || undefined });
        } else if (eventType === 'token') {
          const tokenText = String(payload.token || '');
          if (!tokenText) return;
          finalAnswer += tokenText;
          onEvent({ type: 'token', token: tokenText });
        } else if (eventType === 'done') {
          receivedDone = true;
          finalAnswer = String(payload.answer || finalAnswer);
          finalModel = payload.model ? String(payload.model) : undefined;
          onEvent({ type: 'done', answer: finalAnswer, model: finalModel });
        } else if (eventType === 'error') {
          const message = String(payload.message || 'stream failed');
          onEvent({ type: 'error', message });
          throw new Error(message);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let splitIndex: number;
        while ((splitIndex = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const block = buffer.slice(0, splitIndex);
          buffer = buffer.slice(buffer[splitIndex] === '\r' ? splitIndex + 4 : splitIndex + 2);
          if (block.trim()) handleBlock(block);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleBlock(buffer);
      if (!receivedDone) {
        throw new Error('Interview answer stream ended before the done event');
      }

      return { answer: finalAnswer, model: finalModel };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Interview answer stream timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async streamInterviewTranslation(
    input: {
      text: string;
      sourceLanguage?: string;
    },
    onEvent: (event: MiaodaInterviewTranslationStreamEvent) => void,
  ): Promise<MiaodaInterviewTranslationResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    this.addClientVersionHeader(headers);
    const token = this.getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${this.getApiBaseUrl()}/api/interview/translate-stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: input.text,
        sourceLanguage: input.sourceLanguage,
      }),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Request failed with ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalTranslation = '';
    let finalModel: string | undefined;

    const handleBlock = (block: string) => {
      let eventType = 'message';
      const dataLines: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventType = line.slice('event:'.length).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
      }
      if (dataLines.length === 0) return;
      const payload = JSON.parse(dataLines.join('\n'));
      if (eventType === 'accepted') {
        onEvent({ type: 'accepted', receivedAtUnixMs: Number(payload.receivedAtUnixMs) || undefined });
      } else if (eventType === 'token') {
        const tokenText = String(payload.token || '');
        if (!tokenText) return;
        finalTranslation += tokenText;
        onEvent({ type: 'token', token: tokenText });
      } else if (eventType === 'done') {
        finalTranslation = String(payload.translation || finalTranslation);
        finalModel = payload.model ? String(payload.model) : undefined;
        onEvent({ type: 'done', translation: finalTranslation, model: finalModel });
      } else if (eventType === 'error') {
        const message = String(payload.message || 'translation failed');
        onEvent({ type: 'error', message });
        throw new Error(message);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let splitIndex: number;
      while ((splitIndex = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, splitIndex);
        buffer = buffer.slice(buffer[splitIndex] === '\r' ? splitIndex + 4 : splitIndex + 2);
        if (block.trim()) handleBlock(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleBlock(buffer);

    return { translation: finalTranslation, model: finalModel };
  }

  public async transcribeAudio(input: {
    buffer: Buffer;
    filename?: string;
    language?: string;
    asrModel?: string;
    timeoutMs?: number;
  }): Promise<MiaodaAsrResult> {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(input.buffer)], { type: 'audio/wav' }), input.filename || 'audio.wav');
    form.append('language', input.language || 'zh');
    form.append('asrModel', input.asrModel || this.getAsrModel());
    return this.requestForm<MiaodaAsrResult>('/api/interview/asr', form, input.timeoutMs);
  }

  public async solveWrittenScreen(input: {
    filePath: string;
    type?: 'auto' | 'code' | 'leetcode' | 'assessment';
    language?: string;
    visionMode?: 'auto' | 'aliyun:qwen3.7-plus' | 'aliyun:qwen3.6-plus';
  }): Promise<MiaodaWrittenSolveResult> {
    const resolved = path.resolve(input.filePath);
    const buffer = await fs.promises.readFile(resolved);
    const mimeType = this.detectImageMimeType(buffer, resolved);
    const form = new FormData();
    form.append('screenshot', new Blob([new Uint8Array(buffer)], { type: mimeType }), path.basename(resolved));
    form.append('type', input.type || 'auto');
    form.append('language', input.language || 'Java');
    form.append('visionMode', input.visionMode || 'auto');

    let result: MiaodaWrittenSolveResult;
    try {
      result = await this.requestForm<MiaodaWrittenSolveResult>('/api/written/solve-screen', form, 270_000);
    } catch (error) {
      if (/abort|timed?\s*out/i.test(error instanceof Error ? error.message : String(error))) {
        throw new Error('笔试解题超过 270 秒，所有重试仍未完成，请稍后重试');
      }
      throw error;
    }
    const quota = await this.getQuota().catch((): null => null);
    if (quota) this.setSetting('miaodaLastQuota', quota);
    return result;
  }

  public async createCompanionPairing(): Promise<MiaodaCompanionPairing> {
    return this.request<MiaodaCompanionPairing>('/api/companion/pairings', { method: 'POST', body: {} });
  }

  public async getCurrentCompanionPairings(): Promise<MiaodaCompanionPairingState[]> {
    const result = await this.request<{ pairings?: MiaodaCompanionPairingState[] }>('/api/companion/pairings/current');
    return Array.isArray(result.pairings) ? result.pairings : [];
  }

  public async revokeCompanionPairing(pairId: string): Promise<void> {
    await this.request(`/api/companion/pairings/${encodeURIComponent(pairId)}`, { method: 'DELETE' });
  }

  public async uploadCompanionCapture(input: { captureId: string; filePath: string; type?: string; language?: string; visionMode?: string }): Promise<MiaodaWrittenSolveResult> {
    const resolved = path.resolve(input.filePath);
    const buffer = await fs.promises.readFile(resolved);
    const form = new FormData();
    form.append('screenshot', new Blob([new Uint8Array(buffer)], { type: this.detectImageMimeType(buffer, resolved) }), path.basename(resolved));
    form.append('type', input.type || 'auto');
    form.append('language', input.language || 'Java');
    form.append('visionMode', input.visionMode || 'auto');
    return this.requestForm<MiaodaWrittenSolveResult>(`/api/companion/captures/${encodeURIComponent(input.captureId)}`, form);
  }

  private detectImageMimeType(buffer: Buffer, filePath: string): string {
    if (buffer.length >= 12) {
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
      if (
        buffer.toString('ascii', 0, 4) === 'RIFF'
        && buffer.toString('ascii', 8, 12) === 'WEBP'
      ) return 'image/webp';
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    return 'image/png';
  }

  private isAuthenticationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /\b401\b|unauthori[sz]ed|invalid[_ -]?token|token.*(?:invalid|expired|revoked)|(?:invalid|expired|revoked).*token|missing[_ -]?token/i.test(message);
  }

  private friendlyConnectionError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || '');
    if (this.isConnectionError(error)) {
      return '暂时无法连接秒答服务，请检查网络后重试';
    }
    return message || '秒答服务暂时不可用，请稍后重试';
  }

  private isConnectionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /fetch failed|failed to fetch|ECONNREFUSED|ENOTFOUND|network|timeout/i.test(message);
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown; skipAuth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    this.addClientVersionHeader(headers);
    const token = this.getAuthToken();
    if (!options.skipAuth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.getApiBaseUrl()}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = data?.error?.message || data?.error?.code || `Request failed with ${response.status}`;
      throw new Error(message);
    }
    return data as T;
  }

  private async requestForm<T>(path: string, form: FormData, timeoutMs?: number): Promise<T> {
    const headers: Record<string, string> = {};
    this.addClientVersionHeader(headers);
    const token = this.getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    let response: Response;
    try {
      response = await fetch(`${this.getApiBaseUrl()}${path}`, {
        method: 'POST',
        headers,
        body: form,
        signal: controller?.signal
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = data?.error?.message || data?.error?.code || `Request failed with ${response.status}`;
      throw new Error(message);
    }
    return data as T;
  }

  private addClientVersionHeader(headers: Record<string, string>): void {
    try {
      const version = String(app.getVersion() || '').trim().slice(0, 64);
      if (version) headers['X-Miaoda-Client-Version'] = version;
    } catch {
      // Requests must remain compatible in tests and early startup even when
      // Electron has not exposed application metadata yet.
    }
  }
}
