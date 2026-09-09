export {};

type MiaodaAsrModel = 'paraformer-realtime-v2' | 'fun-asr-realtime' | 'qwen3-asr-flash-realtime';

type NativeTranscript = {
  speaker?: 'interviewer' | 'user' | string;
  segmentId?: string;
  text?: string;
  final?: boolean;
  speechEnded?: boolean;
};

type Keybind = {
  id: string;
  label: string;
  accelerator: string;
  isGlobal: boolean;
  defaultAccelerator: string;
};

type AppUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded';
  currentVersion: string;
  version?: string;
  percent?: number;
  error?: string;
  canAutoUpdate: boolean;
};

interface MiaodaElectronApi {
  platform?: string;
  getThemeMode?: () => Promise<{ mode: string; resolved: 'light' | 'dark' }>;
  onThemeChanged?: (callback: (value: { mode: string; resolved: 'light' | 'dark' }) => void) => () => void;

  windowMinimize?: () => Promise<void>;
  windowClose?: () => Promise<void>;
  openAssistantWindow?: (kind: 'interview' | 'written') => Promise<{ success: boolean }>;
  closeAssistantWindow?: () => Promise<{ success: boolean; kind?: 'interview' | 'written' }>;
  hideAssistantWindow?: () => Promise<{ success: boolean; kind?: 'interview' | 'written' }>;
  resizeAssistantWindow?: (height: number) => Promise<{ success: boolean; height?: number }>;
  quitApp?: () => Promise<void>;
  writeClipboardText?: (text: string) => Promise<{ success: boolean }>;
  openExternal?: (url: string) => Promise<void>;
  toggleWindow?: () => Promise<void>;
  hideWindow?: () => Promise<void>;
  toggleSettingsWindow?: (coords?: { x: number; y: number }) => Promise<void>;
  updateContentDimensions?: (dimensions: { width: number; height: number }) => Promise<void>;

  getAppUpdateState?: () => Promise<AppUpdateState>;
  onAppUpdateState?: (callback: (state: AppUpdateState) => void) => () => void;
  downloadUpdate?: () => Promise<{ success?: boolean; error?: string } | void>;
  restartAndInstall?: () => Promise<{ success?: boolean; error?: string } | void>;

  getUndetectable?: () => Promise<boolean>;
  setUndetectable?: (state: boolean) => Promise<{ success: boolean; state?: boolean; error?: string }>;
  onUndetectableChanged?: (callback: (enabled: boolean) => void) => () => void;
  setOverlayMousePassthrough?: (enabled: boolean) => Promise<{ success: boolean }>;
  getOverlayMousePassthrough?: () => Promise<boolean>;
  onOverlayMousePassthroughChanged?: (callback: (enabled: boolean) => void) => () => void;
  getKeybinds?: () => Promise<Keybind[]>;
  setKeybind?: (id: string, accelerator: string) => Promise<boolean>;
  setKeybindRecordingSuspended?: (suspended: boolean) => Promise<boolean>;
  onKeybindRecordingCancelled?: (callback: () => void) => () => void;
  onKeybindRecordingInput?: (callback: (input: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void) => () => void;
  resetKeybinds?: () => Promise<Keybind[]>;
  onKeybindsUpdate?: (callback: (keybinds: Keybind[]) => void) => () => void;
  onKeybindRegistrationFailed?: (callback: (data: { id: string; accelerator: string }) => void) => () => void;
  onGlobalShortcut?: (callback: (data: { action: string }) => void) => () => void;
  setRecognitionLanguage?: (key: string) => Promise<{ success: boolean; error?: string }>;

  miaodaAuthGetState?: () => Promise<any>;
  miaodaAuthSetBaseUrl?: (url: string) => Promise<any>;
  miaodaAccountLogin: (username: string, password: string) => Promise<any>;
  miaodaAccountRegister: (username: string, password: string) => Promise<any>;
  miaodaAccountRedeem: (cardKey: string) => Promise<any>;
  miaodaAuthLogout?: () => Promise<any>;
  miaodaAuthGetQuota?: () => Promise<any>;
  miaodaAuthHeartbeat?: (interviewActive?: boolean) => Promise<any>;
  onMiaodaQuotaChanged?: (callback: (quota: any) => void) => () => void;
  miaodaCompanionCreate?: () => Promise<any>;
  miaodaCompanionResume?: () => Promise<any>;
  miaodaCompanionSend?: (type: string, payload?: Record<string, unknown>, requestId?: string) => Promise<any>;
  miaodaCompanionUploadCapture?: (input: { captureId: string; filePath: string; type?: string; language?: string; visionMode?: string }) => Promise<any>;
  miaodaCompanionDisconnect?: () => Promise<any>;
  onMiaodaCompanionEvent?: (callback: (event: any) => void) => () => void;
  miaodaAsrGetModel?: () => Promise<string>;
  miaodaAsrSetModel?: (model: MiaodaAsrModel) => Promise<string>;
  miaodaAsrGetPreRollEnabled?: () => Promise<boolean>;
  miaodaAsrSetPreRollEnabled?: (enabled: boolean) => Promise<boolean>;
  miaodaInterviewAnswer: (input: Record<string, unknown> & { turnId?: string; pipelineId?: string; attemptId?: number }) => Promise<{ answer?: string; model?: string }>;
  miaodaInterviewAnswerStream?: (
    input: Record<string, unknown> & { turnId?: string; pipelineId?: string; attemptId?: number },
    onToken: (token: string) => void,
    onAccepted?: (info: { receivedAtUnixMs?: number }) => void,
  ) => Promise<{ answer?: string; model?: string }>;
  miaodaInterviewTranslateStream?: (
    input: { text: string; sourceLanguage?: string },
    onToken: (token: string) => void,
    onAccepted?: (info: { receivedAtUnixMs?: number }) => void,
  ) => Promise<{ translation?: string; model?: string }>;
  miaodaWrittenSolveScreen?: (input: Record<string, unknown>) => Promise<any>;

  onNativeAudioTranscript?: (callback: (transcript: NativeTranscript) => void) => () => void;
  onNativeAudioSpeechStarted?: (callback: (event: { speaker: string; timestamp: number }) => void) => () => void;
  onNativeAudioSpeechEnded?: (callback: (event: { speaker: string; timestamp: number }) => void) => () => void;
  onSttStatusChanged?: (callback: (status: { state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'; provider: string; error?: string; channel: 'user' | 'interviewer' }) => void) => () => void;
  onMeetingAudioError?: (callback: (message: string) => void) => () => void;
  startMeeting: (options?: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>;
  endMeeting?: () => Promise<void>;
  takeScreenshot?: (options?: { hideWindows?: boolean }) => Promise<{ path?: string; preview?: string }>;
  liteKnowledgeMatch?: (question: string, threshold?: number) => Promise<{ question?: string; answer?: string; score?: number } | null>;

  onResetCropper?: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;
  cropperConfirmed?: (bounds: { x: number; y: number; width: number; height: number }) => void;
  cropperCancelled?: () => void;
}

declare global {
  interface Window {
    electronAPI: MiaodaElectronApi;
  }
}
