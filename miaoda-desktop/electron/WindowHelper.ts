import { app, BrowserWindow, Menu, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppState } from './main';
import { KeybindManager } from './services/KeybindManager';

const isEnvDev = process.env.NODE_ENV === 'development';
const isPackaged = app.isPackaged;
const inAppBundle = process.execPath.includes('.app/') || process.execPath.includes('.app\\');

console.log(
  `[WindowHelper] isEnvDev: ${isEnvDev}, isPackaged: ${isPackaged}, inAppBundle: ${inAppBundle}`,
);

// Force production mode if running as packaged app or inside app bundle
const isDev = isEnvDev && !isPackaged;
const overlayResizeTracePath = '/tmp/miaoda-overlay-resize-trace.log';

function traceOverlayResize(event: string, data: Record<string, unknown>): void {
  if (!isDev) return;
  try {
    fs.appendFileSync(
      overlayResizeTracePath,
      `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`,
    );
  } catch {
    // Dev-only diagnostics must never affect overlay behavior.
  }
}

const startUrl = isDev
  ? 'http://localhost:5180'
  : `file://${path.join(__dirname, '../../dist/index.html')}`;

export type AssistantWindowKind = 'interview' | 'written';
export type AssistantWindowInitialAction = 'captureWrittenScreen' | 'captureWrittenLeetCode';

export class WindowHelper {
  private launcherWindow: BrowserWindow | null = null;
  private overlayWindow: BrowserWindow | null = null;
  private assistantWindows = new Map<AssistantWindowKind, BrowserWindow>();
  private activeAssistantKind: AssistantWindowKind | null = null;
  private isWindowVisible: boolean = false;
  // Position/Size tracking for Launcher
  private launcherPosition: { x: number; y: number } | null = null;
  private launcherSize: { width: number; height: number } | null = null;
  private overlayBounds: Electron.Rectangle | null = null;
  private overlayBoundsSaveTimer: NodeJS.Timeout | null = null;
  // Track current window mode (persists even when overlay is hidden via Cmd+B)
  private currentWindowMode: 'launcher' | 'overlay' = 'launcher';

  private appState: AppState;
  private contentProtection: boolean = false;
  private opacityTimeout: NodeJS.Timeout | null = null;
  private lastLauncherShowInactive: boolean | null = null;

  // Hover-gated click-through state. Because the fixed-width (780) overlay
  // window is WIDER than its painted panel when collapsed (600), the ~90px
  // transparent side-margins must pass clicks through to the app behind rather
  // than capturing dead clicks. The renderer hit-tests the pointer against the
  // painted content rect and sets this flag: true = pointer over the painted
  // panel/pill (window must capture), false = pointer over a transparent margin
  // (window must pass through). This ONLY applies in INTERACTIVE mode — when the
  // master stealth passthrough (overlayMousePassthrough) is on, the window is
  // fully click-through regardless of hover. Default true so the window is
  // interactive before the renderer's first hit-test report arrives.
  private overlayHoverInteractive: boolean = true;

  // Constants
  // FIXED OVERLAY WINDOW WIDTH — the OS window is BORN at this width, SHOWN at
  // this width, and NEVER width-resized for the lifetime of the overlay. It
  // MUST equal the renderer's SHELL_WIDTH_EXPANDED (LiteOverlay.tsx).
  //
  // WHY FIXED (the third-and-final fix for the resize jump/flicker): the panel
  // animates 600↔780 purely in CSS, centered (mx-auto) inside this fixed 780
  // window. Because the OS window width never changes, its X origin never moves
  // — and the entire jump/flicker class of bugs was caused by a programmatic
  // width setBounds shifting X mid-animation while the renderer's repaint lagged
  // a frame behind (Chromium does not sync setBounds to renderer paint on
  // macOS). With a fixed width there is no width setBounds at all, so:
  //   • TopPill (centered in the fixed window) is pixel-stable.
  //   • No per-frame transparent-blur-window re-raster → zero flicker.
  // The startup-slide invariant still holds: window-created-width === shown-width
  // (both 780), so the first paint already sits at its final origin. When the
  // shell is collapsed (600 in a 780 window) the ~90px side margins are
  // transparent and made CLICK-THROUGH by the hover-gated interaction policy
  // (see setOverlayHoverInteractive / syncOverlayInteractionPolicy).
  private static readonly OVERLAY_DEFAULT_WIDTH = 460;
  private static readonly OVERLAY_DEFAULT_HEIGHT = 500;
  private static readonly OVERLAY_MIN_HEIGHT = 240;
  private static readonly ASSISTANT_MIN_HEIGHT = 220;
  private static readonly ASSISTANT_WINDOW_MARGIN = 12;
  // Vertical offset for the meeting overlay's initial position, expressed as
  // a fraction of the screen's work-area height. 0.035 places the top edge
  // ~37 px below the work-area top on a 1055-tall display — comfortably
  // below the menu bar with visible breathing room.
  private static readonly OVERLAY_DEFAULT_TOP_RATIO = 0.035;

  // Movement variables (apply to active window)
  private step: number = 20;

  constructor(appState: AppState) {
    this.appState = appState;
  }

  private getOverlayBoundsPath(): string {
    return path.join(app.getPath('userData'), 'lite-overlay-bounds.json');
  }

  private loadPersistedOverlayBounds(): Electron.Rectangle | null {
    try {
      const raw = fs.readFileSync(this.getOverlayBoundsPath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<Electron.Rectangle>;
      if (
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        typeof parsed.width === 'number' &&
        typeof parsed.height === 'number' &&
        parsed.width >= 260 &&
        parsed.width <= 620 &&
        parsed.height >= WindowHelper.OVERLAY_MIN_HEIGHT &&
        parsed.height <= 620
      ) {
        return {
          x: parsed.x,
          y: parsed.y,
          width: parsed.width,
          height: parsed.height,
        };
      }
    } catch {
      // Missing or malformed persistence file: fall back to defaults.
    }
    return null;
  }

  private clampOverlayBounds(bounds: Electron.Rectangle): Electron.Rectangle {
    const workArea = this.getDisplayWorkArea(bounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const width = Math.min(Math.max(bounds.width, 260), maxAllowedWidth);
    const height = Math.min(Math.max(bounds.height, WindowHelper.OVERLAY_MIN_HEIGHT), maxAllowedHeight);
    return {
      x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
      y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
      width,
      height,
    };
  }

  private scheduleOverlayBoundsSave(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
    if (this.overlayBoundsSaveTimer) clearTimeout(this.overlayBoundsSaveTimer);
    this.overlayBoundsSaveTimer = setTimeout(() => {
      if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
      const bounds = this.overlayWindow.getBounds();
      this.overlayBounds = bounds;
      try {
        fs.writeFileSync(this.getOverlayBoundsPath(), JSON.stringify(bounds, null, 2), 'utf8');
      } catch (error) {
        console.warn('[WindowHelper] Failed to save overlay bounds:', error);
      }
    }, 250);
  }

  private getDisplayWorkArea(bounds?: Electron.Rectangle): Electron.Rectangle {
    if (bounds) {
      return screen.getDisplayMatching(bounds).workArea;
    }
    if (this.overlayBounds) {
      return screen.getDisplayMatching(this.overlayBounds).workArea;
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return screen.getDisplayMatching(this.overlayWindow.getBounds()).workArea;
    }
    return screen.getPrimaryDisplay().workArea;
  }

  private getLaunchDisplay(): Electron.Display {
    const primary = screen.getPrimaryDisplay();
    if (!isDev || process.env.MIAODA_DEBUG_DISPLAY !== 'secondary') return primary;
    return screen.getAllDisplays().find((display) => display.id !== primary.id) ?? primary;
  }

  private shouldIgnorePersistedDisplayForDebug(): boolean {
    return isDev && process.env.MIAODA_DEBUG_DISPLAY === 'secondary';
  }

  private restoreIfMinimized(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) {
      win.restore();
    }
  }

  private isWindowActuallyVisible(win: BrowserWindow | null): boolean {
    return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  }

  public setContentProtection(enable: boolean): void {
    // Dedupe: setContentProtection is called from multiple paths (settings IPC,
    // every switchToOverlay/switchToLauncher show, the Windows mute-on-Win+Tab
    // workaround). Repeated identical calls trigger DWM affinity churn on
    // Windows that can leave the HWND in a transient black/blank frame state
    // for a few hundred ms. No-op when nothing actually changes.
    if (this.contentProtection === enable) return;
    this.contentProtection = enable;
    this.applyContentProtection(enable);
  }

  private applyContentProtection(enable: boolean): void {
    const windows = [this.launcherWindow, this.overlayWindow, ...this.assistantWindows.values()];
    windows.forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.setContentProtection(enable);
        this.applyNativeCaptureProtection(win, enable, 'main-window');
        // Capture visibility and taskbar visibility are independent. Native
        // WDA changes must never promote an assistant/tool window back into an
        // Explorer AppWindow when privacy mode is turned off.
        win.setSkipTaskbar(true);
      }
    });
  }

  private applyNativeCaptureProtection(win: BrowserWindow | null, enable: boolean, label: string): void {
    if (!win || win.isDestroyed() || process.platform !== 'win32') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { loadNativeModule } = require('./audio/nativeModuleLoader');
      const native = loadNativeModule();
      const method = enable ? native?.applyStealthToWindow : native?.removeStealthFromWindow;
      if (typeof method === 'function') {
        method(win.getNativeWindowHandle());
      } else if (!enable) {
        console.warn(`[WindowHelper] removeStealthFromWindow unavailable for ${label}; rebuild native module to fully disable Windows capture affinity`);
      }
    } catch (e) {
      console.warn(`[WindowHelper] Failed to ${enable ? 'apply' : 'remove'} native capture protection for ${label}:`, e);
    }
  }

  private applyNativeStealthAttributes(win: BrowserWindow | null, label: string): void {
    if (!win || win.isDestroyed()) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { loadNativeModule } = require('./audio/nativeModuleLoader');
      const native = loadNativeModule();
      if (native && typeof native.applyStealthToWindow === 'function') {
        native.applyStealthToWindow(win.getNativeWindowHandle());
        console.log(`[WindowHelper] Applied native stealth attributes to ${label}`);
      }
    } catch (e) {
      console.warn(`[WindowHelper] Native stealth attributes failed for ${label}:`, e);
    }
  }

  private reassertTopmost(win: BrowserWindow | null, label: string): void {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (process.platform !== 'win32') return;
    try {
      win.setSkipTaskbar(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      if (this.contentProtection) {
        this.applyNativeStealthAttributes(win, label);
      }
    } catch (error) {
      console.warn(`[WindowHelper] Failed to reassert topmost for ${label}:`, error);
    }
  }

  private reassertAssistantStealth(win: BrowserWindow, kind: AssistantWindowKind): void {
    if (win.isDestroyed()) return;
    try {
      // An owned Win32 tool window cannot receive its own taskbar button. This
      // is more reliable than skipTaskbar alone: Explorer may cache a button
      // created during the first show/focus transition even after Electron has
      // restored WS_EX_TOOLWINDOW.
      if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
        win.setParentWindow(this.launcherWindow);
      }
      win.setSkipTaskbar(true);
      if (process.platform === 'win32') {
        win.setAlwaysOnTop(true, 'screen-saver');
        // applyStealthToWindow also sets WDA_EXCLUDEFROMCAPTURE. Reapplying it
        // while privacy mode is off made the UI toggle lie: Electron had
        // disabled content protection, then the next show/focus immediately
        // enabled the native capture exclusion again.
        if (this.contentProtection) {
          this.applyNativeStealthAttributes(win, `${kind}-assistant`);
        }
      }
    } catch (error) {
      console.warn(`[WindowHelper] Failed to reassert ${kind} assistant stealth:`, error);
    }
  }

  public pinCurrentWindowTopmost(): void {
    if (this.currentWindowMode === 'overlay') {
      this.reassertTopmost(this.overlayWindow, 'overlay');
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.showInactive();
      }
      return;
    }
    this.reassertTopmost(this.launcherWindow, 'launcher');
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.launcherWindow.showInactive();
    }
  }

  // Force-reapply the CURRENT content-protection state to every live window,
  // bypassing the dedupe guard in setContentProtection(). Needed because
  // app.dock.hide()/show() flips the macOS activation policy, which makes
  // WindowServer re-evaluate each NSWindow and can silently reset its
  // sharingType (the NSWindowSharingNone flag setContentProtection set). The
  // in-memory `this.contentProtection` is still correct, so the normal setter
  // would no-op — we must push the value to the OS again unconditionally.
  public reassertContentProtection(): void {
    this.applyContentProtection(this.contentProtection);
  }

  public setWindowDimensions(width: number, height: number): void {
    const activeWindow = this.getMainWindow(); // Gets currently focused/relevant window
    if (!activeWindow || activeWindow.isDestroyed()) return;

    const [currentX, currentY] = activeWindow.getPosition();
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const newWidth = Math.min(width, maxAllowedWidth);
    const newHeight = Math.ceil(height);
    const maxX = workArea.width - newWidth;
    const newX = Math.min(Math.max(currentX, 0), maxX);

    activeWindow.setBounds({
      x: newX,
      y: currentY,
      width: newWidth,
      height: newHeight,
    });

    // Update internal tracking if it's launcher
    if (activeWindow === this.launcherWindow) {
      this.launcherSize = { width: newWidth, height: newHeight };
      this.launcherPosition = { x: newX, y: currentY };
    }
  }

  // Dedicated method for overlay window resizing - decoupled from launcher
  public setOverlayDimensions(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const currentX = currentBounds.x;
    const currentY = currentBounds.y;
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth); // min 300, max 90%
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight); // min 1, max 90%
    const maxX = workArea.x + workArea.width - newWidth;
    const maxY = workArea.y + workArea.height - newHeight;
    const newX = Math.min(Math.max(currentX, workArea.x), maxX);
    const newY = Math.min(Math.max(currentY, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      return;
    }

    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
  }

  // Variant of setOverlayDimensions that keeps the horizontal CENTER of the
  // window fixed across width changes. Used by code-expansion animations so
  // the shell (mx-auto centered) doesn't appear to jump sideways when the
  // window grows: window grows symmetrically (X shifts -widthDelta/2), and
  // mx-auto compensates by reducing margin equally — net visual movement = 0.
  public setOverlayDimensionsCentered(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    const currentBounds = this.overlayWindow.getBounds();
    const currentContentSize = this.overlayWindow.getContentSize();
    const workArea = this.getDisplayWorkArea(currentBounds);
    const maxAllowedWidth = Math.floor(workArea.width * 0.9);
    const maxAllowedHeight = Math.floor(workArea.height * 0.9);
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth);
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight);
    traceOverlayResize('setOverlayDimensionsCentered:request', {
      requested: { width, height },
      currentBounds,
      currentContentSize,
      workArea,
      maxAllowed: { width: maxAllowedWidth, height: maxAllowedHeight },
      computed: { width: newWidth, height: newHeight },
      clampedHeight: newHeight !== height,
    });

    // Compute X so the content's horizontal center stays put across the resize.
    const widthDelta = newWidth - currentContentSize[0];
    const desiredX = currentBounds.x - Math.floor(widthDelta / 2);

    const maxX = workArea.x + workArea.width - newWidth;
    const newX = Math.min(Math.max(desiredX, workArea.x), maxX);
    const maxY = workArea.y + workArea.height - newHeight;
    const newY = Math.min(Math.max(currentBounds.y, workArea.y), maxY);

    if (
      Math.abs(newWidth - currentContentSize[0]) <= 1 &&
      Math.abs(newHeight - currentContentSize[1]) <= 1 &&
      newX === currentBounds.x &&
      newY === currentBounds.y
    ) {
      traceOverlayResize('setOverlayDimensionsCentered:noop', {
        requested: { width, height },
        currentBounds,
        currentContentSize,
        computed: { x: newX, y: newY, width: newWidth, height: newHeight },
      });
      return;
    }

    // Atomic frame change: a single setBounds avoids the 1-frame split where
    // the OS window has the new size but the old origin (or vice versa), which
    // is what causes the shell to visibly slide and snap during code-expansion.
    this.overlayWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    this.overlayBounds = this.overlayWindow.getBounds();
    traceOverlayResize('setOverlayDimensionsCentered:applied', {
      requested: { width, height },
      appliedBounds: this.overlayBounds,
      contentSizeAfter: this.overlayWindow.getContentSize(),
    });
  }

  // NOTE: the overlay window uses a compact default width and can be resized for
  // its entire visible lifetime. The expand/contract animation is CSS-only in
  // the renderer (the panel tweens 600↔780 centered inside the fixed window).
  // The renderer therefore only ever reports `width: 780` to
  // setOverlayDimensionsCentered, so the width delta is always 0, X never moves,
  // and only HEIGHT ever changes (content/streaming growth). A height-only
  // setBounds is top-anchored and does not move X, so it cannot cause the
  // sideways jump. See LiteOverlay.startTransition (CSS-only) for the
  // renderer side of this contract.

  public createWindow(): void {
    if (this.launcherWindow !== null) return; // Already created

    const primaryDisplay = this.getLaunchDisplay();
    const workArea = primaryDisplay.workArea;

    // Lite card window dimensions.
    const width = 820;
    const height = 640;

    // Calculate centered X, and top-centered Y (5% from top)
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    // Ensure y is at least workArea.y (don't go offscreen top)
    const topMargin = Math.round(workArea.height * 0.05);
    const y = Math.round(workArea.y + topMargin);

    // --- 1. Create Launcher Window ---
    const isMac = process.platform === 'darwin';

    const launcherSettings: Electron.BrowserWindowConstructorOptions = {
      width: width,
      height: height,
      x: x,
      y: y,
      minWidth: 560,
      minHeight: 420,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
        webSecurity: !isDev, // DEBUG: Disable web security only in dev
		devTools: isDev,
      },
      show: false, // DEBUG: Force show -> Fixed white screen, now relies on ready-to-show
      // Platform-specific frame settings
      ...(isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : { frame: false, titleBarOverlay: false, autoHideMenuBar: true }),
      ...(isMac
        ? { vibrancy: 'under-window' as const, visualEffectState: 'followWindow' as const }
        : {}),
      transparent: true,
      hasShadow: true,
      // The launcher starts with the black logo splash. Use a black native
      // background too so macOS doesn't show a grey/white transparent-window
      // flash before the renderer paints.
      backgroundColor: '#00000000',
      focusable: true,
      resizable: true,
      movable: true,
      center: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      icon: (() => {
        const isMac = process.platform === 'darwin';
        const isWin = process.platform === 'win32';
        const mode = this.appState.getDisguise();

        if (mode === 'none') {
          if (isMac) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'miaoda.icns')
              : path.resolve(__dirname, '../../assets/miaoda.icns');
          } else if (isWin) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'assets/icons/win/icon1.ico')
              : path.resolve(__dirname, '../../assets/icons/win/icon1.ico');
          } else {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'icon.png')
              : path.resolve(__dirname, '../../assets/icon.png');
          }
        }

        // Disguise mode icons. Only the three known disguise modes map to a
        // fake icon; any unexpected value falls through to 'none' above, so we
        // never silently paint a terminal icon for an unrecognized mode.
        let iconName: string | null = null;
        if (mode === 'terminal') iconName = 'terminal.png';
        if (mode === 'settings') iconName = 'settings.png';
        if (mode === 'activity') iconName = 'activity.png';
        if (!iconName) {
          // Defensive: unknown mode — use the real app icon, matching 'none'.
          if (isMac) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'miaoda.icns')
              : path.resolve(__dirname, '../../assets/miaoda.icns');
          } else if (isWin) {
            return app.isPackaged
              ? path.join(process.resourcesPath, 'assets/icons/win/icon1.ico')
              : path.resolve(__dirname, '../../assets/icons/win/icon1.ico');
          }
          return app.isPackaged
            ? path.join(process.resourcesPath, 'icon.png')
            : path.resolve(__dirname, '../../assets/icon.png');
        }

        const platformDir = isWin ? 'win' : 'mac';
        return app.isPackaged
          ? path.join(process.resourcesPath, `assets/fakeicon/${platformDir}/${iconName}`)
          : path.resolve(__dirname, `../../assets/fakeicon/${platformDir}/${iconName}`);
      })(),
    };

    console.log(`[WindowHelper] Icon Path: ${launcherSettings.icon}`);
    console.log(`[WindowHelper] Start URL: ${startUrl}`);

    try {
      this.launcherWindow = new BrowserWindow(launcherSettings);
      console.log('[WindowHelper] BrowserWindow created successfully');
    } catch (err) {
      console.error('[WindowHelper] Failed to create BrowserWindow:', err);
      return;
    }

    this.launcherWindow.setContentProtection(this.contentProtection);
    this.launcherWindow.setSkipTaskbar(true);
    if (process.platform === 'win32') {
      this.launcherWindow.setAlwaysOnTop(true, 'screen-saver');
      this.applyNativeStealthAttributes(this.launcherWindow, 'launcher');
      this.launcherWindow.once('ready-to-show', () => {
        this.applyNativeStealthAttributes(this.launcherWindow, 'launcher');
        this.reassertTopmost(this.launcherWindow, 'launcher');
      });
    }

    this.launcherWindow
      .loadURL(`${startUrl}?window=launcher`)
      .then(() => console.log('[WindowHelper] loadURL success'))
      .catch((e) => {
        console.error('[WindowHelper] Failed to load URL:', e);
      });

    this.launcherWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`[WindowHelper] did-fail-load: ${errorCode} ${errorDescription}`);
    });

    // if (isDev) {
    //   this.launcherWindow.webContents.openDevTools({ mode: 'detach' }); // DEBUG: Open DevTools
    // }

    // --- 2. Create Overlay Window (Hidden initially) ---
    // Always start centered on the primary display so the OS (macOS NSUserDefaults /
    // Windows DWM) cannot restore the previous session's cached window position.
    // The in-memory `overlayBounds` is already null here, so `switchToOverlay()`
    // will also fall back to centered logic — but providing explicit x/y in the
    // constructor is the only reliable guard against OS-level position persistence.
    const persistedOverlayBounds = this.shouldIgnorePersistedDisplayForDebug()
      ? null
      : this.loadPersistedOverlayBounds();
    const overlayDefaultX = Math.floor(
      workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2,
    );
    const overlayDefaultY = Math.floor(
      workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO,
    );

    const overlaySettings: Electron.BrowserWindowConstructorOptions = {
      width: persistedOverlayBounds?.width ?? WindowHelper.OVERLAY_DEFAULT_WIDTH,
      height: persistedOverlayBounds?.height ?? WindowHelper.OVERLAY_DEFAULT_HEIGHT,
      x: persistedOverlayBounds?.x ?? overlayDefaultX,
      y: persistedOverlayBounds?.y ?? overlayDefaultY,
      minWidth: 260,
      minHeight: WindowHelper.OVERLAY_MIN_HEIGHT,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
		devTools: isDev,
      },
      show: false,
      frame: false, // Frameless
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: true,
      resizable: true,
      movable: true,
      skipTaskbar: true, // Don't show separately in dock/taskbar
      hasShadow: false, // Prevent shadow from adding perceived size/artifacts
      // macOS NSPanel + nonactivating: lets the overlay become the key window
      // (and receive keystrokes for the chat input) without activating 秒答
      // in the dock / menu bar / screen-share, so the user's foreground app
      // stays "in front." Required for the chat:focusInput stealth-typing path.
      // Windows/Linux fall back to a regular focusable window.
      ...(isMac ? { type: 'panel' as const } : {}),
    };

    this.overlayWindow = new BrowserWindow(overlaySettings);
    this.overlayBounds = persistedOverlayBounds ? this.clampOverlayBounds(persistedOverlayBounds) : null;
    if (this.overlayBounds) {
      this.overlayWindow.setBounds(this.overlayBounds);
    }
    this.overlayWindow.setContentProtection(this.contentProtection);
    if (process.platform === 'win32') {
      this.applyNativeStealthAttributes(this.overlayWindow, 'overlay');
      this.overlayWindow.once('ready-to-show', () => {
        this.applyNativeStealthAttributes(this.overlayWindow, 'overlay');
      });
    }

    // Register the overlay as the sole recipient of CGEventTap captured-key
    // broadcasts. Without this, captured keystrokes fan out to ALL windows
    // (settings, cropper, etc.) — silent privacy/security exposure.
    if (process.platform === 'darwin') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
        StealthKeyboardManager.getInstance().setOverlayWindow(this.overlayWindow);
      } catch (e) {
        console.error('[WindowHelper] failed to register overlay with StealthKeyboardManager:', e);
      }
    }

    if (process.platform === 'darwin') {
      this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlayWindow.setHiddenInMissionControl(true);
      this.overlayWindow.setAlwaysOnTop(true, 'floating');

      // Apply Spotlight/Alfred-grade stealth attributes that Electron does not
      // expose: becomesKeyOnlyIfNeeded (clicks on buttons / surfaces don't
      // promote the panel to key window → user's foreground app keeps key
      // state in the dock, menu bar, screen-share, focus-followers),
      // hidesOnDeactivate=NO, and the right collectionBehavior. Without this,
      // ANY click on the overlay (button, input, anywhere) activates 秒答
      // and dims the user's foreground app — even with type:'panel' set.
      //
      // DEFERRED to `ready-to-show`: getNativeWindowHandle() returns the
      // NSView pointer immediately after `new BrowserWindow`, but the view's
      // [NSView window] may briefly be nil before Electron finishes attaching
      // the view to its NSWindow. Calling now races and the Rust side returns
      // "NSView has no associated NSWindow" → silent fallback to plain panel.
      // ready-to-show fires AFTER the NSWindow is attached and the renderer
      // has performed its first paint, so the window is guaranteed live.
      //
      // Optional: requires the rebuilt native module (npm run build:native).
      // If the binary predates this method we silently skip; clicks will still
      // soft-activate the panel as before but type:'panel' alone keeps the
      // dock icon out of the way. Existing users see no regression.
      this.overlayWindow.once('ready-to-show', () => {
        if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { loadNativeModule } = require('./audio/nativeModuleLoader');
          const native = loadNativeModule();
          if (native && typeof native.applyStealthToWindow === 'function') {
            native.applyStealthToWindow(this.overlayWindow.getNativeWindowHandle());
            console.log('[WindowHelper] Applied stealth NSPanel attributes to overlay');
          } else {
            console.warn(
              '[WindowHelper] applyStealthToWindow unavailable — rebuild native module (npm run build:native) for full stealth',
            );
          }
        } catch (e) {
          console.error('[WindowHelper] Failed to apply stealth attributes:', e);
        }
      });
    } else if (process.platform === 'win32') {
      // 'floating' level (HWND_TOPMOST baseline) is not enough to render above
      // fullscreen browser windows (F11). 'screen-saver' uses a higher TOPMOST
      // priority that wins against window-mode fullscreen apps. macOS uses
      // visibleOnFullScreen above; Windows has no equivalent flag, so the level
      // itself is what controls fullscreen visibility. See issue #167.
      this.reassertTopmost(this.overlayWindow, 'overlay');
    }

    this.overlayWindow.loadURL(`${startUrl}?window=overlay`).catch((e) => {
      console.error('[WindowHelper] Failed to load Overlay URL:', e);
    });

    // --- 3. Startup Sequence ---
    this.launcherWindow.once('ready-to-show', () => {
      this.switchToLauncher();
      this.isWindowVisible = true;
      this.reassertTopmost(this.launcherWindow, 'launcher');
    });

    this.setupWindowListeners();
  }

  public openAssistantWindow(kind: AssistantWindowKind, initialAction?: AssistantWindowInitialAction): void {
    // Switching away from the interview assistant must also stop its audio
    // session. Merely hiding the interview BrowserWindow leaves the ASR
    // WebSocket alive, so the server continues charging interview seconds in
    // the background while the written assistant is visible.
    if (
      kind === 'written'
      && this.activeAssistantKind === 'interview'
      && this.appState.getIsMeetingActive()
    ) {
      void this.appState.endMeeting().catch((error) => {
        console.warn('[WindowHelper] Failed to stop interview while switching assistants:', error);
      });
    }

    // Assistant windows replace the home workspace while they are active.
    // Keeping the launcher visible behind them made the UI look like two
    // embedded pages and obscured the user's interview/test screen.
    this.launcherWindow?.hide();
    this.overlayWindow?.hide();
    this.activeAssistantKind = kind;
    this.assistantWindows.forEach((win, windowKind) => {
      if (windowKind !== kind && !win.isDestroyed()) win.hide();
    });

    const existing = this.assistantWindows.get(kind);
    if (existing && !existing.isDestroyed()) {
      this.reassertAssistantStealth(existing, kind);
      existing.setOpacity(1);
      if (this.appState.getUndetectable()) existing.showInactive();
      else existing.show();
      existing.focus();
      this.reassertAssistantStealth(existing, kind);
      if (initialAction) existing.webContents.send('global-shortcut', { action: initialAction });
      this.isWindowVisible = true;
      return;
    }

    const workArea = this.getLaunchDisplay().workArea;
    const defaultWidth = kind === 'interview' ? 400 : 388;
    const defaultHeight = kind === 'interview' ? 410 : 350;
    const width = Math.min(defaultWidth, workArea.width);
    const height = Math.max(
      WindowHelper.ASSISTANT_MIN_HEIGHT,
      Math.min(defaultHeight, workArea.height - WindowHelper.ASSISTANT_WINDOW_MARGIN * 2),
    );
    const minimumWidth = kind === 'written' ? 340 : 400;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = workArea.y;
    const isMac = process.platform === 'darwin';
    const icon = process.platform === 'win32'
      ? (app.isPackaged
        ? path.join(process.resourcesPath, 'assets/icons/win/icon1.ico')
        : path.resolve(__dirname, '../../assets/icons/win/icon1.ico'))
      : undefined;

    const win = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: minimumWidth,
      minHeight: WindowHelper.ASSISTANT_MIN_HEIGHT,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
        scrollBounce: true,
        webSecurity: !isDev,
		devTools: isDev,
      },
      ...(isMac
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : { frame: false, titleBarOverlay: false, autoHideMenuBar: true }),
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      focusable: true,
      resizable: true,
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      parent: this.launcherWindow ?? undefined,
      icon,
    });

    this.assistantWindows.set(kind, win);
    win.setContentProtection(this.contentProtection);
    win.setIgnoreMouseEvents(this.appState.getOverlayMousePassthrough(), { forward: true });
    this.reassertAssistantStealth(win, kind);

    const normalizeInitialAssistantHeight = (): void => {
      if (win.isDestroyed() || kind !== 'interview') return;
      const targetHeight = Math.min(defaultHeight, workArea.height - WindowHelper.ASSISTANT_WINDOW_MARGIN * 2);
      const currentHeight = win.getBounds().height;
      if (currentHeight === targetHeight) return;
      // The renderer may already have restored the persisted “two answers”
      // height. Only correct the one-DIP native creation inset here; never
      // overwrite an intentional renderer resize.
      if (Math.abs(currentHeight - targetHeight) > 2) return;
      // On Windows, a frameless owned tool window retains a one-DIP native
      // inset after it is shown. Setting the content request one DIP lower
      // produces an observable BrowserWindow/content height of exactly 410.
      const requestedContentHeight = process.platform === 'win32' ? targetHeight - 1 : targetHeight;
      win.setContentSize(win.getContentSize()[0], requestedContentHeight, false);
    };

    win.on('show', () => {
      setImmediate(() => this.reassertAssistantStealth(win, kind));
    });

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      this.reassertAssistantStealth(win, kind);
      if (process.platform === 'win32' && this.contentProtection) {
        win.setOpacity(0);
        win.show();
        win.setContentProtection(true);
        this.applyNativeCaptureProtection(win, true, `${kind}-assistant`);
        setTimeout(() => {
          if (win.isDestroyed()) return;
          win.setOpacity(1);
          win.focus();
          this.reassertAssistantStealth(win, kind);
          normalizeInitialAssistantHeight();
        }, 60);
      } else {
        win.show();
        win.focus();
        this.reassertAssistantStealth(win, kind);
        normalizeInitialAssistantHeight();
      }
      this.isWindowVisible = true;
    });

    win.on('closed', () => {
      if (this.assistantWindows.get(kind) === win) this.assistantWindows.delete(kind);
      if (this.activeAssistantKind === kind) this.activeAssistantKind = null;
      if (kind === 'interview' && this.appState.getIsMeetingActive()) {
        void this.appState.endMeeting().catch((error) => {
          console.warn('[WindowHelper] Failed to stop interview while closing assistant window:', error);
        });
      }
      const launcher = this.launcherWindow;
      if (launcher && !launcher.isDestroyed()) {
        launcher.setOpacity(1);
        if (this.appState.getUndetectable()) launcher.showInactive();
        else {
          launcher.show();
          launcher.focus();
        }
        this.isWindowVisible = true;
      }
    });

    const initialActionQuery = initialAction ? `&initialAction=${initialAction}` : '';
    win.loadURL(`${startUrl}?window=assistant-${kind}${initialActionQuery}`).catch((error) => {
      console.error(`[WindowHelper] Failed to load ${kind} assistant window:`, error);
      if (!win.isDestroyed()) win.close();
    });
  }

  public closeAssistantWindow(senderWebContentsId: number): AssistantWindowKind | null {
    for (const [kind, win] of this.assistantWindows.entries()) {
      if (!win.isDestroyed() && win.webContents.id === senderWebContentsId) {
        win.close();
        return kind;
      }
    }
    return null;
  }

  public hideAssistantWindow(senderWebContentsId: number): AssistantWindowKind | null {
    for (const [kind, win] of this.assistantWindows.entries()) {
      if (!win.isDestroyed() && win.webContents.id === senderWebContentsId) {
        win.hide();
        this.activeAssistantKind = kind;
        this.isWindowVisible = false;
        return kind;
      }
    }
    return null;
  }

  public resizeAssistantWindow(senderWebContentsId: number, requestedHeight: number): number | null {
    if (!Number.isFinite(requestedHeight)) return null;

    for (const win of this.assistantWindows.values()) {
      if (win.isDestroyed() || win.webContents.id !== senderWebContentsId) continue;

      const bounds = win.getBounds();
      const workArea = screen.getDisplayMatching(bounds).workArea;
      const margin = WindowHelper.ASSISTANT_WINDOW_MARGIN;
      const minimumHeight = Math.min(
        WindowHelper.ASSISTANT_MIN_HEIGHT,
        Math.max(120, workArea.height - margin * 2),
      );
      const maximumHeight = Math.max(minimumHeight, workArea.height - margin * 2);
      const height = Math.max(minimumHeight, Math.min(maximumHeight, Math.round(requestedHeight)));
      const minimumY = workArea.y + margin;
      const maximumY = workArea.y + workArea.height - height - margin;
      const y = Math.max(minimumY, Math.min(bounds.y, maximumY));

      if (bounds.height !== height || bounds.y !== y) {
        win.setBounds({ x: bounds.x, y, width: bounds.width, height }, false);
      }
      return height;
    }

    return null;
  }

  public getAssistantWindows(): BrowserWindow[] {
    return Array.from(this.assistantWindows.values()).filter((win) => !win.isDestroyed());
  }

  public getActiveAssistantKind(): AssistantWindowKind | null {
    const kind = this.activeAssistantKind;
    if (!kind) return null;
    const win = this.assistantWindows.get(kind);
    return win && !win.isDestroyed() ? kind : null;
  }

  public getActiveAssistantWindow(): BrowserWindow | null {
    const kind = this.getActiveAssistantKind();
    return kind ? this.assistantWindows.get(kind) ?? null : null;
  }

  private setupWindowListeners(): void {
    if (!this.launcherWindow) return;

    // Suppress Windows system context menu on right-click (title bar)
    this.launcherWindow.on('system-context-menu', (e, point) => {
      e.preventDefault();
      if (!this.appState.getUndetectable()) {
        this.showContextMenu(this.launcherWindow!, point);
      }
    });

    this.launcherWindow.on('move', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherPosition = { x: bounds.x, y: bounds.y };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    this.launcherWindow.on('resize', () => {
      if (this.launcherWindow) {
        const bounds = this.launcherWindow.getBounds();
        this.launcherSize = { width: bounds.width, height: bounds.height };
        this.appState.settingsWindowHelper.reposition(bounds);
      }
    });

    if (process.platform === 'win32') {
      this.launcherWindow.on('show', () => {
        this.reassertTopmost(this.launcherWindow, 'launcher');
      });

      this.launcherWindow.on('blur', () => {
        this.reassertTopmost(this.launcherWindow, 'launcher');
      });
    }

    // On Windows/Linux: intercept close and hide to tray instead of quitting,
    // unless the app is actually quitting (e.g. from tray "Quit" menu).
    if (process.platform !== 'darwin') {
      this.launcherWindow.on('minimize' as any, (e: Electron.Event) => {
        e.preventDefault();
        this.hideMainWindow();
      });

      this.launcherWindow.on('close', (e) => {
        if (!this.appState.isQuitting()) {
          e.preventDefault();
          this.launcherWindow?.hide();
          this.isWindowVisible = false;
        }
      });

      // Sync maximize state to renderer so WindowControls stays in sync (Windows/Linux only)
      this.launcherWindow.on('maximize', () => {
        this.launcherWindow?.webContents.send('window-maximized-changed', true);
      });
      this.launcherWindow.on('unmaximize', () => {
        this.launcherWindow?.webContents.send('window-maximized-changed', false);
      });
    }

    this.launcherWindow.on('closed', () => {
      this.launcherWindow = null;
      // If launcher closes, we should probably quit app or close overlay
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close();
      }
      this.overlayWindow = null;
      this.isWindowVisible = false;
    });

    // Listen for overlay close (e.g. Cmd+W). Never truly destroy it — either
    // hide it (during a meeting) or switch back to launcher (between meetings).
    if (this.overlayWindow) {
      this.overlayWindow.on('move', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
          this.scheduleOverlayBoundsSave();
        }
      });

      this.overlayWindow.on('resize', () => {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayBounds = this.overlayWindow.getBounds();
          this.scheduleOverlayBoundsSave();
        }
      });

      this.overlayWindow.on('system-context-menu', (e, point) => {
        e.preventDefault();
        if (!this.appState.getUndetectable()) {
          this.showContextMenu(this.overlayWindow!, point);
        }
      });

      // Re-assert always-on-top on blur (Windows only). Screen-sharing tools
      // (Zoom, Lark, Teams, etc.) hook the DWM compositor and can demote even
      // HWND_TOPMOST windows below their shared content layer. Re-applying the
      // 'screen-saver' level on every blur keeps the overlay above the share
      // surface. Skipped on macOS — re-asserting setAlwaysOnTop there triggers
      // [NSApp activate], which steals focus from the underlying app. See #130.
      if (process.platform === 'win32') {
        this.overlayWindow.on('blur', () => {
          if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
          if (!this.overlayWindow.isVisible()) return;
          this.reassertTopmost(this.overlayWindow, 'overlay');
        });

        this.overlayWindow.on('show', () => {
          this.reassertTopmost(this.overlayWindow, 'overlay');
        });
      }

      this.overlayWindow.on('close', (e) => {
        if (!this.appState.isQuitting() && this.overlayWindow?.isVisible()) {
          e.preventDefault();
          if (this.appState.getIsMeetingActive()) {
            // Meeting running — just hide the overlay; user can resume from the
            // launcher's "Meeting ongoing" button which calls setWindowMode('overlay').
            this.hideOverlay();
          } else {
            this.switchToLauncher();
          }
        }
      });

      if (process.platform !== 'darwin') {
        this.overlayWindow.on('minimize' as any, (e: Electron.Event) => {
          e.preventDefault();
          this.hideOverlay();
        });
      }
    }
  }

  // Helper to get whichever window should be treated as "Main" for IPC
  public getMainWindow(): BrowserWindow | null {
    if (this.currentWindowMode === 'overlay' && this.overlayWindow) {
      return this.overlayWindow;
    }
    return this.launcherWindow;
  }

  // Specific getters if needed
  public getLauncherWindow(): BrowserWindow | null {
    return this.launcherWindow;
  }
  public getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow;
  }
  public getCurrentWindowMode(): 'launcher' | 'overlay' {
    return this.currentWindowMode;
  }

  // Clears the remembered overlay position so the next switchToOverlay() call
  // opens at the default centered position (called on new meeting start).
  public resetOverlayPosition(): void {
    this.overlayBounds = this.loadPersistedOverlayBounds();
    console.log('[WindowHelper] Overlay bounds restored from saved lite overlay size.');
  }

  public getLastOverlayBounds(): Electron.Rectangle | null {
    // If no in-memory bounds exist, return null to signify no user-initiated movement.
    if (this.overlayBounds) return { ...this.overlayBounds };
    return null;
  }

  public getLastOverlayDisplayId(): number | null {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return null;
    const bounds = this.overlayWindow.getBounds();
    return screen.getDisplayMatching(bounds).id;
  }

  public isVisible(): boolean {
    return this.isWindowVisible;
  }

  public isMainWindowMaximized(): boolean {
    const win = this.launcherWindow;
    return !!win && !win.isDestroyed() && win.isMaximized();
  }

  public hideMainWindow(): void {
    // Do NOT call setOpacity(0) before hide() on macOS — it causes WindowServer to
    // re-register the app as a regular window, breaking undetectable/stealth mode
    // (fixed in v2.0.8, regressed when opacity was re-added for screenshot flash).
    // Screenshot capture already waits 80ms after hide() for compositor flush.
    if (process.platform === 'win32') {
      this.launcherWindow?.setOpacity(0);
      this.overlayWindow?.setOpacity(0);
    }
    this.launcherWindow?.hide();
    this.overlayWindow?.hide();
    this.getAssistantWindows().forEach((win) => {
      if (process.platform === 'win32') win.setOpacity(0);
      win.hide();
    });
    this.lastLauncherShowInactive = null;
    this.isWindowVisible = false;
  }

  // Renderer-driven hit-test result: is the pointer currently over the painted
  // panel/pill (true) or over a transparent margin / outside (false)? The
  // renderer debounces this to state changes only, so this is low-frequency.
  // Re-applies the combined interaction policy, but only matters in interactive
  // mode — stealth passthrough always wins (handled in sync below).
  public setOverlayHoverInteractive(interactive: boolean): void {
    if (this.overlayHoverInteractive === interactive) return;
    this.overlayHoverInteractive = interactive;
    this.syncOverlayInteractionPolicy();
  }

  // Apply the combined click-through (mouse passthrough) policy on the overlay
  // window. There are TWO inputs:
  //   1. overlayMousePassthrough (master stealth toggle): when ON the window is
  //      ALWAYS fully click-through regardless of hover (user is in another app).
  //   2. overlayHoverInteractive (renderer hit-test): in interactive mode, the
  //      window captures clicks only when the pointer is over the painted panel;
  //      over the transparent side-margins it passes clicks through so they hit
  //      the app behind instead of being swallowed as dead clicks.
  // Called whenever EITHER input changes.
  public syncOverlayInteractionPolicy(): void {
    const passthrough = this.appState.getOverlayMousePassthrough();

    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.launcherWindow.setIgnoreMouseEvents(passthrough, { forward: true });
      if (!passthrough) this.launcherWindow.setFocusable(true);
      console.log(`[WindowHelper] Launcher click-through ${passthrough ? 'ON' : 'OFF'}`);
    }

    this.getAssistantWindows().forEach((win) => {
      win.setIgnoreMouseEvents(passthrough, { forward: true });
      if (!passthrough) win.setFocusable(true);
    });

    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    // Click-through whenever stealth passthrough is on, OR (in interactive mode)
    // the pointer is not over the painted content. forward:true keeps pointer
    // events flowing to the OS layer beneath in either click-through case.
    const ignoreMouse = passthrough || !this.overlayHoverInteractive;

    if (ignoreMouse) {
      // forward: true — pointer events are still delivered to the OS layer beneath.
      // NOTE: We intentionally do NOT call setFocusable(false) here.
      //
      // Rationale: setIgnoreMouseEvents() alone is sufficient for transparent
      // mouse behaviour.  Setting focusable=false when the overlay is the only
      // visible window makes macOS treat the app as having NO active windows.
      // In that state, macOS may stop delivering Carbon/IOKit global hotkey
      // events to the process — silently breaking every globalShortcut binding.
      // Keeping the window focusable costs nothing.
      this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log(
        `[WindowHelper] Overlay click-through ON (passthrough=${passthrough}, hoverInteractive=${this.overlayHoverInteractive})`,
      );
    } else {
      this.overlayWindow.setIgnoreMouseEvents(false);
      // Restore full interactivity when capturing clicks.
      this.overlayWindow.setFocusable(true);
      console.log('[WindowHelper] Overlay click-through OFF (interactive, pointer over panel)');
    }
  }

  // Show overlay directly without going through full switchToOverlay flow.
  // Used by IPC handlers to show the overlay independently.
  public showOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    // Restore opacity in case it was zeroed by hideMainWindow() before a screenshot.
    this.overlayWindow.setOpacity(1);

    // Re-assert z-order on Windows before showing — same DWM demotion risk as
    // switchToOverlay(). Must come before show()/showInactive() so the window
    // lands at the correct level on first paint (issue #136).
    if (process.platform === 'win32') {
      this.reassertTopmost(this.overlayWindow, 'overlay');
    }

    if (this.appState.getOverlayMousePassthrough()) {
      // In passthrough/stealth mode: appear on screen without stealing OS focus.
      // The underlying app (Zoom, browser, etc.) must keep focus.
      this.overlayWindow.showInactive();
    } else {
      // Normal interactive mode: show and focus so the user can click/type.
      this.overlayWindow.showInactive();
      // Bring to front without a full app-activate (avoids dock bounce on macOS).
      // setAlwaysOnTop is already set at creation; a focus() call alone is safe.
      this.overlayWindow.focus();
    }
    this.isWindowVisible = true;
    this.reassertTopmost(this.overlayWindow, 'overlay');
  }

  // Hide overlay directly without switching to launcher.
  // Used by IPC handlers to hide the overlay independently.
  public hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }
    this.isWindowVisible = Boolean(this.launcherWindow && !this.launcherWindow.isDestroyed() && this.launcherWindow.isVisible());
  }

  public showMainWindow(inactive?: boolean): void {
    const assistant = this.activeAssistantKind
      ? this.assistantWindows.get(this.activeAssistantKind)
      : null;
    if (assistant && !assistant.isDestroyed()) {
      this.launcherWindow?.hide();
      this.overlayWindow?.hide();
      this.reassertAssistantStealth(assistant, this.activeAssistantKind!);
      assistant.setOpacity(1);
      this.restoreIfMinimized(assistant);
      if (inactive || this.appState.getUndetectable()) assistant.showInactive();
      else {
        assistant.show();
        assistant.focus();
      }
      this.reassertAssistantStealth(assistant, this.activeAssistantKind!);
      this.isWindowVisible = true;
      return;
    }

    // Show the window corresponding to the current mode
    this.restoreIfMinimized(this.getMainWindow());
    if (this.currentWindowMode === 'overlay') {
      this.switchToOverlay(inactive);
    } else {
      this.switchToLauncher(inactive);
    }
  }

  public toggleMainWindow(): void {
    const assistant = this.activeAssistantKind
      ? this.assistantWindows.get(this.activeAssistantKind)
      : null;
    const activeWindow = assistant && !assistant.isDestroyed()
      ? assistant
      : this.getMainWindow();
    if (this.isWindowActuallyVisible(activeWindow)) {
      this.hideMainWindow();
    } else {
      // Always show without stealing focus — 秒答 is a ghost overlay.
      // The user is in another app; show the window on top but leave OS focus alone.
      // They can click the window to focus it if they need to type.
      this.showMainWindow(true);
    }
  }

  public toggleOverlayWindow(): void {
    this.toggleMainWindow();
  }

  public centerAndShowWindow(): void {
    if (this.activeAssistantKind) {
      this.showMainWindow(this.appState.getUndetectable() ? true : undefined);
      return;
    }

    // If a meeting is active (overlay mode), bring the overlay up instead of the
    // launcher — switching to the launcher during a meeting would expose it in the
    // taskbar/dock and break stealth.
    const stealthShow = this.appState.getUndetectable();
    if (this.currentWindowMode === 'overlay') {
      // In undetectable mode, show without stealing focus from the foreground app.
      this.switchToOverlay(stealthShow ? true : undefined);
    } else {
      this.switchToLauncher(stealthShow ? true : undefined);
      this.launcherWindow?.center();
    }
  }

  // --- Swapping Logic ---

  public switchToOverlay(inactive?: boolean): void {
    console.log(`[WindowHelper] Switching to OVERLAY (inactive: ${!!inactive})`);
    this.currentWindowMode = 'overlay';
    this.activeAssistantKind = null;
    this.getAssistantWindows().forEach((win) => win.hide());
    KeybindManager.getInstance().setMode('overlay'); // Adapted from public PR #123 — verify premium interaction

    // Show Overlay FIRST
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.restoreIfMinimized(this.overlayWindow);
      const currentBounds = this.overlayWindow.getBounds();
      const savedBounds = this.overlayBounds
        ? {
            ...this.overlayBounds,
            height: Math.max(this.overlayBounds.height, WindowHelper.OVERLAY_MIN_HEIGHT),
          }
        : null;
      const workArea = this.getDisplayWorkArea(savedBounds ?? currentBounds);
      const maxAllowedWidth = Math.floor(workArea.width * 0.9);
      const maxAllowedHeight = Math.floor(workArea.height * 0.9);
      const targetBounds = savedBounds
        ? {
            x: Math.min(
              Math.max(savedBounds.x, workArea.x),
              workArea.x + workArea.width - Math.min(savedBounds.width, maxAllowedWidth),
            ),
            y: Math.min(
              Math.max(savedBounds.y, workArea.y),
              workArea.y + workArea.height - Math.min(savedBounds.height, maxAllowedHeight),
            ),
            width: Math.min(savedBounds.width, maxAllowedWidth),
            height: Math.min(savedBounds.height, maxAllowedHeight),
          }
        : {
            x: Math.floor(workArea.x + (workArea.width - WindowHelper.OVERLAY_DEFAULT_WIDTH) / 2),
            y: Math.floor(workArea.y + workArea.height * WindowHelper.OVERLAY_DEFAULT_TOP_RATIO),
            width: WindowHelper.OVERLAY_DEFAULT_WIDTH,
            height: Math.min(
              Math.max(currentBounds.height, WindowHelper.OVERLAY_DEFAULT_HEIGHT),
              maxAllowedHeight,
            ),
          };

      this.overlayWindow.setBounds(targetBounds);
      this.overlayBounds = this.overlayWindow.getBounds();
      this.overlayWindow.webContents.send('ensure-expanded');

      // Restore opacity before showing (it may have been zeroed by hideMainWindow).
      if (process.platform === 'win32' && this.contentProtection) {
        // Opacity Shield: Show at 0 opacity first to prevent frame leak
        this.overlayWindow.setOpacity(0);
        if (inactive) this.overlayWindow.showInactive();
        else this.overlayWindow.show();
        this.overlayWindow.setContentProtection(true);
        this.applyNativeCaptureProtection(this.overlayWindow, true, 'overlay');
        // Small delay to ensure Windows DWM processes the flag before making it opaque

        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = setTimeout(() => {
          if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.setOpacity(1);
            // Re-assert z-order on Windows — DWM can silently demote the HWND after hide/show
            this.reassertTopmost(this.overlayWindow, 'overlay');
            if (!inactive) this.overlayWindow.focus();
          }
        }, 60);
      } else {
        // Restore opacity (may have been zeroed pre-screenshot by hideMainWindow)
        this.overlayWindow.setOpacity(1);
        this.overlayWindow.setContentProtection(this.contentProtection);
        this.applyNativeCaptureProtection(this.overlayWindow, this.contentProtection, 'overlay');
        // Re-assert z-order BEFORE show on Windows — DWM processes setAlwaysOnTop
        // synchronously, so calling it before show() ensures the window lands at the
        // correct z-level on first paint. Calling it after focus() would leave a brief
        // window where the HWND is focused at the wrong z-level (issue #136).
        // Skipped on macOS — calling setAlwaysOnTop triggers [NSApp activate] which
        // steals focus from Zoom/browser even when showInactive() was used.
        if (process.platform === 'win32') {
          this.reassertTopmost(this.overlayWindow, 'overlay');
        }
        if (inactive) this.overlayWindow.showInactive();
        else this.overlayWindow.show();
        // Only grab focus for explicit user-initiated shows (not shortcut/ghost shows)
        if (!inactive) this.overlayWindow.focus();
      }
      this.isWindowVisible = true;
      this.reassertTopmost(this.overlayWindow, 'overlay');
    }

    // Hide Launcher SECOND
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.launcherWindow.hide();
      this.lastLauncherShowInactive = null;
    }
  }

  public switchToLauncher(inactive?: boolean): void {
    const requestedInactive = !!inactive;
    console.log(`[WindowHelper] Switching to LAUNCHER (inactive: ${requestedInactive})`);
    const wasLauncher = this.currentWindowMode === 'launcher';
    this.currentWindowMode = 'launcher';
    this.activeAssistantKind = null;
    this.getAssistantWindows().forEach((win) => win.hide());
    KeybindManager.getInstance().setMode('launcher'); // Adapted from public PR #123 — verify premium interaction

    const launcherAlreadyVisible =
      !!this.launcherWindow &&
      !this.launcherWindow.isDestroyed() &&
      this.launcherWindow.isVisible() &&
      this.isWindowVisible;
    const overlayAlreadyHidden =
      !this.overlayWindow ||
      this.overlayWindow.isDestroyed() ||
      !this.overlayWindow.isVisible();

    // Cold-start can call switchToLauncher twice (launcher ready-to-show plus
    // startup convergence paths). If the launcher is already visible with the
    // same focus semantics and the overlay is already hidden, skip repeated
    // opacity/show/focus work so Chromium/WindowServer don't repaint mid-animation.
    if (
      wasLauncher &&
      launcherAlreadyVisible &&
      overlayAlreadyHidden &&
      this.lastLauncherShowInactive === requestedInactive
    ) {
      console.log('[WindowHelper] Launcher already visible; skipping duplicate show');
      this.reassertTopmost(this.launcherWindow, 'launcher');
      return;
    }

    // Show Launcher FIRST
    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.restoreIfMinimized(this.launcherWindow);
      if (process.platform === 'win32' && this.contentProtection) {
        // Opacity Shield: Show at 0 opacity first
        this.launcherWindow.setOpacity(0);
        if (inactive) this.launcherWindow.showInactive();
        else this.launcherWindow.show();
        this.launcherWindow.setContentProtection(true);
        this.applyNativeCaptureProtection(this.launcherWindow, true, 'launcher');

        if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
        this.opacityTimeout = setTimeout(() => {
          if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
            this.launcherWindow.setOpacity(1);
            if (!inactive) this.launcherWindow.focus();
          }
        }, 60);
      } else {
        // Restore opacity (may have been zeroed pre-screenshot by hideMainWindow)
        this.launcherWindow.setOpacity(1);
        this.launcherWindow.setContentProtection(this.contentProtection);
        this.applyNativeCaptureProtection(this.launcherWindow, this.contentProtection, 'launcher');
        if (inactive) this.launcherWindow.showInactive();
        else this.launcherWindow.show();
        if (!inactive) this.launcherWindow.focus();
      }
      this.lastLauncherShowInactive = requestedInactive;
      this.isWindowVisible = true;
      this.reassertTopmost(this.launcherWindow, 'launcher');
    }

    // Hide Overlay SECOND
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }
  }

  // Simplified setWindowMode that just calls switchers
  public setWindowMode(mode: 'launcher' | 'overlay', inactive?: boolean): void {
    if (mode === 'launcher') {
      this.switchToLauncher(inactive);
    } else {
      this.switchToOverlay(inactive);
    }
  }

  // --- Window Movement (Applies to Overlay mostly, but generalized to active) ---
  private moveActiveWindow(dx: number, dy: number): void {
    const win = this.getMainWindow();
    if (!win) return;

    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }

  public moveWindowRight(): void {
    this.moveActiveWindow(this.step, 0);
  }
  public moveWindowLeft(): void {
    this.moveActiveWindow(-this.step, 0);
  }
  public moveWindowDown(): void {
    this.moveActiveWindow(0, this.step);
  }
  public moveWindowUp(): void {
    this.moveActiveWindow(0, -this.step);
  }

  private showContextMenu(win: BrowserWindow, point: { x: number; y: number }): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Developer Console',
        click: () => {
          win.webContents.toggleDevTools();
        },
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win, x: point.x, y: point.y });
  }

  public minimizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    // The app windows intentionally skip the taskbar. Native minimize would
    // make the window unreachable, so the title-bar button hides it instead.
    this.hideMainWindow();
  }

  public maximizeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }

  public closeWindow(): void {
    const win = this.launcherWindow;
    if (!win || win.isDestroyed()) return;
    if (this.opacityTimeout) clearTimeout(this.opacityTimeout);
    // On Windows/Linux the 'close' event listener intercepts this
    // and hides to tray unless the app is actually quitting.
    win.close();
  }
}
