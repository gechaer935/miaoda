import { useEffect, useRef, useState } from 'react'
import { api, Bootstrap, companionSocket, Envelope } from './api'
import { compressImage } from './image'

type Tab = 'home' | 'interview' | 'written' | 'settings'
type Connection = 'connecting' | 'online' | 'offline'
type InterviewTurn = {
  id: string
  question: string
  answer: string
  status: 'generating' | 'done' | 'error'
}
type WrittenResult = { id: string; question?: string; answer?: string }
type WrittenSolveMode = 'code' | 'leetcode'

const COMPANION_HEARTBEAT_INTERVAL_MS = 5_000
const COMPANION_STALE_AFTER_MS = 10_000

const WRITTEN_LANGUAGE_GROUPS = [
  { label: '常用语言', options: ['Java', 'C++', 'Python', 'Go', 'JavaScript', 'TypeScript', 'C', 'C#', 'Kotlin', 'Rust'] },
  { label: '移动与应用', options: ['Swift', 'Objective-C', 'Dart', 'PHP', 'Ruby'] },
  { label: '数据与脚本', options: ['SQL', 'R', 'MATLAB', 'Bash', 'Lua', 'Perl'] },
  { label: '其他语言', options: ['Scala', 'Groovy', 'Haskell', 'F#', 'Visual Basic', 'Pascal'] },
] as const

const WRITTEN_LANGUAGES = WRITTEN_LANGUAGE_GROUPS.flatMap(group => [...group.options])

function normalizeWrittenLanguage(value: unknown): string {
  const candidate = String(value || '').trim()
  return WRITTEN_LANGUAGES.includes(candidate as typeof WRITTEN_LANGUAGES[number]) ? candidate : 'Java'
}

function normalizeWrittenSolveMode(value: unknown): WrittenSolveMode {
  return value === 'leetcode' ? 'leetcode' : 'code'
}

function writtenSolveModeLabel(mode: WrittenSolveMode): string {
  return mode === 'leetcode' ? '力扣模式' : 'ACM 完整程序'
}

function WrittenLanguageOptions() {
  return <>{WRITTEN_LANGUAGE_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(item => <option key={item} value={item}>{item}</option>)}</optgroup>)}</>
}

// React StrictMode intentionally mounts effects twice in development. Pairing
// tickets are single-use, so both effect passes must share one claim/bootstrap
// attempt instead of racing two claim requests for the same QR code.
let sessionInitialization: Promise<Bootstrap> | null = null

function initializeSessionFromLocation(): Promise<Bootstrap> {
  if (sessionInitialization) return sessionInitialization
  const attempt = (async () => {
    const match = location.pathname.match(/^\/pair\/([^/]+)/)
    const query = new URLSearchParams(location.search)
    const hash = new URLSearchParams(location.hash.slice(1))
    const ticket = query.get('ticket') || hash.get('ticket')
    if (match && ticket) {
      await api.claimByTicket(decodeURIComponent(match[1]), ticket)
      history.replaceState({}, '', '/session')
    }
    return api.bootstrap()
  })()
  sessionInitialization = attempt
  void attempt.catch(() => {
    if (sessionInitialization === attempt) sessionInitialization = null
  })
  return attempt
}

function compactInterviewAnswer(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]*\n+/g, '\n')
    .trimStart()
}

function interviewAnswerDensity(value: string): string {
  const length = value.replace(/\s/g, '').length
  if (length > 360) return ' dense'
  if (length > 140) return ' compact'
  return ''
}

function writtenAnswerDensity(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n')
  const length = normalized.replace(/\s/g, '').length
  const lines = normalized ? normalized.split('\n').length : 0
  if (length > 1600 || lines > 60) return ' ultra-dense'
  if (length > 800 || lines > 32) return ' dense'
  if (length > 320 || lines > 16) return ' compact'
  return ''
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [tab, setTab] = useState<Tab>('home')
  const [connection, setConnection] = useState<Connection>('connecting')
  const [desktopOnline, setDesktopOnline] = useState(false)
  const [stage, setStage] = useState('等待开始')
  const [liveQuestion, setLiveQuestion] = useState('')
  const [interviewTurns, setInterviewTurns] = useState<InterviewTurn[]>([])
  const [writtenHistory, setWrittenHistory] = useState<WrittenResult[]>([])
  const [uploading, setUploading] = useState(false)
  const [language, setLanguage] = useState(() => normalizeWrittenLanguage(localStorage.getItem('miaoda_written_language')))
  const [solveMode, setSolveMode] = useState<WrittenSolveMode>(() => normalizeWrittenSolveMode(localStorage.getItem('miaoda_written_mode')))
  const [fontSize, setFontSize] = useState(Number(localStorage.getItem('miaoda_font_size') || 18))
  const [autoScroll, setAutoScroll] = useState(localStorage.getItem('miaoda_auto_scroll') !== 'false')
  const wsRef = useRef<WebSocket | null>(null)
  const lastSeq = useRef(0)
  const reconnect = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const pairingIdRef = useRef('')
  const lastMessageAtRef = useRef(Date.now())
  const answerEnd = useRef<HTMLDivElement | null>(null)
  const interviewHistoryRef = useRef<HTMLDivElement | null>(null)
  const interviewScrollIndexRef = useRef<number | null>(null)
  const writtenAnswerRef = useRef<HTMLElement | null>(null)
  const writtenHistoryRef = useRef<HTMLElement | null>(null)
  const liveQuestionRef = useRef('')
  const activeTurnIdRef = useRef<string | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  async function bootstrap() { const data = await api.bootstrap(); setBoot(data); setError(''); return data }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await initializeSessionFromLocation()
        if (!active) return
        setBoot(data)
        setError('')
        connect(data.pairingId)
      } catch { /* 未配对时显示入口 */ } finally { if (active) setLoading(false) }
    })()
    const visibility = () => {
      if (document.visibilityState !== 'visible') return
      const stale = Date.now() - lastMessageAtRef.current > COMPANION_STALE_AFTER_MS
      if (!wsRef.current || stale) void api.bootstrap().then(data => { setBoot(data); restartConnection(data.pairingId) }).catch(() => undefined)
    }
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const socket = wsRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      if (Date.now() - lastMessageAtRef.current > COMPANION_STALE_AFTER_MS) {
        restartConnection()
        return
      }
      socket.send(JSON.stringify({ v: 1, type: 'heartbeat', seq: 0, timestamp: Date.now(), payload: {} }))
    }, COMPANION_HEARTBEAT_INTERVAL_MS)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', visibility)
      window.clearInterval(heartbeat)
      clearTimeout(timer.current)
      const socket = wsRef.current
      wsRef.current = null
      socket?.close()
    }
  }, [])

  useEffect(() => {
    if (!boot?.pairingId || !('wakeLock' in navigator)) return undefined

    let active = true
    const acquireWakeLock = async () => {
      if (!active || document.visibilityState !== 'visible' || wakeLockRef.current) return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (!active) {
          await sentinel.release()
          return
        }
        wakeLockRef.current = sentinel
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null
        }, { once: true })
      } catch {
        // Low battery, power-saving policies, older embedded browsers, or a
        // temporarily inactive page may reject the request. Keep this silent
        // and retry when the paired page becomes visible/interactive again.
      }
    }
    const reacquireWhenVisible = () => {
      if (document.visibilityState === 'visible') void acquireWakeLock()
    }
    const retryAfterInteraction = () => void acquireWakeLock()

    void acquireWakeLock()
    document.addEventListener('visibilitychange', reacquireWhenVisible)
    document.addEventListener('pointerdown', retryAfterInteraction, { passive: true })

    return () => {
      active = false
      document.removeEventListener('visibilitychange', reacquireWhenVisible)
      document.removeEventListener('pointerdown', retryAfterInteraction)
      const sentinel = wakeLockRef.current
      wakeLockRef.current = null
      if (sentinel && !sentinel.released) void sentinel.release()
    }
  }, [boot?.pairingId])

  useEffect(() => { if (autoScroll) answerEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [interviewTurns, liveQuestion, autoScroll])

  useEffect(() => {
    interviewScrollIndexRef.current = interviewTurns.length ? interviewTurns.length - 1 : null
  }, [interviewTurns.length])

  useEffect(() => {
    if (!autoScroll || !writtenHistory.length) return undefined
    const frame = window.requestAnimationFrame(() => {
      writtenAnswerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [writtenHistory.length, autoScroll])

  function scrollWrittenByHalfPage(direction: 'up' | 'down') {
    setTab('written')
    const sign = direction === 'up' ? -1 : 1
    const applyScroll = (attempt = 0) => window.requestAnimationFrame(() => {
      const history = writtenHistoryRef.current
      if (!history) {
        // Switching from another tab requires a React commit before the answer
        // element exists. Retry briefly instead of scrolling the old page.
        if (attempt < 8) window.setTimeout(() => applyScroll(attempt + 1), 25)
        return
      }
      const scroller = document.scrollingElement || document.documentElement
      const viewportHeight = window.visualViewport?.height || window.innerHeight
      const halfPage = Math.round(viewportHeight * 0.5)
      const currentTop = scroller.scrollTop
      const answerTop = currentTop + history.getBoundingClientRect().top
      const answerBottom = answerTop + history.offsetHeight
      const visibleHeight = Math.max(1, viewportHeight - 86)
      const maximum = Math.max(answerTop, answerBottom - visibleHeight)
      const target = Math.max(answerTop, Math.min(maximum, currentTop + sign * halfPage))
      // Paging must be deterministic. Smooth animation makes rapid shortcut
      // presses reuse an in-between scrollTop and appear to do nothing.
      scroller.scrollTo({ top: target, behavior: 'auto' })
    })
    applyScroll()
  }

  function scrollInterviewByAnswer(direction: 'up' | 'down') {
    setTab('interview')
    const applyScroll = (attempt = 0) => window.requestAnimationFrame(() => {
      const container = interviewHistoryRef.current
      if (!container) {
        if (attempt < 8) window.setTimeout(() => applyScroll(attempt + 1), 25)
        return
      }
      const answers = Array.from(container.querySelectorAll<HTMLElement>('.interview-turn .interview-answer-card'))
      if (!answers.length) return
      const currentIndex = interviewScrollIndexRef.current ?? answers.length - 1
      const targetIndex = Math.max(0, Math.min(answers.length - 1, currentIndex + (direction === 'up' ? -1 : 1)))
      const target = answers[targetIndex]
      const containerTop = container.getBoundingClientRect().top
      const targetTop = container.scrollTop + target.getBoundingClientRect().top - containerTop
      interviewScrollIndexRef.current = targetIndex
      container.scrollTo({ top: targetTop, behavior: 'auto' })
    })
    applyScroll()
  }

  function connect(pairingId: string) {
    pairingIdRef.current = pairingId
    clearTimeout(timer.current); wsRef.current?.close(); setConnection('connecting')
    const ws = companionSocket(pairingId, lastSeq.current); wsRef.current = ws
    ws.onopen = () => { reconnect.current = 0; lastMessageAtRef.current = Date.now(); setConnection('online') }
    ws.onmessage = event => { lastMessageAtRef.current = Date.now(); try { handleEvent(JSON.parse(event.data) as Envelope) } catch { setError('收到无法识别的服务端消息') } }
    ws.onerror = () => { if (wsRef.current === ws) setConnection('offline') }
    ws.onclose = () => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      setConnection('offline'); if (document.visibilityState !== 'visible') return
      const wait = Math.min(30000, 1000 * 2 ** reconnect.current++); timer.current = window.setTimeout(() => connect(pairingId), wait)
    }
  }

  function restartConnection(pairingId = pairingIdRef.current) {
    if (!pairingId) return
    clearTimeout(timer.current)
    const socket = wsRef.current
    wsRef.current = null
    socket?.close()
    connect(pairingId)
  }

  function handleEvent(event: Envelope) {
    lastSeq.current = Math.max(lastSeq.current, event.seq || 0); const p = event.payload || {}
    switch (event.type) {
      case 'connection.state': if ('desktopConnected' in p) setDesktopOnline(Boolean(p.desktopConnected)); break
      case 'desktop.ready': setDesktopOnline(true); break
      case 'desktop.state': setStage(String(p.state || p.status || '电脑在线')); break
      case 'transcript.partial': case 'transcript.final': {
        const text = String(p.text || '')
        liveQuestionRef.current = text
        setLiveQuestion(text)
        setStage(event.type.endsWith('final') ? '问题已识别' : '正在识别')
        break
      }
      case 'answer.started': {
        const id = event.requestId || `turn-${event.seq || Date.now()}`
        const nextQuestion = String(p.question || liveQuestionRef.current || '')
        activeTurnIdRef.current = id
        liveQuestionRef.current = ''
        setLiveQuestion('')
        setInterviewTurns(current => {
          const existing = current.findIndex(turn => turn.id === id)
          const turn: InterviewTurn = { id, question: nextQuestion, answer: '', status: 'generating' }
          return existing >= 0 ? current.map((item, index) => index === existing ? turn : item) : [...current, turn]
        })
        setStage('正在生成')
        setTab('interview')
        break
      }
      case 'answer.token': {
        const token = String(p.token || '')
        const id = event.requestId || activeTurnIdRef.current
        if (id && token) {
          setInterviewTurns(current => current.map(turn => turn.id === id ? { ...turn, answer: turn.answer + token } : turn))
        }
        setStage('正在生成')
        break
      }
      case 'answer.done': {
        const id = event.requestId || activeTurnIdRef.current || `turn-${event.seq || Date.now()}`
        const finalQuestion = String(p.question || liveQuestionRef.current || '')
        const finalAnswer = String(p.answer || '')
        setInterviewTurns(current => {
          const existing = current.findIndex(turn => turn.id === id)
          if (existing < 0) return [...current, { id, question: finalQuestion, answer: finalAnswer, status: 'done' }]
          return current.map((turn, index) => index === existing ? {
            ...turn,
            question: finalQuestion || turn.question,
            answer: finalAnswer || turn.answer,
            status: 'done',
          } : turn)
        })
        if (activeTurnIdRef.current === id) activeTurnIdRef.current = null
        liveQuestionRef.current = ''
        setLiveQuestion('')
        setStage('回答完成')
        setTab('interview')
        break
      }
      case 'answer.error': {
        const message = String(p.message || '回答生成失败')
        const id = event.requestId || activeTurnIdRef.current
        if (id) setInterviewTurns(current => current.map(turn => turn.id === id ? { ...turn, answer: turn.answer || `生成失败：${message}`, status: 'error' } : turn))
        if (activeTurnIdRef.current === id) activeTurnIdRef.current = null
        setError(message)
        setStage('生成失败')
        break
      }
      case 'capture.result': case 'written.done': {
        if (p.solveMode) {
          const nextMode = normalizeWrittenSolveMode(p.solveMode)
          setSolveMode(nextMode)
          localStorage.setItem('miaoda_written_mode', nextMode)
        }
        const resultId = event.requestId || `written-${event.seq || Date.now()}`
        const next = { id: resultId, question: String(p.questionText || ''), answer: String(p.answer || '') }
        setWrittenHistory(current => {
          const existing = current.findIndex(item => item.id === resultId)
          return existing >= 0 ? current.map((item, index) => index === existing ? next : item) : [...current, next]
        })
        setStage('解题完成'); setTab('written'); refreshQuota(); break
      }
      case 'written.progress': setStage(String(p.stage || '正在解题')); break
      case 'written.language.changed': {
        const nextLanguage = normalizeWrittenLanguage(p.language)
        setLanguage(nextLanguage)
        localStorage.setItem('miaoda_written_language', nextLanguage)
        break
      }
      case 'written.mode.changed': {
        const nextMode = normalizeWrittenSolveMode(p.mode)
        setSolveMode(nextMode)
        localStorage.setItem('miaoda_written_mode', nextMode)
        break
      }
      case 'assistant.scroll': {
        const direction = p.direction === 'up' ? 'up' : 'down'
        if (p.assistant === 'interview') scrollInterviewByAnswer(direction)
        else scrollWrittenByHalfPage(direction)
        break
      }
      case 'written.scroll': scrollWrittenByHalfPage(p.direction === 'up' ? 'up' : 'down'); break
      case 'written.error': setError(String(p.message || '解题失败')); break
      case 'quota.updated': setBoot(v => v ? { ...v, quota: { remainingInterviewSeconds: Number(p.remainingInterviewSeconds ?? v.quota.remainingInterviewSeconds), remainingWrittenQuestions: Number(p.remainingWrittenQuestions ?? v.quota.remainingWrittenQuestions) } } : v); break
    }
  }

  function send(type: string, payload: Record<string, unknown> = {}) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) { setError('连接已断开，正在重连'); return }
    wsRef.current.send(JSON.stringify({ v: 1, type, seq: 0, timestamp: Date.now(), payload }))
  }
  function changeWrittenLanguage(value: string) {
    const nextLanguage = normalizeWrittenLanguage(value)
    setLanguage(nextLanguage)
    localStorage.setItem('miaoda_written_language', nextLanguage)
    send('written.language.set', { language: nextLanguage })
  }
  function changeWrittenSolveMode(value: WrittenSolveMode) {
    const nextMode = normalizeWrittenSolveMode(value)
    setSolveMode(nextMode)
    localStorage.setItem('miaoda_written_mode', nextMode)
    send('written.mode.set', { mode: nextMode })
  }
  async function pair() { try { setLoading(true); setError(''); await api.claimByCode(code.trim()); const data = await bootstrap(); connect(data.pairingId); history.replaceState({}, '', '/session') } catch (e) { setError((e as Error).message) } finally { setLoading(false) } }
  async function refreshQuota() { try { setBoot(await api.bootstrap()) } catch { /* session may have expired */ } }
  async function upload(file?: File) {
    if (!file) return
    try { setUploading(true); setError(''); setStage('正在压缩图片'); const blob = await compressImage(file); setStage('正在识题并生成答案'); const result = await api.solveImage(blob, 'question.jpg', language, solveMode); setWrittenHistory(current => [...current, { id: `upload-${Date.now()}`, question: String(result.questionText || ''), answer: String(result.answer || '') }]); setStage('解题完成'); await refreshQuota() } catch (e) { setError((e as Error).message); setStage('解题失败') } finally { setUploading(false) }
  }

  if (loading) return <Splash />
  if (!boot) return <Pairing code={code} setCode={setCode} submit={pair} error={error} loading={loading} />
  const statusText = connection === 'online' ? '手机已连接' : connection === 'connecting' ? '正在连接' : '连接已断开'
  const interviewFocus = tab === 'interview' && (interviewTurns.length > 0 || Boolean(liveQuestion))
  return <div className={`app${interviewFocus ? ' interview-focus' : ''}`} style={{ '--answer-size': `${fontSize}px` } as React.CSSProperties}>
    {!interviewFocus && <header><div><span className="eyebrow">秒答 · 手机助手</span><h1>{tabTitle(tab)}</h1></div><div className={'connection ' + connection}><i />{statusText}</div></header>}
    {error && <button className="alert" onClick={() => setError('')}>{error}<b>×</b></button>}
    <main>
      {tab === 'home' && <Home boot={boot} desktopOnline={desktopOnline} stage={stage} go={setTab} send={send} />}
      {tab === 'interview' && <Interview turns={interviewTurns} liveQuestion={liveQuestion} stage={stage} send={send} end={answerEnd} historyRef={interviewHistoryRef} />}
      {tab === 'written' && <Written results={writtenHistory} uploading={uploading} language={language} setLanguage={changeWrittenLanguage} mode={solveMode} setMode={changeWrittenSolveMode} upload={upload} request={() => { setStage('已请求电脑截图'); send('capture.request', { language, mode: solveMode }) }} answerRef={writtenAnswerRef} historyRef={writtenHistoryRef} />}
      {tab === 'settings' && <Settings boot={boot} fontSize={fontSize} setFontSize={v => { setFontSize(v); localStorage.setItem('miaoda_font_size', String(v)) }} autoScroll={autoScroll} setAutoScroll={v => { setAutoScroll(v); localStorage.setItem('miaoda_auto_scroll', String(v)) }} />}
    </main>
    <nav>{(['home','interview','written','settings'] as Tab[]).map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}><span>{({home:'⌂',interview:'◉',written:'▣',settings:'⚙'})[item]}</span>{({home:'首页',interview:'面试',written:'笔试',settings:'设置'})[item]}</button>)}</nav>
  </div>
}

function Splash(){return <div className="splash"><div className="mark">秒</div><h1>正在连接秒答</h1><p>准备安全会话...</p></div>}
function Pairing({code,setCode,submit,error,loading}:{code:string;setCode:(v:string)=>void;submit:()=>void;error:string;loading:boolean}){return <div className="pair-page"><section className="pair-card"><div className="mark">秒</div><span className="eyebrow">秒答手机助手</span><h1>连接你的电脑</h1><p>扫描电脑端二维码会自动进入。也可以输入电脑上显示的 6 位配对码。</p><label>配对码</label><input className="code" inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000 000" onKeyDown={e=>e.key==='Enter'&&submit()} />{error&&<div className="pair-error">{error}</div>}<button className="primary wide" disabled={code.length!==6||loading} onClick={submit}>{loading?'正在连接...':'立即连接'}</button><small>配对码 120 秒内有效 · 不会在手机保存卡密</small></section></div>}
function Home({boot,desktopOnline,stage,go,send}:{boot:Bootstrap;desktopOnline:boolean;stage:string;go:(t:Tab)=>void;send:(t:string,p?:Record<string,unknown>)=>void}){return <><section className="hero-card"><div className="computer-icon">⌘</div><div><span className={'pill '+(desktopOnline?'good':'')}>{desktopOnline?'电脑在线':'等待电脑连接'}</span><h2>{stage}</h2><p>设备 {boot.desktopDeviceId}</p></div></section><section className="quota"><article><span>面试剩余</span><strong>{Math.floor(boot.quota.remainingInterviewSeconds/60)}</strong><em>分钟</em></article><article><span>笔试剩余</span><strong>{boot.quota.remainingWrittenQuestions}</strong><em>题</em></article></section><h3 className="section-title">快捷操作</h3><section className="quick"><button onClick={()=>{send('interview.start');go('interview')}}><b>◉</b><span>开始面试<small>接收问题与回答</small></span></button><button onClick={()=>go('written')}><b>▣</b><span>笔试解题<small>截图或拍照上传</small></span></button></section></>}
function Interview({turns,liveQuestion,stage,send,end,historyRef}:{turns:InterviewTurn[];liveQuestion:string;stage:string;send:(t:string,p?:Record<string,unknown>)=>void;end:React.RefObject<HTMLDivElement|null>;historyRef:React.RefObject<HTMLDivElement|null>}) {
  const [manual, setManual] = useState('')
  return <section className="interview-page">
    <div className="stage-line"><span className="pulse" />{stage}</div>
    <div ref={historyRef} className="interview-history">
      {turns.length === 0 && !liveQuestion && <div className="interview-empty">等待电脑识别问题，也可以在下方手动输入</div>}
      {turns.map(turn => {
        const displayAnswer = compactInterviewAnswer(turn.answer)
        const density = interviewAnswerDensity(displayAnswer)
        return <article className="interview-turn" key={turn.id}>
          <section className="question-card"><span>问题</span><p>{turn.question}</p></section>
          <section className="answer-card interview-answer-card"><span>回答</span><div className={`answer interview-answer${density}`}>{displayAnswer || <i>{turn.status === 'generating' ? '答案正在实时生成...' : '暂无答案'}</i>}</div></section>
        </article>
      })}
      {liveQuestion && <section className="question-card live-question-card"><span>正在识别</span><p>{liveQuestion}</p></section>}
      <div ref={end}/>
    </div>
    <section className="composer"><textarea value={manual} onChange={e => setManual(e.target.value)} placeholder="手动输入问题..."/><button onClick={() => { if (manual.trim()) { send('question.manual', { question: manual.trim() }); setManual('') } }}>发送</button></section>
  </section>
}
function Written({results,uploading,language,setLanguage,mode,setMode,upload,request,answerRef,historyRef}:{results:WrittenResult[];uploading:boolean;language:string;setLanguage:(v:string)=>void;mode:WrittenSolveMode;setMode:(v:WrittenSolveMode)=>void;upload:(f?:File)=>void;request:()=>void;answerRef:React.RefObject<HTMLElement|null>;historyRef:React.RefObject<HTMLElement|null>}) {
  return <>
    <div className="written-language-toolbar"><button type="button" className="written-mode-button" aria-label="切换笔试解题模式" onClick={()=>setMode(mode === 'code' ? 'leetcode' : 'code')}>{writtenSolveModeLabel(mode)}</button><label><span>代码语言</span><select aria-label="切换笔试代码语言" value={language} onChange={e=>setLanguage(e.target.value)}><WrittenLanguageOptions /></select></label></div>
    <section className="upload-card"><div className="upload-icon">▣</div><h2>获取题目</h2><p>让电脑隐藏截图，或直接使用手机拍照、选择相册图片。</p><button className="primary wide" onClick={request}>请求电脑截图</button><div className="or"><span>或者</span></div><label className="file-button">{uploading?'正在处理...':'拍照 / 从相册选择'}<input type="file" accept="image/*" capture="environment" disabled={uploading} onChange={e=>upload(e.target.files?.[0])}/></label>
    </section>
    {results.length > 0 && <section ref={historyRef} className="written-history">{results.map((result, index) => <article className="written-result" key={result.id}><section className="question-card"><span>识别题目 {index + 1}</span><p>{result.question}</p></section><section ref={index === results.length - 1 ? answerRef : undefined} className="answer-card written-answer-card"><span>解题结果</span><div className={`answer pre written-answer${writtenAnswerDensity(result.answer || '')}`}>{result.answer}</div></section></article>)}</section>}
  </>
}
function Settings({boot,fontSize,setFontSize,autoScroll,setAutoScroll}:{boot:Bootstrap;fontSize:number;setFontSize:(n:number)=>void;autoScroll:boolean;setAutoScroll:(v:boolean)=>void}){return <section className="settings"><h3>显示设置</h3><label><span>答案字号<small>{fontSize}px</small></span><input type="range" min="15" max="28" value={fontSize} onChange={e=>setFontSize(+e.target.value)}/></label><label><span>自动滚动<small>新回答保持可见</small></span><input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)}/></label><h3>当前会话</h3><div className="info"><span>配对 ID</span><code>{boot.pairingId}</code><span>服务时间</span><b>{new Date(boot.serverTime).toLocaleString()}</b></div><p className="privacy">页面不会将卡密、截图或答案写入浏览器缓存。关闭或解除配对后，下次使用请重新扫描电脑二维码。</p></section>}
function tabTitle(tab:Tab){return ({home:'会话中心',interview:'面试助手',written:'笔试助手',settings:'设置'})[tab]}
