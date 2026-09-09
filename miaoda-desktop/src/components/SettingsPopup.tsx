import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Keybind = {
  id: string;
  label: string;
  accelerator: string;
  isGlobal: boolean;
  defaultAccelerator: string;
};

const CONFIGURABLE_IDS = [
  'general:toggle-visibility',
  'general:quit-app',
  'general:toggle-mouse-passthrough',
  'general:capture-and-process',
  'general:capture-leetcode',
  'general:mobile-written-scroll-up',
  'general:mobile-written-scroll-down',
];

const SHORTCUT_COPY: Record<string, { label: string; description: string }> = {
  'general:toggle-visibility': { label: '隐藏 / 恢复窗口', description: '隐藏正在运行的客户端，再次按下即可恢复' },
  'general:quit-app': { label: '退出秒答', description: '完全退出客户端并结束后台进程' },
  'general:toggle-mouse-passthrough': { label: '鼠标穿透', description: '让鼠标操作落到客户端后方窗口' },
  'general:capture-and-process': { label: '截图并生成 ACM 答案', description: '截取屏幕并生成含输入输出的完整程序' },
  'general:capture-leetcode': { label: '截图并生成核心代码', description: '截取屏幕并只生成方法、函数等核心代码' },
  'general:mobile-written-scroll-up': { label: '电脑与手机答案上翻', description: '面试回到上一题，笔试向上翻半页，两端同步' },
  'general:mobile-written-scroll-down': { label: '电脑与手机答案下翻', description: '面试前往下一题，笔试向下翻半页，两端同步' },
};

function displayAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Command/gi, 'Cmd')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Super/gi, 'Win');
}

function normalizeAccelerator(accelerator: string): string {
  return accelerator.split('+').map((part) => part.trim().toLowerCase()).sort().join('+');
}

type ShortcutKeyInput = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

function keyboardEventToAccelerator(event: ShortcutKeyInput): string | null {
  const modifiers: string[] = [];
  const isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
  if (event.ctrlKey) modifiers.push(isMac ? 'Control' : 'CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push(isMac ? 'Command' : 'Super');

  const ignored = new Set(['Control', 'Shift', 'Alt', 'Meta']);
  if (ignored.has(event.key)) return null;

  const keyAliases: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
  };
  const key = keyAliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  if (!modifiers.length || !key) return null;
  return [...modifiers, key].join('+');
}

const SettingsPopup: React.FC = () => {
  const [keybinds, setKeybinds] = useState<Keybind[]>([]);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [message, setMessage] = useState('点击任意快捷键后，直接按下新的组合键');
  const [conflict, setConflict] = useState<{ ids: string[]; accelerator: string } | null>(null);
  const [draftAccelerator, setDraftAccelerator] = useState<string | null>(null);

  const loadKeybinds = useCallback(async () => {
    const next = await window.electronAPI.getKeybinds?.();
    if (next) setKeybinds(next);
  }, []);

  useEffect(() => {
    void loadKeybinds();
    const unsubscribe = window.electronAPI.onKeybindsUpdate?.(setKeybinds);
    return () => unsubscribe?.();
  }, [loadKeybinds]);

  useEffect(() => () => {
    void window.electronAPI.setKeybindRecordingSuspended?.(false);
  }, []);

  useEffect(() => window.electronAPI.onKeybindRecordingCancelled?.(() => {
    void window.electronAPI.setKeybindRecordingSuspended?.(false);
    setRecordingId(null);
    setConflict(null);
    setDraftAccelerator(null);
    setMessage('点击任意快捷键后，直接按下新的组合键');
  }) || (() => undefined), []);

  useEffect(() => {
    const element = document.getElementById('miaoda-settings-popup');
    if (!element) return;
    const resize = () => {
      void window.electronAPI.updateContentDimensions?.({
        width: Math.ceil(element.getBoundingClientRect().width),
        height: Math.ceil(element.getBoundingClientRect().height),
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const visibleKeybinds = useMemo(() => CONFIGURABLE_IDS
    .map((id) => keybinds.find((item) => item.id === id))
    .filter((item): item is Keybind => Boolean(item)), [keybinds]);

  const recordShortcut = async (input: ShortcutKeyInput, keybind: Keybind) => {
    if (input.key === 'Escape' && !input.ctrlKey && !input.altKey && !input.shiftKey && !input.metaKey) {
      await window.electronAPI.setKeybindRecordingSuspended?.(false);
      setRecordingId(null);
      setConflict(null);
      setDraftAccelerator(null);
      setMessage('已取消修改');
      return;
    }
    const accelerator = keyboardEventToAccelerator(input);
    if (!accelerator) {
      setConflict(null);
      setDraftAccelerator(null);
      setMessage('快捷键至少需要 Ctrl、Alt、Shift 或 Cmd 中的一个修饰键');
      return;
    }
    setDraftAccelerator(accelerator);
    const conflictingKeybind = keybinds.find((item) => item.id !== keybind.id
      && item.accelerator
      && normalizeAccelerator(item.accelerator) === normalizeAccelerator(accelerator));
    if (conflictingKeybind) {
      const conflictingLabel = SHORTCUT_COPY[conflictingKeybind.id]?.label || conflictingKeybind.label;
      setConflict({ ids: [keybind.id, conflictingKeybind.id], accelerator });
      setMessage(`快捷键冲突：${displayAccelerator(accelerator)} 已用于“${conflictingLabel}”，请重新设置`);
      return;
    }
    await window.electronAPI.setKeybindRecordingSuspended?.(false);
    const saved = await window.electronAPI.setKeybind?.(keybind.id, accelerator);
    if (saved === false) {
      await window.electronAPI.setKeybindRecordingSuspended?.(true);
      setConflict({ ids: [keybind.id], accelerator });
      setMessage(`快捷键冲突：${displayAccelerator(accelerator)} 可能已被系统或其他软件占用，请修改`);
      return;
    }
    setKeybinds((items) => items.map((item) => item.id === keybind.id ? { ...item, accelerator } : item));
    setRecordingId(null);
    setConflict(null);
    setDraftAccelerator(null);
    setMessage(`${SHORTCUT_COPY[keybind.id]?.label || keybind.label} 已改为 ${displayAccelerator(accelerator)}`);
  };

  useEffect(() => window.electronAPI.onKeybindRecordingInput?.((input) => {
    if (!recordingId) return;
    const keybind = keybinds.find((item) => item.id === recordingId);
    if (keybind) void recordShortcut(input, keybind);
  }) || (() => undefined), [keybinds, recordingId]);

  const resetAll = async () => {
    await window.electronAPI.setKeybindRecordingSuspended?.(false);
    const next = await window.electronAPI.resetKeybinds?.();
    if (next) setKeybinds(next);
    setRecordingId(null);
    setConflict(null);
    setDraftAccelerator(null);
    setMessage('已恢复默认快捷键');
  };

  return (
    <div id="miaoda-settings-popup" className="miaoda-settings-popup">
      <header className="miaoda-settings-head" title="按住标题区域可拖动窗口">
        <div><span>偏好设置 · 拖动窗口</span><strong>快捷键</strong></div>
        <button type="button" onClick={() => void resetAll()}>恢复默认</button>
      </header>

      <p className={conflict ? 'miaoda-settings-hint error' : 'miaoda-settings-hint'}>{message}</p>
      <div className="miaoda-shortcut-list">
        {visibleKeybinds.map((keybind) => {
          const copy = SHORTCUT_COPY[keybind.id] || { label: keybind.label, description: '全局快捷键' };
          const recording = recordingId === keybind.id;
          const conflicting = Boolean(conflict?.ids.includes(keybind.id));
          return (
            <div className={`miaoda-shortcut-item${recording ? ' recording' : ''}${conflicting ? ' conflict' : ''}`} key={keybind.id}>
              <span><b>{copy.label}</b><small>{copy.description}</small></span>
              <button
                type="button"
                autoFocus={recording}
                onClick={() => { void (async () => { await window.electronAPI.setKeybindRecordingSuspended?.(true); setConflict(null); setDraftAccelerator(null); setRecordingId(keybind.id); setMessage('请按下新的组合键，单按 Esc 取消'); })(); }}
                onKeyDown={(event) => {
                  if (!recording) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void recordShortcut(event, keybind);
                }}
              >{recording ? draftAccelerator ? displayAccelerator(draftAccelerator) : '请按键…' : displayAccelerator(keybind.accelerator)}</button>
            </div>
          );
        })}
      </div>
      <footer>快捷键为全局生效，在腾讯会议或浏览器中也可以使用。</footer>
    </div>
  );
};

export default SettingsPopup;
