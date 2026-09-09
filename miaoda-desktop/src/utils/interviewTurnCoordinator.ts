export type BufferedTranscriptSegment = {
  id: string;
  text: string;
  final: boolean;
  order: number;
};

export type TranscriptSegmentUpdate = {
  segmentId?: string;
  text: string;
  final: boolean;
};

export type AutoQuestionTurnState = 'collecting' | 'settling' | 'launched' | 'ignored';

export type AutoQuestionTurn = {
  id: string;
  state: AutoQuestionTurnState;
  segments: BufferedTranscriptSegment[];
  nextOrder: number;
  question: string;
  createdAt: number;
  updatedAt: number;
  audioEndedAt?: number;
  cardId?: string;
};

export type TranscriptApplication = {
  turn: AutoQuestionTurn;
  historical: boolean;
};

const DEFAULT_REVISION_WINDOW_MS = 8_000;
const DEFAULT_RETENTION_MS = 120_000;

export function normalizeTranscriptText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function transcriptFingerprint(value: string): string {
  return normalizeTranscriptText(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

export function chooseFinalSegmentText(previousText: string, finalText: string): string {
  const previous = normalizeTranscriptText(previousText);
  const final = normalizeTranscriptText(finalText);
  if (!previous) return final;
  if (!final) return previous;
  const previousFingerprint = transcriptFingerprint(previous);
  const finalFingerprint = transcriptFingerprint(final);
  if (finalFingerprint.includes(previousFingerprint)) return final;
  if (previousFingerprint.includes(finalFingerprint)) {
    const ending = final.match(/[?？。！!]\s*$/)?.[0] || '';
    return ending && !/[?？。！!]\s*$/.test(previous) ? `${previous}${ending}` : previous;
  }
  if (finalFingerprint.length < previousFingerprint.length * 0.7) return previous;
  return final;
}

export function updateTranscriptSegments(
  current: BufferedTranscriptSegment[],
  update: TranscriptSegmentUpdate,
  fallbackOrder: number,
): BufferedTranscriptSegment[] {
  const text = normalizeTranscriptText(update.text);
  if (!text) return current;
  const explicitId = normalizeTranscriptText(update.segmentId || '');
  const index = explicitId
    ? current.findIndex((segment) => segment.id === explicitId)
    : current.findIndex((segment) => segment.id.startsWith('__anonymous__') && !segment.final);

  if (index < 0) {
    const id = explicitId || `__anonymous__${fallbackOrder}`;
    return [...current, { id, text, final: update.final, order: fallbackOrder }];
  }

  const existing = current[index];
  const nextText = update.final ? chooseFinalSegmentText(existing.text, text) : text;
  const next = [...current];
  next[index] = { ...existing, text: nextText, final: existing.final || update.final };
  return next;
}

export function mergeTranscriptPieces(previousText: string, nextText: string): string {
  const previous = normalizeTranscriptText(previousText);
  const next = normalizeTranscriptText(nextText);
  if (!previous) return next;
  if (!next) return previous;
  if (previous.endsWith(next)) return previous;
  if (next.startsWith(previous)) return next;

  const maxOverlap = Math.min(previous.length, next.length);
  for (let size = maxOverlap; size >= 4; size -= 1) {
    if (previous.slice(-size) === next.slice(0, size)) {
      return normalizeTranscriptText(`${previous}${next.slice(size)}`);
    }
  }
  return normalizeTranscriptText(`${previous} ${next}`);
}

export function composeTranscriptSegments(segments: BufferedTranscriptSegment[]): string {
  return [...segments]
    .sort((left, right) => left.order - right.order)
    .reduce((result, segment) => mergeTranscriptPieces(result, segment.text), '');
}

/**
 * Owns ASR segment identity for one interview session. A segment that is
 * revised after a new speech burst has started is routed back to its original
 * turn, so it can update the existing card without launching another request.
 */
export class InterviewTurnCoordinator {
  private readonly revisionWindowMs: number;
  private readonly retentionMs: number;
  private sessionSeed = '';
  private sequence = 0;
  private currentTurnId: string | null = null;
  private turns = new Map<string, AutoQuestionTurn>();
  private segmentOwners = new Map<string, string>();

  constructor(options: { revisionWindowMs?: number; retentionMs?: number } = {}) {
    this.revisionWindowMs = options.revisionWindowMs ?? DEFAULT_REVISION_WINDOW_MS;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.reset();
  }

  reset(now = Date.now()): void {
    this.sessionSeed = `${Math.round(now).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.sequence = 0;
    this.currentTurnId = null;
    this.turns.clear();
    this.segmentOwners.clear();
  }

  private createTurn(now: number): AutoQuestionTurn {
    this.sequence += 1;
    const turn: AutoQuestionTurn = {
      id: `interview-${this.sessionSeed}-${this.sequence}`,
      state: 'collecting',
      segments: [],
      nextOrder: 0,
      question: '',
      createdAt: now,
      updatedAt: now,
    };
    this.turns.set(turn.id, turn);
    this.currentTurnId = turn.id;
    this.prune(now);
    return turn;
  }

  private ensureCurrent(now: number): AutoQuestionTurn {
    const current = this.current();
    if (!current) return this.createTurn(now);
    if ((current.state === 'launched' || current.state === 'ignored')
      && now - current.updatedAt > this.revisionWindowMs) {
      return this.createTurn(now);
    }
    return current;
  }

  current(): AutoQuestionTurn | null {
    return this.currentTurnId ? this.turns.get(this.currentTurnId) || null : null;
  }

  get(turnId: string): AutoQuestionTurn | null {
    return this.turns.get(turnId) || null;
  }

  speechStarted(now: number): { turn: AutoQuestionTurn; continued: boolean } {
    const current = this.current();
    if (current && (current.state === 'collecting' || current.state === 'settling')) {
      current.state = 'collecting';
      current.updatedAt = now;
      current.audioEndedAt = undefined;
      return { turn: current, continued: true };
    }
    return { turn: this.createTurn(now), continued: false };
  }

  speechEnded(now: number, audioEndedAt?: number): AutoQuestionTurn {
    const turn = this.ensureCurrent(now);
    turn.updatedAt = now;
    turn.audioEndedAt = audioEndedAt;
    return turn;
  }

  applyTranscript(update: TranscriptSegmentUpdate, now: number, preferredTurnId?: string): TranscriptApplication {
    const explicitId = normalizeTranscriptText(update.segmentId || '');
    const ownedTurnId = explicitId ? this.segmentOwners.get(explicitId) : undefined;
    let turn = ownedTurnId ? this.turns.get(ownedTurnId) : undefined;
    if (!turn && preferredTurnId) turn = this.turns.get(preferredTurnId);

    if (!turn) {
      const current = this.current();
      // A brand-new provider segment is a new utterance once the current turn
      // has already launched or been ignored, even if native VAD missed the
      // next speech-start edge. Revisions of an existing segment still route
      // through segmentOwners, and an unowned late tail can explicitly choose
      // its previous turn through preferredTurnId.
      turn = explicitId
        && current
        && (current.state === 'launched' || current.state === 'ignored')
        ? this.createTurn(now)
        : this.ensureCurrent(now);
    }
    if (explicitId) this.segmentOwners.set(explicitId, turn.id);

    turn.nextOrder += 1;
    turn.segments = updateTranscriptSegments(turn.segments, update, turn.nextOrder);
    turn.question = composeTranscriptSegments(turn.segments);
    turn.updatedAt = now;
    if (turn.id === this.currentTurnId && (turn.state === 'ignored' || turn.state === 'settling')) {
      turn.state = 'collecting';
    }
    this.prune(now);
    return { turn, historical: turn.id !== this.currentTurnId };
  }

  markSettling(turnId: string): boolean {
    const turn = this.turns.get(turnId);
    if (!turn || turn.state === 'launched') return false;
    turn.state = 'settling';
    return true;
  }

  markLaunched(turnId: string): boolean {
    const turn = this.turns.get(turnId);
    if (!turn || turn.state === 'launched') return false;
    turn.state = 'launched';
    return true;
  }

  markIgnored(turnId: string): boolean {
    const turn = this.turns.get(turnId);
    if (!turn || turn.state === 'launched') return false;
    turn.state = 'ignored';
    return true;
  }

  attachCard(turnId: string, cardId: string): void {
    const turn = this.turns.get(turnId);
    if (turn) turn.cardId = cardId;
  }

  private prune(now: number): void {
    const expired = new Set<string>();
    for (const [turnId, turn] of this.turns) {
      if (turnId !== this.currentTurnId && now - turn.updatedAt > this.retentionMs) {
        expired.add(turnId);
        this.turns.delete(turnId);
      }
    }
    if (!expired.size) return;
    for (const [segmentId, turnId] of this.segmentOwners) {
      if (expired.has(turnId)) this.segmentOwners.delete(segmentId);
    }
  }
}
