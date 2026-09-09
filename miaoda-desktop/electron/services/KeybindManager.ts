import { app, globalShortcut, Menu, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { loadNativeModule } from '../audio/nativeModuleLoader';

export interface KeybindConfig {
    id: string;
    label: string;
    accelerator: string; // Electron Accelerator string
    isGlobal: boolean;   // Registered with globalShortcut
    defaultAccelerator: string;
}

export const DEFAULT_KEYBINDS: KeybindConfig[] = [
    // General
    { id: 'general:toggle-visibility', label: '隐藏 / 恢复窗口', accelerator: 'CommandOrControl+Shift+M', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+M' },
    { id: 'general:quit-app', label: '退出秒答', accelerator: 'Control+Esc', isGlobal: true, defaultAccelerator: 'Control+Esc' },
    { id: 'general:toggle-mouse-passthrough', label: '鼠标穿透', accelerator: 'CommandOrControl+Shift+Z', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Z' },
    { id: 'general:process-screenshots', label: 'Process Screenshots', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'general:capture-and-process', label: 'Capture Screen & Ask AI (Global)', accelerator: 'CommandOrControl+Shift+C', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+C' },
    { id: 'general:capture-leetcode', label: 'Capture Screen & Solve (LeetCode Core)', accelerator: 'CommandOrControl+Shift+V', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+V' },
    { id: 'general:mobile-written-scroll-up', label: 'Scroll Desktop and Phone Assistant Up', accelerator: 'CommandOrControl+Shift+Up', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Up' },
    { id: 'general:mobile-written-scroll-down', label: 'Scroll Desktop and Phone Assistant Down', accelerator: 'CommandOrControl+Shift+Down', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+Down' },
    { id: 'general:reset-cancel', label: 'Reset / Cancel', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'general:take-screenshot', label: 'Take Screenshot', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'general:selective-screenshot', label: 'Selective Screenshot', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    // Capture the active browser tab's page context via the companion extension;
    // falls back to a screenshot when no extension/browser is reachable. Works
    // from any focused app (including the 秒答 overlay), which the old
    // Chrome-owned hotkey could not. See miaoda-browser/README.md.
    { id: 'general:capture-dom', label: 'Capture Page / Screen (Browser)', accelerator: '', isGlobal: true, defaultAccelerator: '' },

    // Chat - Global shortcuts (work even when app is not focused - stealth mode)
    { id: 'chat:whatToAnswer', label: 'What to Answer', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:clarify', label: 'Clarify', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:dynamicAction4', label: 'Recap / Brainstorm', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:followUp', label: 'Follow Up', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:answer', label: 'Answer / Record', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:codeHint', label: 'Get Code Hint', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:brainstorm', label: 'Brainstorm Approaches', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    // Scroll shortcuts are global so they work in stealth mode without the user
    // having to click the 秒答 window first (regression fix for issue #233).
    // Each press kicks an inertial scroll loop in the renderer: a single tap
    // glides ~250ms then decelerates, rapid taps sustain motion. macOS Carbon
    // HotKey API does not auto-repeat with Cmd held, so inertia is what gives
    // the "hold to scroll" feel without a native key listener.
    //
    // Horizontal uses Cmd/Ctrl+Alt+Left/Right to avoid colliding with the macOS
    // line-start/line-end caret-jump shortcut that would otherwise misfire in
    // every text input system-wide while 秒答 is running.
    { id: 'chat:scrollUp', label: 'Scroll Up', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:scrollDown', label: 'Scroll Down', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:scrollLeft', label: 'Scroll Left (code block)', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'chat:scrollRight', label: 'Scroll Right (code block)', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    // CommandOrControl+Shift+Space because bare Cmd+Space is Spotlight on macOS
    // and Ctrl+Space is the IME source switcher. The overlay is created with
    // type:'panel' on macOS, so focusing it does not activate the 秒答 app —
    // the user's foreground app keeps focus in the dock/menu bar/screen-share.
    { id: 'chat:focusInput', label: 'Toggle Stealth Typing', accelerator: '', isGlobal: true, defaultAccelerator: '' },

    // Window Movement - Global shortcuts (stealth window positioning)
    { id: 'window:move-up', label: 'Move Window Up', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'window:move-down', label: 'Move Window Down', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'window:move-left', label: 'Move Window Left', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'window:move-right', label: 'Move Window Right', accelerator: '', isGlobal: true, defaultAccelerator: '' },
];

const LITE_CONFIGURABLE_ACCELERATORS: Record<string, string> = {
    'general:toggle-visibility': 'CommandOrControl+Shift+M',
    'general:quit-app': 'Control+Esc',
    'general:toggle-mouse-passthrough': 'CommandOrControl+Shift+Z',
    'general:capture-and-process': 'CommandOrControl+Shift+C',
    'general:capture-leetcode': 'CommandOrControl+Shift+V',
    'general:mobile-written-scroll-up': 'CommandOrControl+Shift+Up',
    'general:mobile-written-scroll-down': 'CommandOrControl+Shift+Down',
};

// Migrate only the shortcuts that still match the previous shipped defaults.
// User-defined combinations remain untouched while old screenshot defaults
// migrate to the current C/V combinations.
const LEGACY_LITE_ACCELERATORS: Record<string, string[]> = {
    'general:toggle-visibility': ['CommandOrControl+Shift+X', 'CommandOrControl+Shift+Y'],
    'general:capture-and-process': ['CommandOrControl+Shift+Y'],
    'general:capture-leetcode': ['CommandOrControl+Shift+B'],
};

export class KeybindManager {
    private static instance: KeybindManager;
    private keybinds: Map<string, KeybindConfig> = new Map();
    private filePath: string;
    private windowHelper: any; // Type avoided for circular dep, passed in init
    private onUpdateCallbacks: (() => void)[] = [];
    private onShortcutTriggeredCallbacks: ((actionId: string) => void)[] = [];
    private onShortcutRecordingSuspendedCallbacks: ((suspended: boolean) => void)[] = [];
    private activeMode: 'launcher' | 'overlay' = 'launcher';
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private nativeExitShortcutTimer: NodeJS.Timeout | null = null;
    private nativeExitShortcutHeld = false;
    private shortcutRecordingSuspended = false;
    // How often to poll that OS-registered shortcuts are still alive (ms).
    // 10 s is aggressive enough to recover within one poll cycle after a
    // passthrough toggle, sleep/wake, or workspace switch.
    private static readonly HEALTH_CHECK_INTERVAL_MS = 10_000;

    public setMode(mode: 'launcher' | 'overlay') {
        if (this.activeMode === mode) return;
        this.activeMode = mode;
        console.log(`[KeybindManager] Mode changed to: ${mode}. Refreshing global shortcuts.`);
        this.registerGlobalShortcuts();
    }

    private shouldRegister(actionId: string): boolean {
        if (this.activeMode === 'overlay') return true;

        // In launcher mode, register visibility + movement shortcuts
        if (actionId === 'general:toggle-visibility') return true;
        if (actionId === 'general:quit-app') return true;
        if (actionId === 'general:toggle-mouse-passthrough') return true;
        if (actionId.startsWith('window:move-')) return true;

        // Screenshot & screen-analyze shortcuts must work globally in BOTH modes.
        // Without these, Cmd+H / Cmd+Shift+H / Cmd+Shift+Enter do nothing in
        // launcher mode because globalShortcut.register() is never called for them.
        // Also fixes the silent rebind failure: re-registration after setKeybind()
        // hit the same gate and dropped the newly bound accelerator too.
        if (actionId === 'general:take-screenshot') return true;
        if (actionId === 'general:selective-screenshot') return true;
        if (actionId === 'general:capture-and-process') return true;
        if (actionId === 'general:capture-leetcode') return true;
        if (actionId === 'general:mobile-written-scroll-up') return true;
        if (actionId === 'general:mobile-written-scroll-down') return true;
        // Browser/page capture must work globally in both modes (same rationale
        // as the screenshot shortcuts — it's a global capture trigger).
        if (actionId === 'general:capture-dom') return true;

        return false;
    }

    private applyLiteShortcutPolicy(): boolean {
        let changed = false;
        this.keybinds.forEach((kb, id) => {
            const defaultLite = Object.prototype.hasOwnProperty.call(LITE_CONFIGURABLE_ACCELERATORS, id)
                ? LITE_CONFIGURABLE_ACCELERATORS[id]
                : '';
            const nextAccelerator = defaultLite ? (kb.accelerator || defaultLite) : '';
            if (kb.accelerator !== nextAccelerator || kb.defaultAccelerator !== defaultLite) {
                kb.accelerator = nextAccelerator;
                kb.defaultAccelerator = defaultLite;
                this.keybinds.set(id, kb);
                changed = true;
            }
        });
        return changed;
    }

    private migrateLegacyLiteDefaults(): boolean {
        let changed = false;
        Object.entries(LEGACY_LITE_ACCELERATORS).forEach(([id, legacyAccelerators]) => {
            const kb = this.keybinds.get(id);
            const nextAccelerator = LITE_CONFIGURABLE_ACCELERATORS[id];
            if (!kb || !legacyAccelerators.some((legacyAccelerator) =>
                this.normalizeAccelerator(kb.accelerator) === this.normalizeAccelerator(legacyAccelerator))) return;
            kb.accelerator = nextAccelerator;
            this.keybinds.set(id, kb);
            changed = true;
        });
        return changed;
    }

    private normalizeAccelerator(acc: string): string {
        if (!acc) return '';
        // Electron accelerators are case-insensitive and order-independent for modifiers.
        // We split, lowercase, and sort to ensure consistent string matching.
        // E.g., 'Shift+CommandOrControl+Up' === 'CommandOrControl+Shift+Up'
        const parts = acc.split('+').map(p => p.trim().toLowerCase());
        parts.sort();
        return parts.join('+');
    }

    private usesNativeExitShortcutFallback(actionId: string, accelerator: string): boolean {
        if (process.platform !== 'win32' || actionId !== 'general:quit-app') return false;
        const normalized = this.normalizeAccelerator(accelerator);
        return normalized === this.normalizeAccelerator('Control+Esc')
            || normalized === this.normalizeAccelerator('Control+Escape')
            || normalized === this.normalizeAccelerator('CommandOrControl+Esc')
            || normalized === this.normalizeAccelerator('CommandOrControl+Escape');
    }

    private stopNativeExitShortcutPolling(): void {
        if (this.nativeExitShortcutTimer) clearInterval(this.nativeExitShortcutTimer);
        this.nativeExitShortcutTimer = null;
        this.nativeExitShortcutHeld = false;
    }

    private startNativeExitShortcutPolling(): void {
        this.stopNativeExitShortcutPolling();
        if (this.shortcutRecordingSuspended) return;
        const keybind = this.keybinds.get('general:quit-app');
        if (!keybind || !this.usesNativeExitShortcutFallback(keybind.id, keybind.accelerator)) return;
        const native = loadNativeModule();
        if (typeof native?.getPressedShortcutKey !== 'function') {
            console.warn('[KeybindManager] Native Ctrl+Esc fallback is unavailable; exit shortcut could not be registered.');
            return;
        }

        this.nativeExitShortcutTimer = setInterval(() => {
            try {
                const input = native.getPressedShortcutKey?.();
                const held = Boolean(input
                    && input.ctrlKey
                    && !input.altKey
                    && !input.shiftKey
                    && !input.metaKey
                    && input.key.toLowerCase() === 'escape');
                if (held && !this.nativeExitShortcutHeld) {
                    this.onShortcutTriggeredCallbacks.forEach(cb => cb('general:quit-app'));
                }
                this.nativeExitShortcutHeld = held;
            } catch (error) {
                console.error('[KeybindManager] Native Ctrl+Esc polling failed:', error);
                this.stopNativeExitShortcutPolling();
            }
        }, 24);
        this.nativeExitShortcutTimer.unref?.();
    }

    private constructor() {
        this.filePath = path.join(app.getPath('userData'), 'keybinds.json');
        this.load();
    }

    public onUpdate(callback: () => void) {
        this.onUpdateCallbacks.push(callback);
    }

    public onShortcutTriggered(callback: (actionId: string) => void) {
        this.onShortcutTriggeredCallbacks.push(callback);
    }

    public onShortcutRecordingSuspended(callback: (suspended: boolean) => void) {
        this.onShortcutRecordingSuspendedCallbacks.push(callback);
    }

    public static getInstance(): KeybindManager {
        if (!KeybindManager.instance) {
            KeybindManager.instance = new KeybindManager();
        }
        return KeybindManager.instance;
    }

    public setWindowHelper(windowHelper: any) {
        this.windowHelper = windowHelper;
    }

    public setShortcutRecordingSuspended(suspended: boolean): void {
        if (this.shortcutRecordingSuspended === suspended) {
            this.onShortcutRecordingSuspendedCallbacks.forEach(cb => cb(suspended));
            return;
        }
        this.shortcutRecordingSuspended = suspended;
        this.onShortcutRecordingSuspendedCallbacks.forEach(cb => cb(suspended));
        if (suspended) {
            globalShortcut.unregisterAll();
            this.stopHealthCheck();
            this.stopNativeExitShortcutPolling();
            this.updateMenu();
            return;
        }
        this.registerGlobalShortcuts();
    }

    private load() {
        // 1. Load Defaults
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));

        // 2. Load Overrides
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));

                // Migrate renamed IDs so saved user customizations survive renames
                const ID_MIGRATIONS: Record<string, string> = {
                    'chat:recap': 'chat:dynamicAction4',
                    'chat:followup': 'chat:followUp',  // casing fix — persisted keybinds.json may have old casing
                };
                for (const fileKb of data) {
                    if (ID_MIGRATIONS[fileKb.id]) {
                        fileKb.id = ID_MIGRATIONS[fileKb.id];
                    }
                }

                // Validate and merge
                let hadConflicts = false;
                for (const fileKb of data) {
                    if (this.keybinds.has(fileKb.id)) {
                        const current = this.keybinds.get(fileKb.id)!;

                        // Deduplicate: If another keybind is already using this accelerator, skip or clear it
                        if (fileKb.accelerator && fileKb.accelerator.trim() !== '') {
                            let conflictId: string | null = null;
                            const normalizedNew = this.normalizeAccelerator(fileKb.accelerator);
                            this.keybinds.forEach((kb, existingId) => {
                                if (existingId !== fileKb.id && this.normalizeAccelerator(kb.accelerator) === normalizedNew) {
                                    conflictId = existingId;
                                }
                            });
                            
                            if (conflictId) {
                                // EC-03 fix: mark that we resolved a conflict so we can persist below
                                const conflictKb = this.keybinds.get(conflictId)!;
                                conflictKb.accelerator = '';
                                this.keybinds.set(conflictId, conflictKb);
                                hadConflicts = true;
                            }
                        }

                        current.accelerator = fileKb.accelerator;
                        this.keybinds.set(fileKb.id, current);
                    }
                }

                // EC-03 fix: persist resolved conflicts so they are not re-detected on next launch
                if (hadConflicts) {
                    this.save();
                }
            }
        } catch (error) {
            console.error('[KeybindManager] Failed to load keybinds:', error);
        }
        const migratedLegacyDefaults = this.migrateLegacyLiteDefaults();
        if (this.applyLiteShortcutPolicy() || migratedLegacyDefaults) {
            this.save();
        }
    }

    private save() {
        try {
            const data = Array.from(this.keybinds.values()).map(kb => ({
                id: kb.id,
                accelerator: kb.accelerator
            }));
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
            fs.renameSync(tmpPath, this.filePath);
        } catch (error) {
            console.error('[KeybindManager] Failed to save keybinds:', error);
        }
    }

    public getKeybind(id: string): string | undefined {
        return this.keybinds.get(id)?.accelerator;
    }

    public getAllKeybinds(): KeybindConfig[] {
        return Array.from(this.keybinds.values());
    }

    private isReservedSystemAccelerator(accelerator: string): boolean {
        if (process.platform !== 'win32') return false;
        const parts = accelerator.split('+').map(part => part.trim().toLowerCase()).filter(Boolean);
        const tokens = new Set(parts);
        const modifiers = new Set(['commandorcontrol', 'command', 'cmd', 'control', 'ctrl', 'alt', 'shift', 'super', 'win']);
        const key = parts.find(part => !modifiers.has(part)) || '';
        const hasCtrl = tokens.has('commandorcontrol') || tokens.has('control') || tokens.has('ctrl');
        const hasAlt = tokens.has('alt');
        const hasShift = tokens.has('shift');
        const hasSuper = tokens.has('super') || tokens.has('win');

        // Windows shell and secure-attention combinations should never be
        // reassigned by the app, even on systems where RegisterHotKey happens
        // to return true for one of them.
        if (key === 'printscreen') return true;
        if (hasAlt && ['tab', 'escape', 'esc', 'f4', 'space'].includes(key)) return true;
        if (hasCtrl && (key === 'escape' || key === 'esc')) return true;
        if (hasCtrl && hasShift && (key === 'escape' || key === 'esc')) return true;
        if (hasCtrl && hasAlt && key === 'delete') return true;
        const windowsShellKeys = new Set([
            'a', 'c', 'd', 'e', 'g', 'h', 'i', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'u', 'v', 'w', 'x', 'z',
            'tab', 'space', 'home', 'up', 'down', 'left', 'right', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            ',', '.', '/', 'plus', '-',
        ]);
        if (hasSuper && windowsShellKeys.has(key)) return true;
        return false;
    }

    public setKeybind(id: string, accelerator: string): boolean {
        if (!this.keybinds.has(id)) return false;
        if (!Object.prototype.hasOwnProperty.call(LITE_CONFIGURABLE_ACCELERATORS, id)) {
            return false;
        }
        if (!accelerator) accelerator = LITE_CONFIGURABLE_ACCELERATORS[id];

        const currentKb = this.keybinds.get(id)!;
        const oldAccelerator = currentKb.accelerator || '';

        // Reject application-level conflicts. Swapping two actions implicitly is
        // surprising and hides the conflict from the settings UI.
        if (accelerator && accelerator.trim() !== '') {
            const normalizedNew = this.normalizeAccelerator(accelerator);
            let conflictId: string | null = null;

            this.keybinds.forEach((kb, existingId) => {
                if (existingId !== id && this.normalizeAccelerator(kb.accelerator) === normalizedNew) {
                    conflictId = existingId;
                }
            });

            if (conflictId) return false;
        }

        if (accelerator && this.isReservedSystemAccelerator(accelerator)
            && !this.usesNativeExitShortcutFallback(id, accelerator)) return false;

        currentKb.accelerator = accelerator;
        this.keybinds.set(id, currentKb);

        this.save();
        this.registerGlobalShortcuts(); // Re-register if it was a global one

        // globalShortcut.register() returns no durable error object. Verify the
        // actual OS registration and roll back when another application owns it.
        if (currentKb.isGlobal
            && this.shouldRegister(id)
            && !this.usesNativeExitShortcutFallback(id, accelerator)
            && !globalShortcut.isRegistered(accelerator)) {
            currentKb.accelerator = oldAccelerator;
            this.keybinds.set(id, currentKb);
            this.save();
            this.registerGlobalShortcuts();
            this.broadcastUpdate();
            return false;
        }

        this.broadcastUpdate();
        return true;
    }

    public resetKeybinds() {
        this.keybinds.clear();
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));
        this.applyLiteShortcutPolicy();
        this.save();
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    public registerGlobalShortcuts() {
        globalShortcut.unregisterAll();
        this.stopHealthCheck();
        this.stopNativeExitShortcutPolling();
        if (this.shortcutRecordingSuspended) {
            this.updateMenu();
            return;
        }

        this.keybinds.forEach(kb => {
            if (kb.isGlobal && kb.accelerator && kb.accelerator.trim() !== '') {
                if (!this.shouldRegister(kb.id)) return;

                const acc = kb.accelerator.trim();
                if (this.usesNativeExitShortcutFallback(kb.id, acc)) return;
                try {
                    globalShortcut.register(acc, () => {
                        this.onShortcutTriggeredCallbacks.forEach(cb => cb(kb.id));
                    });
                    if (globalShortcut.isRegistered(acc)) {
                        console.log(`[KeybindManager] Registered global shortcut: ${acc} -> ${kb.id}`);
                    } else {
                        console.warn(`[KeybindManager] Failed to register global shortcut (likely in use by OS): ${acc}`);
                        // Notify renderer so the UI can surface a warning to the user (issue #136)
                        BrowserWindow.getAllWindows().forEach(win => {
                            if (!win.isDestroyed()) {
                                win.webContents.send('keybinds:registration-failed', { id: kb.id, accelerator: acc });
                            }
                        });
                    }
                } catch (e) {
                    console.error(`[KeybindManager] Exception while registering global shortcut ${acc}:`, e);
                }
            }
        });

        this.startNativeExitShortcutPolling();

        this.updateMenu();

        // (Re-)start the health-check loop so it always reflects the current
        // registered set after any full re-registration.
        this.startHealthCheck();
    }

    /**
     * Surgically re-registers any global shortcuts the OS silently dropped.
     *
     * Unlike registerGlobalShortcuts() this does NOT call unregisterAll() first,
     * so there is never a window where shortcuts are momentarily absent.  It is
     * safe to call from the periodic health-check timer or right after a window
     * interaction-policy change (e.g. passthrough toggle).
     */
    public revalidateShortcuts(): void {
        if (this.shortcutRecordingSuspended) return;
        let lost = 0;
        let recovered = 0;

        this.keybinds.forEach(kb => {
            if (!kb.isGlobal || !kb.accelerator || kb.accelerator.trim() === '') return;
            if (!this.shouldRegister(kb.id)) return;

            const acc = kb.accelerator.trim();
            if (this.usesNativeExitShortcutFallback(kb.id, acc)) return;
            if (globalShortcut.isRegistered(acc)) return; // still alive — nothing to do

            lost++;
            try {
                globalShortcut.register(acc, () => {
                    this.onShortcutTriggeredCallbacks.forEach(cb => cb(kb.id));
                });
                if (globalShortcut.isRegistered(acc)) {
                    recovered++;
                    console.warn(`[KeybindManager] Recovered lost shortcut: ${acc} -> ${kb.id}`);
                } else {
                    console.error(`[KeybindManager] Could not recover shortcut ${acc} -> ${kb.id} (OS conflict?)`);
                }
            } catch (e) {
                console.error(`[KeybindManager] Exception re-registering shortcut ${acc}:`, e);
            }
        });

        if (lost > 0) {
            console.warn(`[KeybindManager] Health check: ${lost} shortcut(s) were dropped by OS, ${recovered} recovered.`);
        }
    }

    /**
     * Starts (or restarts) the periodic shortcut health-check timer.
     * Called automatically at the end of registerGlobalShortcuts() so the timer
     * always tracks the most recently registered set.
     */
    private startHealthCheck(): void {
        this.stopHealthCheck();
        this.healthCheckTimer = setInterval(() => {
            this.revalidateShortcuts();
        }, KeybindManager.HEALTH_CHECK_INTERVAL_MS);
        // Allow the Node.js process to exit even if this timer is still running.
        if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
    }

    /** Clears the health-check interval (called before a full re-registration). */
    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    public updateMenu() {
        // On Windows/Linux, set a minimal menu (for shortcuts like DevTools)
        // but hide the menu bar from the UI
        if (process.platform !== 'darwin') {
            const template: any[] = [
                {
                    label: 'View',
                    submenu: [
                        { role: 'reload' },
                        { role: 'forceReload' },
                        { role: 'toggleDevTools' },
                        { type: 'separator' },
                        { role: 'resetZoom' },
                        { role: 'zoomIn' },
                        { role: 'zoomOut' },
                        { type: 'separator' },
                        { role: 'togglefullscreen' }
                    ]
                }
            ];
            const menu = Menu.buildFromTemplate(template);
            Menu.setApplicationMenu(menu);
            return;
        }

        // While recording a shortcut on macOS, even application-menu roles
        // such as Quit must not consume the candidate before the renderer.
        if (this.shortcutRecordingSuspended) {
            Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }]));
            return;
        }

        const toggleKb = this.keybinds.get('general:toggle-visibility');
        const toggleAccelerator = this.shortcutRecordingSuspended
            ? undefined
            : toggleKb ? toggleKb.accelerator : 'CommandOrControl+Shift+M';

        const template: any[] = [
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide', accelerator: 'CommandOrControl+Option+H' },
                    { role: 'hideOthers', accelerator: 'CommandOrControl+Option+Shift+H' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            {
                role: 'editMenu'
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: '隐藏 / 恢复窗口',
                        accelerator: toggleAccelerator || undefined,
                        click: () => {
                            // Require AppState dynamically to avoid circular dependencies
                            const { AppState } = require('../main');
                            AppState.getInstance().toggleMainWindow();
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Move Window Up',
                        accelerator: this.getKeybind('window:move-up') || undefined,
                        click: () => this.windowHelper?.moveWindowUp()
                    },
                    {
                        label: 'Move Window Down',
                        accelerator: this.getKeybind('window:move-down') || undefined,
                        click: () => this.windowHelper?.moveWindowDown()
                    },
                    {
                        label: 'Move Window Left',
                        accelerator: this.getKeybind('window:move-left') || undefined,
                        click: () => this.windowHelper?.moveWindowLeft()
                    },
                    {
                        label: 'Move Window Right',
                        accelerator: this.getKeybind('window:move-right') || undefined,
                        click: () => this.windowHelper?.moveWindowRight()
                    },
                    { type: 'separator' },
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            },
            {
                role: 'windowMenu'
            },
            {
                role: 'help',
                submenu: [
                    {
                        label: 'Learn More',
                        click: async () => {
                            const { shell } = require('electron');
                            await shell.openExternal('https://electronjs.org');
                        }
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
        console.log('[KeybindManager] Application menu updated');
    }

    private broadcastUpdate() {
        // Notify main process listeners
        this.onUpdateCallbacks.forEach(cb => cb());

        const windows = BrowserWindow.getAllWindows();
        const allKeybinds = this.getAllKeybinds();
        windows.forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('keybinds:update', allKeybinds);
            }
        });
    }

    public setupIpcHandlers() {
        ipcMain.handle('keybinds:get-all', () => {
            return this.getAllKeybinds();
        });

        ipcMain.handle('keybinds:set', (_, id: string, accelerator: string) => {
            console.log(`[KeybindManager] Set ${id} -> ${accelerator}`);
            return this.setKeybind(id, accelerator);
        });

        ipcMain.handle('keybinds:set-recording-suspended', (_, suspended: boolean) => {
            this.setShortcutRecordingSuspended(Boolean(suspended));
            return true;
        });

        ipcMain.handle('keybinds:reset', () => {
            console.log('[KeybindManager] Reset defaults');
            this.resetKeybinds();
            return this.getAllKeybinds();
        });
    }
}
