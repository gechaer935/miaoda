import { BrowserWindow, screen, app } from "electron"
import { WindowHelper } from "./WindowHelper"
import { loadNativeModule, type NativeShortcutKeyInput } from "./audio/nativeModuleLoader"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${path.join(app.getAppPath(), "dist/index.html")}`

type WindowActivationOptions = {
    activate?: boolean
}

export class SettingsWindowHelper {
    private settingsWindow: BrowserWindow | null = null
    private windowHelper: WindowHelper | null = null;
    private opacityTimeout: NodeJS.Timeout | null = null;
    private visibilityChangeHandler: ((isVisible: boolean) => void) | null = null;
    private shortcutRecordingActive = false;
    private shortcutPollingTimer: NodeJS.Timeout | null = null;
    private lastShortcutSignature = '';

    public getSettingsWindow(): BrowserWindow | null {
        return this.settingsWindow
    }

    public setWindowDimensions(win: BrowserWindow, width: number, height: number): void {
        if (!win || win.isDestroyed() || !win.isVisible()) return

        const currentBounds = win.getBounds()
        // Only update if dimensions actually change (avoid infinite loops)
        if (currentBounds.width === width && currentBounds.height === height) return

        win.setSize(width, height)
    }

    // Store offsets relative to main window
    private offsetX: number = 0
    private offsetY: number = 0

    private lastBlurTime: number = 0
    private ignoreBlur: boolean = false;

    constructor() { }

    public setIgnoreBlur(ignore: boolean): void {
        this.ignoreBlur = ignore;
    }

    /**
     * Pre-create the settings window in the background (hidden) for faster first open
     */
    public preloadWindow(): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            // Create window off-screen so it's ready but not visible
            this.createWindow(-10000, -10000, false);
        }
    }

    public setWindowHelper(wh: WindowHelper): void {
        this.windowHelper = wh;
    }

    public setVisibilityChangeHandler(handler: (isVisible: boolean) => void): void {
        this.visibilityChangeHandler = handler;
    }

    public setShortcutRecordingActive(active: boolean): void {
        this.shortcutRecordingActive = active;
        if (active) this.startNativeShortcutPolling();
        else this.stopNativeShortcutPolling();
    }

    private emitShortcutRecordingInput(input: NativeShortcutKeyInput): void {
        if (!this.shortcutRecordingActive || !this.settingsWindow || this.settingsWindow.isDestroyed()) return;
        const signature = [input.ctrlKey, input.altKey, input.shiftKey, input.metaKey, input.key].join(':');
        if (signature === this.lastShortcutSignature) return;
        this.lastShortcutSignature = signature;
        this.settingsWindow.webContents.send('keybinds:recording-input', input);
    }

    private startNativeShortcutPolling(): void {
        this.stopNativeShortcutPolling();
        if (process.platform !== 'win32') {
            this.lastShortcutSignature = '';
            return;
        }
        const native = loadNativeModule();
        if (typeof native?.getPressedShortcutKey !== 'function') {
            console.warn('[SettingsWindowHelper] Native shortcut polling is unavailable; reserved OS shortcuts may not be visible.');
            return;
        }
        // Preserve the last emitted chord only while it is still physically
        // held. This prevents a failed registration from being submitted in a
        // tight loop when recording is immediately resumed to show the error.
        try {
            if (!native.getPressedShortcutKey()) this.lastShortcutSignature = '';
        } catch (error) {
            console.error('[SettingsWindowHelper] Could not initialize native shortcut polling:', error);
            return;
        }
        this.shortcutPollingTimer = setInterval(() => {
            if (!this.shortcutRecordingActive) return;
            try {
                const input = native.getPressedShortcutKey?.();
                if (!input) {
                    this.lastShortcutSignature = '';
                    return;
                }
                this.emitShortcutRecordingInput(input);
            } catch (error) {
                console.error('[SettingsWindowHelper] Native shortcut polling failed:', error);
                this.stopNativeShortcutPolling();
            }
        }, 16);
        this.shortcutPollingTimer.unref?.();
    }

    private stopNativeShortcutPolling(): void {
        if (this.shortcutPollingTimer) clearInterval(this.shortcutPollingTimer);
        this.shortcutPollingTimer = null;
    }

    public toggleWindow(x?: number, y?: number): void {
        const mainWindow = this.windowHelper?.getMainWindow() ?? null;
        if (mainWindow && !mainWindow.isDestroyed() && x !== undefined && y !== undefined) {
            const bounds = mainWindow.getBounds();
            this.offsetX = x - bounds.x;
            this.offsetY = y - (bounds.y + bounds.height);
        }

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            // Fix: If window was just closed by blur (e.g. clicking the toggle button), don't re-open immediately
            if (!this.settingsWindow.isVisible() && (Date.now() - this.lastBlurTime < 250)) {
                return;
            }

            if (this.settingsWindow.isVisible()) {
                this.closeWindow(); // Use closeWindow to handle focus restore
            } else {
                this.showWindow(x, y)
            }
        } else {
            this.createWindow(x, y)
        }
    }

    public showWindow(x?: number, y?: number, options: WindowActivationOptions = {}): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            this.createWindow(x, y)
            return
        }

        const activate = options.activate ?? true;

        // Set parent to ensure it stays on top of the correct window
        const mainWin = this.windowHelper?.getMainWindow();
        if (mainWin && !mainWin.isDestroyed()) {
            this.settingsWindow.setParentWindow(mainWin);
        }

        if (x !== undefined && y !== undefined) {
            this.settingsWindow.setPosition(Math.round(x), Math.round(y))
        }

        // Ensure fully visible on screen
        this.ensureVisibleOnScreen();

        if (process.platform === 'win32' && this.contentProtection) {
            this.settingsWindow.setOpacity(0);
            if (activate) this.settingsWindow.show(); else this.settingsWindow.showInactive();
            this.settingsWindow.setContentProtection(true);
            this.applyNativeCaptureProtection(true);

            if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
            this.opacityTimeout = setTimeout(() => {
                if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                    this.settingsWindow.setOpacity(1);
                    if (activate) this.settingsWindow.focus();
                }
            }, 60);
        } else {
            this.settingsWindow.setContentProtection(this.contentProtection);
            this.applyNativeCaptureProtection(this.contentProtection);
            if (activate) this.settingsWindow.show(); else this.settingsWindow.showInactive();
            if (activate) this.settingsWindow.focus();
        }

        this.emitVisibilityChange(true);
    }

    public reposition(mainBounds: Electron.Rectangle): void {
        if (!this.settingsWindow || !this.settingsWindow.isVisible() || this.settingsWindow.isDestroyed()) return;

        const newX = mainBounds.x + this.offsetX;
        const newY = mainBounds.y + mainBounds.height + this.offsetY;

        this.settingsWindow.setPosition(Math.round(newX), Math.round(newY));
    }

    public closeWindow(): void {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.hide()
            this.emitVisibilityChange(false);
        }
    }

    private emitVisibilityChange(isVisible: boolean): void {
        this.visibilityChangeHandler?.(isVisible);
        if (!isVisible && this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.webContents.send('keybinds:recording-cancelled');
        }
        const mainWindow = this.windowHelper?.getMainWindow() ?? null;
        if (!mainWindow) {
            console.warn('[SettingsWindowHelper] settings-visibility-changed dropped — no main window bound yet.');
            return;
        }
        if (mainWindow.isDestroyed()) return;
        try {
            mainWindow.webContents.send('settings-visibility-changed', isVisible);
        } catch {
            // Renderer is tearing down; ignore.
        }
    }

    private createWindow(x?: number, y?: number, showWhenReady: boolean = true): void {
        const isMac = process.platform === 'darwin';
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: 420, // Match the shortcut editor in SettingsPopup.tsx
            height: 420, // ResizeObserver in renderer pins the exact content height
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            backgroundColor: "#00000000",
            show: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                preload: path.join(__dirname, "preload.js"),
                devTools: isDev,
                backgroundThrottling: false // Keep window ready even when hidden
            },
            // ROUND 3 FIX: type: 'panel' is what makes this an NSPanel rather
            // than a regular NSWindow. WITHOUT it, the becomesKeyOnlyIfNeeded
            // and _setPreventsActivation: SPI calls in applyStealthToWindow
            // are no-ops (those are NSPanel-only properties — respondsToSelector
            // returns false on a plain NSWindow). The previous fix only added
            // applyStealthToWindow without the underlying panel type, which is
            // why focus theft persisted. NSPanel + type:'panel' = the same
            // Spotlight/Alfred mechanism the overlay uses.
            ...(isMac ? { type: 'panel' as const } : {}),
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        this.settingsWindow = new BrowserWindow(windowSettings)

        if (process.platform === "darwin") {
            this.settingsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
            this.settingsWindow.setHiddenInMissionControl(true)
            this.settingsWindow.setAlwaysOnTop(true, "floating")
        }

        console.log(`[SettingsWindowHelper] Creating Settings Window with Content Protection: ${this.contentProtection}`);
        this.settingsWindow.setContentProtection(this.contentProtection);

        // Load with query param
        const settingsUrl = isDev
            ? `${startUrl}?window=settings`
            : `${startUrl}?window=settings` // file url also works with search params in modern Electron

        this.settingsWindow.loadURL(settingsUrl).catch(e => {
            console.error('[SettingsWindowHelper] Failed to load URL:', e);
        });

        // Capture shortcut candidates before Chromium menus or renderer focus
        // handling can consume them. Global shortcuts are suspended while this
        // flag is active, so the candidate cannot hide the app or start a solve.
        this.settingsWindow.webContents.on('before-input-event', (event, input) => {
            if (!this.shortcutRecordingActive) return;
            if (input.type === 'keyUp') {
                this.lastShortcutSignature = '';
                return;
            }
            if (input.type !== 'keyDown' || input.isAutoRepeat) return;
            const ignored = new Set(['Control', 'Shift', 'Alt', 'Meta']);
            if (ignored.has(input.key)) return;
            event.preventDefault();
            this.emitShortcutRecordingInput({
                key: input.key,
                ctrlKey: input.control,
                altKey: input.alt,
                shiftKey: input.shift,
                metaKey: input.meta,
            });
        });

        this.settingsWindow.once('ready-to-show', () => {
            // Apply NSPanel stealth attributes (becomesKeyOnlyIfNeeded +
            // _setPreventsActivation + sharingType=None + collectionBehavior)
            // BEFORE any show() so clicking the Settings button on the
            // 秒答 overlay doesn't activate the 秒答 app and dim
            // the user's foreground app (Zoom/browser/IDE) mid-meeting.
            // Without this, settings was a regular focusable window and
            // every interaction stole focus. Failure is non-fatal; logged.
            if (process.platform === 'darwin' && this.settingsWindow && !this.settingsWindow.isDestroyed()) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { loadNativeModule } = require('./audio/nativeModuleLoader');
                    const native = loadNativeModule();
                    if (native && typeof native.applyStealthToWindow === 'function') {
                        native.applyStealthToWindow(this.settingsWindow.getNativeWindowHandle());
                    }
                } catch (e) {
                    console.error('[SettingsWindowHelper] applyStealthToWindow failed:', e);
                }
            }
            if (showWhenReady) {
                this.showWindow(this.settingsWindow?.getBounds().x || 0, this.settingsWindow?.getBounds().y || 0)
            }
        })

        // Hide on blur instead of close, to keep state?
        // Or just let user close it.
        // User asked for "independent window", maybe sticky?
        // Let's keep it simple: clicks outside close it if we want "popover" behavior.
        // For now, let it stay open until toggled or ESC.
        this.settingsWindow.on('blur', () => {
            if (this.ignoreBlur) return;
            this.lastBlurTime = Date.now();
            this.closeWindow();
        })

        // ROUND 3 FIX (#1): when Settings becomes visible, stop the
        // CGEventTap. Otherwise the tap intercepts every plain keystroke at
        // OS level and routes them into 秒答's chat input — the user
        // can't type API keys (or anything) into Settings fields. Settings
        // input is a long-form interaction; stealth-typing-into-overlay is
        // not what the user wants here. They can re-engage with the hotkey
        // after Settings closes.
        this.settingsWindow.on('show', () => {
            // ROUND 4 FIX (#7): reset blur timestamp on every successful
            // show. Without this, a stale lastBlurTime from a prior session
            // (or from a brief NSPanel-nonactivating blur that did fire)
            // can keep the 250ms toggle-protection guard hot indefinitely,
            // suppressing legitimate user re-toggles. Resetting at show
            // time bounds the guard to "the LAST blur" rather than "any
            // blur ever observed."
            this.lastBlurTime = 0;

            if (process.platform !== 'darwin') return;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
                StealthKeyboardManager.getInstance().stop();
            } catch (e) {
                console.error('[SettingsWindowHelper] failed to stop stealth tap on show:', e);
            }
        });


    }



    private ensureVisibleOnScreen() {
        if (!this.settingsWindow) return;
        const { x, y, width, height } = this.settingsWindow.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const bounds = display.workArea;

        let newX = x;
        let newY = y;

        if (x + width > bounds.x + bounds.width) {
            newX = bounds.x + bounds.width - width;
        }
        if (y + height > bounds.y + bounds.height) {
            newY = bounds.y + bounds.height - height;
        }

        this.settingsWindow.setPosition(newX, newY);
    }
    private contentProtection: boolean = false; // Track state

    private applyNativeCaptureProtection(enable: boolean): void {
        if (process.platform !== 'win32') return;
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { loadNativeModule } = require('./audio/nativeModuleLoader');
            const native = loadNativeModule();
            const method = enable ? native?.applyStealthToWindow : native?.removeStealthFromWindow;
            if (typeof method === 'function') {
                method(this.settingsWindow.getNativeWindowHandle());
            }
        } catch (e) {
            console.warn(`[SettingsWindowHelper] Failed to ${enable ? 'apply' : 'remove'} native capture protection:`, e);
        }
    }

    public setContentProtection(enable: boolean): void {
        // Dedupe: avoid redundant DWM affinity churn on Windows when the same
        // value is reapplied (settings IPC + show events + global toggles all
        // converge here). The first call still hits both the in-memory state
        // and the native window; later identical calls no-op.
        if (this.contentProtection === enable && this.settingsWindow && !this.settingsWindow.isDestroyed()) return;
        console.log(`[SettingsWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(enable);
            this.applyNativeCaptureProtection(enable);
        }
    }

    // Force-reapply the current content-protection state, bypassing the dedupe
    // guard above. Called after app.dock.hide()/show() flips the macOS
    // activation policy, which can reset the window's sharingType even though
    // our in-memory flag is unchanged.
    public reassertContentProtection(): void {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(this.contentProtection);
        }
    }

    public syncActivationPolicy(): void {
        if (process.platform !== 'win32') return;
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) return;
        this.settingsWindow.setContentProtection(this.contentProtection);
        this.applyNativeCaptureProtection(this.contentProtection);
        if (this.settingsWindow.isVisible()) {
            this.settingsWindow.setOpacity(1);
        }
    }
}
