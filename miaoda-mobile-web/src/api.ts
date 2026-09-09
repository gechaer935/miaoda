export type Bootstrap = { pairingId: string; desktopDeviceId: string; quota: { remainingInterviewSeconds: number; remainingWrittenQuestions: number }; serverTime: string }
export type Envelope = { v: 1; type: string; sessionId?: string; requestId?: string; seq: number; timestamp: number; payload?: Record<string, unknown> }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message || '请求失败，请稍后重试')
  return data as T
}

export const api = {
  claimByCode: (code: string) => request('/api/companion/pairings/claim', { method: 'POST', body: JSON.stringify({ code }) }),
  claimByTicket: (pairId: string, ticket: string) => request('/api/companion/pairings/claim', { method: 'POST', body: JSON.stringify({ pairId, ticket }) }),
  bootstrap: () => request<Bootstrap>('/api/companion/bootstrap'),
  solveImage: (file: Blob, filename: string, language: string, mode: 'code' | 'leetcode') => { const body = new FormData(); body.append('screenshot', file, filename); body.append('type', mode); body.append('language', language); body.append('visionMode', 'auto'); return request<Record<string, unknown>>('/api/mobile/solve-screen', { method: 'POST', body }) },
}

export function companionSocket(pairingId: string, lastSeq: number): WebSocket {
  const base = import.meta.env.VITE_WS_BASE_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  return new WebSocket(`${base}/ws/companion/mobile?pairingId=${encodeURIComponent(pairingId)}&lastSeq=${lastSeq}`)
}
