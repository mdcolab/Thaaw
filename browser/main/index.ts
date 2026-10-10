/**
 * THAAW Browser — Main Process
 * "THAAW — Stop What Shouldn't Pass."
 * Security-first, privacy-by-default Chromium architecture.
 */

import { app, BrowserWindow, protocol, session, ipcMain, net, Menu, MenuItem, clipboard, nativeTheme, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { TabManager } from './tab-manager';
import { TrackerBlocker, ProtectionLevel } from '../privacy/tracker-blocker';
import { PermissionManager, PermissionType, PermissionDecision } from '../permissions/permission-manager';
import { DownloadManager } from '../downloads/download-manager';
import { ProfileManager, ProfileSettings } from '../profiles/profile-manager';
import { AuthManager } from '../profiles/auth-manager';
import { HistoryManager } from './history-manager';
import { BookmarkManager } from './bookmark-manager';
import { PasswordManager } from './password-manager';
import { NewsProvider } from './news-provider';
import { PwaManager } from './pwa-manager';
import { sanitizeNavigationUrl, validateTabId } from '../security/ipc-validator';

// Enforce standard Linux application identity so WM_CLASS binds to thaaw-browser.desktop
if (process.platform === 'linux') {
  app.name = 'thaaw-browser';
  try {
    (app as any).setDesktopName?.('thaaw-browser.desktop');
  } catch {}
}

export const appIconPath = (() => {
  const candidates = [
    path.join(process.cwd(), 'assets', 'icons', 'thaaw-app-icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'icons', 'thaaw-app-icon.png'),
    path.join(__dirname, '..', '..', '..', 'assets', 'icons', 'thaaw-app-icon.png'),
    path.join(app.getAppPath(), 'assets', 'icons', 'thaaw-app-icon.png'),
    '/home/mujtaba/.local/share/icons/hicolor/512x512/apps/thaaw-browser.png'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return '';
})();

export const appIcon = appIconPath ? nativeImage.createFromPath(appIconPath) : nativeImage.createEmpty();

// Startup timing benchmark
const startupStartTime = Date.now();

// 1. Enforce hardened Chromium security & performance flags before app ready
app.commandLine.appendSwitch('enable-strict-site-isolation');
// Disable AudioServiceSandbox on Linux to allow real-time thread scheduling with PipeWire/PulseAudio (eliminates audio cracking)
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,AudioServiceSandbox');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// Audio latency & buffer fix for Linux PulseAudio/PipeWire and Bluetooth sinks (prevents buffer underruns)
app.commandLine.appendSwitch('audio-buffer-size', '2048');

// High-performance hardware video acceleration & rasterization switches
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');

// Ultra-fast networking & instantaneous cache loading
// (Avoid forced enable-quic: UDP 443 drops cause a 1.5 - 3.0s fallback delay)
app.commandLine.appendSwitch('enable-tcp-fastopen');
app.commandLine.appendSwitch('enable-async-dns');
app.commandLine.appendSwitch('disk-cache-size', '1073741824'); // 1 GB disk cache for instant reloads
app.commandLine.appendSwitch('media-cache-size', '536870912'); // 512 MB media cache

// Enable high performance Chromium features in a single call
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,CanvasOopRasterization,ParallelDownloading,NetworkServiceInProcess,BackForwardCache,AsyncDns');

// Prevent backgrounding / throttling of active media views and compositor stalls
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Register custom privileged scheme for internal pages
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'thaaw',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

export interface WindowContext {
  id: number;
  window: BrowserWindow;
  tabManager: TabManager;
  profileId: string;
}

const windowRegistry = new Map<number, WindowContext>();

let mainWindow: BrowserWindow | null = null;
let pickerWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;

export function getMainWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windowRegistry.has(focused.id)) return focused;
  const first = windowRegistry.values().next().value;
  return first ? first.window : null;
}

export function getWindowContextForSender(sender?: Electron.WebContents | null): WindowContext | null {
  if (!sender) {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && windowRegistry.has(focused.id)) {
      return windowRegistry.get(focused.id)!;
    }
    return windowRegistry.values().next().value || null;
  }

  // 1. Match by window chrome webContents
  for (const ctx of windowRegistry.values()) {
    if (!ctx.window.isDestroyed() && ctx.window.webContents.id === sender.id) {
      return ctx;
    }
  }

  // 2. Match by any tab WebContentsView in tabManager
  for (const ctx of windowRegistry.values()) {
    if (ctx.tabManager.hasWebContents(sender)) {
      return ctx;
    }
  }

  // 3. Fallback to focused or first registered window
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windowRegistry.has(focused.id)) {
    return windowRegistry.get(focused.id)!;
  }
  return windowRegistry.values().next().value || null;
}

export function broadcastToProfile(profileId: string, channel: string, ...args: any[]): void {
  for (const ctx of windowRegistry.values()) {
    if (ctx.profileId === profileId) {
      try {
        if (!ctx.window.isDestroyed()) {
          ctx.window.webContents.send(channel, ...args);
        }
      } catch {}
      try {
        ctx.tabManager.broadcast(channel, ...args);
      } catch {}
    }
  }
}

export function broadcastToAllWindows(channel: string, ...args: any[]): void {
  for (const ctx of windowRegistry.values()) {
    try {
      if (!ctx.window.isDestroyed()) {
        ctx.window.webContents.send(channel, ...args);
      }
    } catch {}
    try {
      ctx.tabManager.broadcast(channel, ...args);
    } catch {}
  }
}

const profileManager = new ProfileManager();
const trackerBlocker = new TrackerBlocker('balanced');
try {
  const initialSettings = profileManager.getProfileSettings();
  if (initialSettings.adBlockerEnabled !== undefined) {
    trackerBlocker.adBlocker.setEnabled(initialSettings.adBlockerEnabled);
  }
} catch {}
const permissionManager = new PermissionManager(path.join(profileManager.getProfileDir(), 'permissions.json'));
const downloadManager = new DownloadManager();
const authManager = new AuthManager();
const pwaManager = new PwaManager();

// Cache of profile-specific storage managers to ensure complete isolation
const profileHistoryManagers = new Map<string, HistoryManager>();
const profileBookmarkManagers = new Map<string, BookmarkManager>();
const profilePasswordManagers = new Map<string, PasswordManager>();

export function getHistoryManagerForProfile(profileId: string): HistoryManager {
  let mgr = profileHistoryManagers.get(profileId);
  if (!mgr) {
    const profDir = profileManager.getProfileDir(profileId);
    mgr = new HistoryManager(path.join(profDir, 'history.json'));
    profileHistoryManagers.set(profileId, mgr);
  }
  return mgr;
}

export function getBookmarkManagerForProfile(profileId: string): BookmarkManager {
  let mgr = profileBookmarkManagers.get(profileId);
  if (!mgr) {
    const profDir = profileManager.getProfileDir(profileId);
    mgr = new BookmarkManager(path.join(profDir, 'bookmarks.json'));
    profileBookmarkManagers.set(profileId, mgr);
  }
  return mgr;
}

export function getPasswordManagerForProfile(profileId: string): PasswordManager {
  let mgr = profilePasswordManagers.get(profileId);
  if (!mgr) {
    const profDir = profileManager.getProfileDir(profileId);
    mgr = new PasswordManager(path.join(profDir, 'vault.json'));
    profilePasswordManagers.set(profileId, mgr);
  }
  return mgr;
}

// Active storage managers for default compatibility
let activeHistoryManager = getHistoryManagerForProfile(profileManager.getActiveProfile().id);
let activeBookmarkManager = getBookmarkManagerForProfile(profileManager.getActiveProfile().id);
let activePasswordManager = getPasswordManagerForProfile(profileManager.getActiveProfile().id);
const newsProvider = new NewsProvider();

// High-speed in-memory cache for resolved protocol files to eliminate repeated disk I/O
const protocolPathCache = new Map<string, string>();

export function handleThaawProtocol(request: GlobalRequest): Promise<Response> | Response {
  try {
    const cachedPath = protocolPathCache.get(request.url);
    if (cachedPath && fs.existsSync(cachedPath)) {
      return net.fetch(pathToFileURL(cachedPath).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      });
    }

    const url = new URL(request.url);
    const subpath = url.pathname.replace(/^\/+/, '');

    // 1. Check for assets (logos, icons, wallpapers, favicons)
    if (
      url.hostname === 'assets' ||
      url.hostname === 'wallpapers' ||
      subpath.startsWith('assets/') ||
      subpath.includes('/assets/') ||
      subpath.startsWith('wallpapers/') ||
      subpath.includes('/wallpapers/')
    ) {
      let assetRel = '';
      if (url.hostname === 'assets') {
        assetRel = subpath;
      } else if (url.hostname === 'wallpapers') {
        assetRel = path.join('wallpapers', subpath);
      } else if (subpath.includes('assets/')) {
        const idx = subpath.indexOf('assets/');
        assetRel = subpath.substring(idx + 7);
      } else if (subpath.includes('wallpapers/')) {
        const idx = subpath.indexOf('wallpapers/');
        assetRel = subpath.substring(idx);
      } else {
        assetRel = subpath;
      }

      const candidate1 = path.join(__dirname, '..', '..', 'assets', assetRel);
      const candidate2 = path.join(__dirname, '..', '..', '..', 'assets', assetRel);
      const candidate3 = path.join(app.getAppPath(), 'assets', assetRel);
      const candidate4 = path.join(app.getAppPath(), 'dist', 'assets', assetRel);
      const candidates = [candidate1, candidate2, candidate3, candidate4];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          protocolPathCache.set(request.url, c);
          return net.fetch(pathToFileURL(c).toString(), {
            headers: request.headers,
            bypassCustomProtocolHandlers: true
          });
        }
      }
    }

    // 1b. Check for custom uploaded wallpapers (persistent storage in userData/custom-wallpapers)
    if (
      url.hostname === 'custom-wallpapers' ||
      subpath.startsWith('custom-wallpapers/') ||
      subpath.startsWith('wallpapers/custom/')
    ) {
      let customFilename = '';
      if (url.hostname === 'custom-wallpapers') {
        customFilename = subpath;
      } else if (subpath.startsWith('custom-wallpapers/')) {
        customFilename = subpath.replace(/^custom-wallpapers\//, '');
      } else if (subpath.startsWith('wallpapers/custom/')) {
        customFilename = subpath.replace(/^wallpapers\/custom\//, '');
      }
      const customPath = path.join(app.getPath('userData'), 'custom-wallpapers', customFilename);
      if (fs.existsSync(customPath)) {
        protocolPathCache.set(request.url, customPath);
        return net.fetch(pathToFileURL(customPath).toString(), {
          headers: request.headers,
          bypassCustomProtocolHandlers: true
        });
      }
    }

    // 2. Check for subresources (scripts, css)
    if (subpath.endsWith('tokens.css')) {
      const p = path.join(__dirname, '..', 'ui', 'theme', 'tokens.css');
      if (fs.existsSync(p)) {
        protocolPathCache.set(request.url, p);
        return net.fetch(pathToFileURL(p).toString());
      }
    } else if (subpath.endsWith('icons.js')) {
      const p = path.join(__dirname, '..', 'internal-pages', 'icons.js');
      if (fs.existsSync(p)) {
        protocolPathCache.set(request.url, p);
        return net.fetch(pathToFileURL(p).toString());
      }
    } else if (subpath.endsWith('favicon-resolver.js')) {
      const p = path.join(__dirname, '..', 'internal-pages', 'favicon-resolver.js');
      if (fs.existsSync(p)) {
        protocolPathCache.set(request.url, p);
        return net.fetch(pathToFileURL(p).toString());
      }
    } else if (subpath.endsWith('.css')) {
      const p = path.join(__dirname, '..', 'internal-pages', 'internal.css');
      if (fs.existsSync(p)) {
        protocolPathCache.set(request.url, p);
        return net.fetch(pathToFileURL(p).toString());
      }
    }

    // 3. Check for internal page HTML
    const validPages = ['newtab', 'settings', 'security', 'privacy', 'about', 'downloads', 'history', 'bookmarks', 'passwords', 'error'];
    const subpage = subpath.split('/')[0]?.replace(/\.html$/, '');
    const hostPage = (url.hostname || '').replace(/\.html$/, '');

    let pageName = '';
    if (validPages.includes(subpage)) {
      pageName = subpage;
    } else if (validPages.includes(hostPage)) {
      pageName = hostPage;
    } else {
      pageName = 'newtab';
    }
    if (validPages.includes(pageName)) {
      const candidate1 = path.join(__dirname, '..', 'internal-pages', `${pageName}.html`);
      const candidate2 = path.join(app.getAppPath(), 'browser', 'internal-pages', `${pageName}.html`);
      const candidate3 = path.join(app.getAppPath(), 'dist', 'browser', 'internal-pages', `${pageName}.html`);
      for (const c of [candidate1, candidate2, candidate3]) {
        if (fs.existsSync(c)) {
          protocolPathCache.set(request.url, c);
          return net.fetch(pathToFileURL(c).toString());
        }
      }
    }

    return new Response('Page not found', { status: 404 });
  } catch (err) {
    console.error('[THAAW] Protocol error:', err);
    return new Response('Internal error', { status: 500 });
  }
}

function setupProtocolHandlers(): void {
  if (!session.defaultSession.protocol.isProtocolHandled('thaaw')) {
    session.defaultSession.protocol.handle('thaaw', handleThaawProtocol);
  }
}

const configuredSessions = new WeakSet<Electron.Session>();

export const STANDARD_CHROME_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

let securityStatusBroadcastTimer: NodeJS.Timeout | null = null;
let pendingSecurityOrigin = '';

function broadcastSecurityStatusDebounced(origin: string): void {
  pendingSecurityOrigin = origin;
  if (!securityStatusBroadcastTimer) {
    securityStatusBroadcastTimer = setTimeout(() => {
      securityStatusBroadcastTimer = null;
      if (mainWindow && !mainWindow.isDestroyed() && pendingSecurityOrigin) {
        const stats = trackerBlocker.getStatsForDomain(pendingSecurityOrigin);
        mainWindow.webContents.send('browser:security-status-updated', stats);
      }
    }, 200);
  }
}

export function configureSessionSecurity(targetSession: Electron.Session): void {
  if (!targetSession.protocol.isProtocolHandled('thaaw')) {
    targetSession.protocol.handle('thaaw', handleThaawProtocol);
  }

  // Set standard modern Chrome User-Agent to eliminate anti-bot/Cloudflare delays
  try {
    targetSession.setUserAgent(STANDARD_CHROME_USER_AGENT);
  } catch {}

  if (configuredSessions.has(targetSession)) return;
  configuredSessions.add(targetSession);

  // Intercept all outgoing requests before sockets are created
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // Fast-path internal, data, blob, and local resources without blocking
    if (
      (url.charCodeAt(0) === 116 && url.startsWith('thaaw:')) ||
      (url.charCodeAt(0) === 100 && url.startsWith('data:')) ||
      (url.charCodeAt(0) === 98 && url.startsWith('blob:')) ||
      (url.charCodeAt(0) === 102 && url.startsWith('file:')) ||
      url.startsWith('devtools:') ||
      url.startsWith('chrome:')
    ) {
      return callback({ cancel: false });
    }

    const initiator = (details as unknown as { initiator?: string }).initiator;
    const origin = details.referrer || initiator || '';
    const decision = trackerBlocker.shouldBlockRequest(url, origin);

    if (decision.block) {
      // "Stop What Shouldn't Pass"
      callback({ cancel: true });
      if (mainWindow && !mainWindow.isDestroyed()) {
        broadcastSecurityStatusDebounced(origin);
      }
      return;
    }

    callback({ cancel: false });
  });

  // Strip cross-origin referrers to origin only (optimized: zero cloning unless Referer & initiator exist)
  targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const referer = details.requestHeaders?.['Referer'];
    const initiator = (details as unknown as { initiator?: string }).initiator;
    if (!referer || !initiator) {
      return callback({ requestHeaders: details.requestHeaders });
    }
    try {
      const refUrl = new URL(referer);
      const initUrl = new URL(initiator);
      if (refUrl.hostname !== initUrl.hostname) {
        const headers = { ...details.requestHeaders, Referer: `${refUrl.protocol}//${refUrl.hostname}/` };
        return callback({ requestHeaders: headers });
      }
    } catch {
      // Leave unchanged if malformed
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // Permission request broker
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = webContents.getURL();
    try {
      const parsed = new URL(details.requestingUrl || webContents.getURL());
      origin = parsed.origin;
    } catch {
      origin = details.requestingUrl || webContents.getURL();
    }
    const permType = permission as PermissionType;
    const existing = permissionManager.checkPermission(origin, permType);

    if (existing === 'allow') {
      callback(true);
      return;
    }
    if (existing === 'deny') {
      callback(false);
      return;
    }

    // Prompt user via 4-W modal in chrome UI
    const request = permissionManager.createRequest(origin, permType, (granted) => {
      callback(granted);
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:permission-requested', request);
    } else {
      callback(false);
    }
  });

  // Download security & lifecycle broker (Never auto-open file manager!)
  targetSession.on('will-download', (_event, item, webContents) => {
    const filename = item.getFilename();
    const mimeType = item.getMimeType();
    const origin = item.getURL();
    const totalBytes = item.getTotalBytes();

    // Determine target save path in user's Downloads directory and eliminate native OS GTK save dialog
    const downloadsDir = app.getPath('downloads');
    const safeFilename = (filename || 'download').replace(/[/\\?%*:|"<>]/g, '_');
    let targetPath = path.join(downloadsDir, safeFilename);

    // Deduplicate filename if already exists in Downloads directory
    if (fs.existsSync(targetPath)) {
      const parsed = path.parse(safeFilename);
      let counter = 1;
      while (fs.existsSync(path.join(downloadsDir, `${parsed.name} (${counter})${parsed.ext}`))) {
        counter++;
      }
      targetPath = path.join(downloadsDir, `${parsed.name} (${counter})${parsed.ext}`);
    }

    // Explicitly set save path to prevent Chromium from opening native OS "Save As" / GTK file chooser
    item.setSavePath(targetPath);

    // Register active download with DownloadManager immediately
    const record = downloadManager.registerDownload(item, path.basename(targetPath), totalBytes, targetPath, origin, mimeType);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:download-started', record);
    }

    const inspection = downloadManager.inspectDownload(filename, mimeType, origin);

    if (inspection.requiresUserConfirmation) {
      item.pause();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser:download-prompt', {
          downloadId: record.id,
          inspection
        });

        ipcMain.once(`download:decision:${record.id}`, (_evt, accept: boolean) => {
          if (accept) {
            item.resume();
          } else {
            downloadManager.cancelDownload(record.id);
            item.cancel();
          }
        });
      } else {
        downloadManager.cancelDownload(record.id);
        item.cancel();
      }
    }

    item.on('updated', (_evt, state) => {
      if (state === 'interrupted') {
        const failed = downloadManager.failDownload(record.id, 'Download interrupted');
        if (mainWindow && !mainWindow.isDestroyed() && failed) {
          mainWindow.webContents.send('browser:download-failed', failed);
        }
      } else if (state === 'progressing') {
        const updated = downloadManager.updateProgress(record.id, item.getReceivedBytes(), item.getTotalBytes());
        if (mainWindow && !mainWindow.isDestroyed() && updated) {
          mainWindow.webContents.send('browser:download-progress', updated);
        }
      }
    });

    item.on('done', (_evt, state) => {
      if (state === 'completed') {
        const completed = downloadManager.completeDownload(record.id, item.getSavePath());
        if (mainWindow && !mainWindow.isDestroyed() && completed) {
          mainWindow.webContents.send('browser:download-completed', completed);
        }
        // Requirement 3: Never automatically launch the OS file manager or Downloads folder!
      } else if (state === 'cancelled') {
        const cancelled = downloadManager.cancelDownload(record.id);
        if (mainWindow && !mainWindow.isDestroyed() && cancelled) {
          mainWindow.webContents.send('browser:download-cancelled', cancelled);
        }
      } else {
        const failed = downloadManager.failDownload(record.id, 'Download failed');
        if (mainWindow && !mainWindow.isDestroyed() && failed) {
          mainWindow.webContents.send('browser:download-failed', failed);
        }
      }
    });
  });
}

function applyActiveProfile(profileId: string, resetTabs: boolean = false, targetWinCtx?: WindowContext): boolean {
  const success = profileManager.setActiveProfile(profileId);
  if (!success) return false;

  const active = profileManager.getActiveProfile();
  const profDir = profileManager.getProfileDir(active.id);

  // Configure session security and thaaw protocol handler for active profile partition
  const partition = profileManager.getPartitionName(active.id);
  const targetSession = session.fromPartition(partition);
  configureSessionSecurity(targetSession);

  // Switch storage managers to the profile's directory
  activeHistoryManager = getHistoryManagerForProfile(active.id);
  activeBookmarkManager = getBookmarkManagerForProfile(active.id);
  activePasswordManager = getPasswordManagerForProfile(active.id);
  permissionManager.setStorageFile(path.join(profDir, 'permissions.json'));

  // Also sync authManager active user to this profile if an account matches
  authManager.setActiveAccountForProfile(active.id);
  const currentUser = authManager.getCurrentUser();

  // Load and apply profile-specific settings
  const settings = profileManager.getProfileSettings(active.id);

  if (settings.protectionLevel) {
    trackerBlocker.setProtectionLevel(settings.protectionLevel as ProtectionLevel);
  }
  if (settings.adBlockerEnabled !== undefined) {
    trackerBlocker.adBlocker.setEnabled(settings.adBlockerEnabled);
  }

  const engineUpdate = {
    engine: settings.defaultSearchEngine || 'duckduckgo',
    label: settings.defaultSearchEngine === 'duckduckgo' ? 'DDG' :
           settings.defaultSearchEngine === 'google' ? 'Google' :
           settings.defaultSearchEngine === 'bing' ? 'Bing' : 'Brave'
  };

  // If a specific window switched profile, update only that window
  if (targetWinCtx) {
    targetWinCtx.profileId = active.id;
    targetWinCtx.tabManager.setHistoryManager(activeHistoryManager);
    targetWinCtx.tabManager.setDefaultSearchEngine(settings.defaultSearchEngine || 'duckduckgo');
    if (resetTabs) {
      targetWinCtx.tabManager.closeAllTabsAndOpenNew('thaaw://newtab');
    }
    if (!targetWinCtx.window.isDestroyed()) {
      targetWinCtx.window.webContents.send('browser:profile-changed', active);
      targetWinCtx.window.webContents.send('browser:auth-changed', currentUser);
      targetWinCtx.window.webContents.send('browser:theme-updated', { theme: settings.theme, preset: settings.themePreset });
      targetWinCtx.window.webContents.send('browser:wallpaper-updated', settings.wallpaper || 'default');
      targetWinCtx.window.webContents.send('browser:engine-updated', engineUpdate);
      if (settings.shortcuts) {
        targetWinCtx.window.webContents.send('browser:shortcuts-updated', settings.shortcuts);
      }
    }
    targetWinCtx.tabManager.broadcast('browser:profile-changed', active);
    targetWinCtx.tabManager.broadcast('browser:auth-changed', currentUser);
    targetWinCtx.tabManager.broadcast('browser:theme-updated', { theme: settings.theme, preset: settings.themePreset });
    targetWinCtx.tabManager.broadcast('browser:wallpaper-updated', settings.wallpaper || 'default');
    targetWinCtx.tabManager.broadcast('browser:engine-updated', engineUpdate);
    if (settings.shortcuts) {
      targetWinCtx.tabManager.broadcast('browser:shortcuts-updated', settings.shortcuts);
    }
  } else {
    // Broadcast to all windows belonging to active.id
    for (const ctx of windowRegistry.values()) {
      if (ctx.profileId === active.id) {
        ctx.tabManager.setHistoryManager(activeHistoryManager);
        ctx.tabManager.setDefaultSearchEngine(settings.defaultSearchEngine || 'duckduckgo');
        if (resetTabs) {
          ctx.tabManager.closeAllTabsAndOpenNew('thaaw://newtab');
        }
        if (!ctx.window.isDestroyed()) {
          ctx.window.webContents.send('browser:profile-changed', active);
          ctx.window.webContents.send('browser:auth-changed', currentUser);
          ctx.window.webContents.send('browser:theme-updated', { theme: settings.theme, preset: settings.themePreset });
          ctx.window.webContents.send('browser:wallpaper-updated', settings.wallpaper || 'default');
          ctx.window.webContents.send('browser:engine-updated', engineUpdate);
          if (settings.shortcuts) {
            ctx.window.webContents.send('browser:shortcuts-updated', settings.shortcuts);
          }
        }
        ctx.tabManager.broadcast('browser:profile-changed', active);
        ctx.tabManager.broadcast('browser:auth-changed', currentUser);
        ctx.tabManager.broadcast('browser:theme-updated', { theme: settings.theme, preset: settings.themePreset });
        ctx.tabManager.broadcast('browser:wallpaper-updated', settings.wallpaper || 'default');
        ctx.tabManager.broadcast('browser:engine-updated', engineUpdate);
        if (settings.shortcuts) {
          ctx.tabManager.broadcast('browser:shortcuts-updated', settings.shortcuts);
        }
      }
    }
  }

  return true;
}

function setupIpcHandlers(): void {
  ipcMain.on('tab:create', (event, url?: string) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) {
      ctx.tabManager.createTab(url || 'thaaw://newtab');
    }
  });

  ipcMain.on('tab:close', (event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    const ctx = getWindowContextForSender(event.sender);
    if (isValid && sanitizedId !== undefined && ctx) {
      ctx.tabManager.closeTab(sanitizedId);
    }
  });

  ipcMain.on('tab:switch', (event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    const ctx = getWindowContextForSender(event.sender);
    if (isValid && sanitizedId !== undefined && ctx) {
      ctx.tabManager.switchTab(sanitizedId);
    }
  });

  ipcMain.on('tab:navigate', (event, inputUrl: string) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) {
      ctx.tabManager.navigateActiveTab(inputUrl);
    }
  });

  ipcMain.on('tab:reload', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) ctx.tabManager.reloadActiveTab();
  });

  ipcMain.on('tab:stop', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) ctx.tabManager.stopActiveTab();
  });

  ipcMain.on('tab:back', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) ctx.tabManager.goBackActiveTab();
  });

  ipcMain.on('tab:forward', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) ctx.tabManager.goForwardActiveTab();
  });

  ipcMain.on('sidebar:resize', (event, width: number) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) ctx.tabManager.setSidebarOffset(width);
  });

  ipcMain.on('tab:sleep', (event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    const ctx = getWindowContextForSender(event.sender);
    if (isValid && sanitizedId !== undefined && ctx) {
      ctx.tabManager.sleepTab(sanitizedId);
    }
  });

  ipcMain.on('tab:wake', (event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    const ctx = getWindowContextForSender(event.sender);
    if (isValid && sanitizedId !== undefined && ctx) {
      ctx.tabManager.wakeTab(sanitizedId);
    }
  });

  ipcMain.handle('browser:set-minimal-mode', (event, enabled: boolean) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) {
      ctx.tabManager.setMinimalMode(!!enabled);
      if (!ctx.window.isDestroyed()) {
        ctx.window.webContents.send('browser:minimal-mode-changed', !!enabled);
      }
    }
    return { success: true, minimalMode: !!enabled };
  });

  ipcMain.on('chrome:set-height', (event, height: number) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx && typeof height === 'number' && height > 0) {
      ctx.tabManager.setChromeHeight(height);
    }
  });

  // Global Theme Management (Profile-Scoped)
  ipcMain.handle('theme:get', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const s = profileManager.getProfileSettings(profileId);
    return {
      theme: s.theme,
      preset: s.themePreset || (s.theme === 'light' ? 'white' : 'midnight')
    };
  });

  ipcMain.handle('theme:set', (event, { theme, preset }: { theme: string; preset?: string }) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const themePreset = preset || (theme === 'light' ? 'white' : 'midnight');

    // Theme switching must never replace, reset, or remove a user's custom wallpaper.
    // Wallpaper preferences are strictly independent from theme choice.
    const updated = profileManager.updateProfileSettings({ theme, themePreset }, profileId);
    const update = { theme: updated.theme, preset: updated.themePreset };

    // Synchronize Chromium native theme appearance so web content respects prefers-color-scheme
    if (theme === 'light') {
      nativeTheme.themeSource = 'light';
    } else if (theme === 'dark') {
      nativeTheme.themeSource = 'dark';
    } else {
      nativeTheme.themeSource = 'system';
    }

    // Broadcast in real-time to all open windows and tabs for this profile
    broadcastToProfile(profileId, 'browser:theme-updated', update);

    return { success: true, ...update };
  });

  // Global Wallpaper Management (Profile-Scoped)
  ipcMain.handle('wallpaper:get', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const s = profileManager.getProfileSettings(profileId);
    return s.wallpaper || 'default';
  });

  ipcMain.handle('wallpaper:save-from-url', (event, imageUrl: string) => {
    if (!imageUrl) return { success: false };
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const updated = profileManager.updateProfileSettings({ wallpaper: imageUrl }, profileId);
    const wp = updated.wallpaper || imageUrl;
    broadcastToProfile(profileId, 'browser:wallpaper-updated', wp);
    return { success: true, wallpaper: wp };
  });

  ipcMain.on('browser:request-view-image-fullscreen', (event, imageUrl: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const targetWin = ctx ? ctx.window : getMainWindow();
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('browser:view-image-fullscreen', imageUrl);
    }
  });

  ipcMain.handle('wallpaper:set', (event, wallpaper: string, options?: any) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const updated = profileManager.updateProfileSettings({ wallpaper }, profileId);
    const wp = updated.wallpaper || 'default';

    // Resolve local fileUrl and isVideo if custom wallpaper
    let fileUrl: string | undefined;
    let isVideo: boolean | undefined = options?.isVideo;
    if (wp && (wp.startsWith('thaaw://custom-wallpapers/') || wp.startsWith('custom-'))) {
      const filename = wp.startsWith('thaaw://custom-wallpapers/') ? wp.replace('thaaw://custom-wallpapers/', '') : '';
      const list = getCustomWallpapersList();
      const match = list.find((c: any) => c.url === wp || c.id === wp || (filename && c.filename === filename));
      if (match) {
        const fullPath = path.join(customWallpapersDir, match.filename);
        if (fs.existsSync(fullPath)) {
          fileUrl = pathToFileURL(fullPath).toString();
        }
        if (match.isVideo) isVideo = true;
      }
    }
    const finalOptions = { ...options, ...(fileUrl ? { fileUrl } : {}), ...(isVideo !== undefined ? { isVideo } : {}) };

    // Broadcast to all windows and tabs belonging to this profile
    broadcastToProfile(profileId, 'browser:wallpaper-updated', wp, finalOptions);

    return { success: true, wallpaper: wp, fileUrl, isVideo };
  });

  // Custom Wallpaper Management (Persistent storage in userData/custom-wallpapers)
  const customWallpapersDir = path.join(app.getPath('userData'), 'custom-wallpapers');
  const customWallpapersMetaFile = path.join(app.getPath('userData'), 'custom-wallpapers.json');

  const ensureCustomWallpapersDir = () => {
    try {
      if (!fs.existsSync(customWallpapersDir)) {
        fs.mkdirSync(customWallpapersDir, { recursive: true });
      }
    } catch {}
  };

  const getCustomWallpapersList = (): any[] => {
    try {
      if (fs.existsSync(customWallpapersMetaFile)) {
        const raw = fs.readFileSync(customWallpapersMetaFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch {}
    return [];
  };

  const saveCustomWallpapersList = (list: any[]) => {
    try {
      ensureCustomWallpapersDir();
      fs.writeFileSync(customWallpapersMetaFile, JSON.stringify(list, null, 2), 'utf8');
    } catch {}
  };

  ipcMain.handle('wallpaper:get-custom-list', () => {
    const list = getCustomWallpapersList();
    return list.map((item: any) => {
      const fullPath = path.join(customWallpapersDir, item.filename);
      const isVid = !!item.isVideo || /\.(mp4|webm|mov|m4v|ogg)$/i.test(item.filename || '');
      return {
        ...item,
        isVideo: isVid,
        fileUrl: fs.existsSync(fullPath) ? pathToFileURL(fullPath).toString() : item.url
      };
    });
  });

  ipcMain.handle('wallpaper:upload-custom', async (_event, payload: { name: string; isVideo?: boolean; originalName?: string; filePath?: string; buffer?: ArrayBuffer | Uint8Array; base64?: string }) => {
    try {
      ensureCustomWallpapersDir();
      const id = 'custom-' + Date.now();
      let ext = payload.isVideo ? 'mp4' : 'webp';
      const checkName = payload.originalName || payload.name || payload.filePath || '';
      if (checkName && checkName.includes('.')) {
        const parts = checkName.split('.');
        const last = parts[parts.length - 1].toLowerCase();
        if (['mp4', 'webm', 'mov', 'm4v', 'ogg', 'webp', 'jpg', 'jpeg', 'png', 'gif', 'svg'].includes(last)) {
          ext = last;
        }
      }
      const filename = `${id}.${ext}`;
      const destPath = path.join(customWallpapersDir, filename);

      if (payload.filePath && fs.existsSync(payload.filePath)) {
        fs.copyFileSync(payload.filePath, destPath);
      } else if (payload.buffer) {
        const buf = Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer as any);
        fs.writeFileSync(destPath, buf);
      } else if (payload.base64) {
        const cleanBase64 = payload.base64.replace(/^data:[^;]+;base64,/, '');
        fs.writeFileSync(destPath, Buffer.from(cleanBase64, 'base64'));
      } else {
        return { success: false, error: 'No file data provided' };
      }

      const isVid = !!payload.isVideo || ['mp4', 'webm', 'mov', 'm4v', 'ogg'].includes(ext);
      const fileUrl = pathToFileURL(destPath).toString();
      const item = {
        id,
        name: payload.name || 'Custom Wallpaper',
        filename,
        url: `thaaw://custom-wallpapers/${filename}`,
        fileUrl,
        filePath: destPath,
        isVideo: isVid,
        createdAt: Date.now()
      };

      const list = getCustomWallpapersList();
      list.unshift(item);
      saveCustomWallpapersList(list);

      return { success: true, item, list };
    } catch (err: any) {
      console.error('[THAAW Wallpaper] Error uploading custom wallpaper:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wallpaper:delete-custom', async (_event, id: string) => {
    try {
      const list = getCustomWallpapersList();
      const idx = list.findIndex((c: any) => c.id === id);
      if (idx !== -1) {
        const [removed] = list.splice(idx, 1);
        const filePath = path.join(customWallpapersDir, removed.filename);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
        saveCustomWallpapersList(list);
      }
      return { success: true, list };
    } catch (err: any) {
      console.error('[THAAW Wallpaper] Error deleting custom wallpaper:', err);
      return { success: false, error: err.message };
    }
  });

  // History IPC (Scoped to active profile)
  ipcMain.handle('history:get', (event, query?: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getHistoryManagerForProfile(profileId).getEntries(query);
  });
  ipcMain.handle('history:delete', (event, id: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getHistoryManagerForProfile(profileId).deleteItem(id);
  });
  ipcMain.handle('history:clear', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    getHistoryManagerForProfile(profileId).clearAll();
    return { success: true };
  });
  ipcMain.handle('history:clear-range', (event, sinceTimestamp: number) => {
    if (typeof sinceTimestamp !== 'number' || isNaN(sinceTimestamp)) {
      return { success: false, removedCount: 0 };
    }
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const removedCount = getHistoryManagerForProfile(profileId).clearRange(sinceTimestamp);
    return { success: true, removedCount };
  });
  ipcMain.handle('history:get-searches', (event, limit?: number) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getHistoryManagerForProfile(profileId).getRecentSearches(limit);
  });
  ipcMain.handle('history:add-search', (event, query: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getHistoryManagerForProfile(profileId).addSearchQuery(query);
  });
  ipcMain.handle('history:delete-search', (event, query: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getHistoryManagerForProfile(profileId).deleteSearchQuery(query);
  });
  ipcMain.handle('history:clear-searches', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    getHistoryManagerForProfile(profileId).clearSearchHistory();
    return { success: true };
  });

  // Omnibox Autocomplete IPC
  ipcMain.handle('omnibox:autocomplete', async (event, query: string) => {
    if (!query || typeof query !== 'string') return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const historyMgr = getHistoryManagerForProfile(profileId);
    const bookmarkMgr = getBookmarkManagerForProfile(profileId);

    const sanitize = (val: string) => (val || '').replace(/[<>]/g, '').trim();

    const suggestions: Array<{
      type: 'bookmark' | 'history' | 'tab' | 'search';
      title: string;
      url: string;
      snippet?: string;
      score: number;
    }> = [];

    // 1. Search open tabs in caller window
    if (ctx) {
      const openTabs = ctx.tabManager.searchTabs(q);
      for (const tab of openTabs) {
        const title = sanitize(tab.title || tab.url);
        const url = sanitize(tab.url);
        suggestions.push({
          type: 'tab',
          title,
          url,
          snippet: 'Switch to tab',
          score: (url.toLowerCase().startsWith(q) || title.toLowerCase().startsWith(q)) ? 100 : 70
        });
      }
    }

    // 2. Search Bookmarks
    const bookmarks = bookmarkMgr.getBookmarks(q);
    for (const b of bookmarks) {
      if (!b.isFolder && b.url) {
        const url = sanitize(b.url);
        if (!suggestions.some(s => s.url === url)) {
          const title = sanitize(b.title || b.url);
          const isExact = url.toLowerCase().includes(q) && (url.toLowerCase().startsWith('http://' + q) || url.toLowerCase().startsWith('https://' + q) || url.toLowerCase().startsWith(q));
          suggestions.push({
            type: 'bookmark',
            title,
            url,
            snippet: 'Bookmark',
            score: isExact ? 95 : 65
          });
        }
      }
    }

    // 3. Search History
    const historyItems = historyMgr.getEntries(q);
    for (const h of historyItems) {
      if (h.url) {
        const url = sanitize(h.url);
        if (!suggestions.some(s => s.url === url)) {
          const title = sanitize(h.title || h.url);
          let score = 50;
          try {
            const parsed = new URL(url);
            if (parsed.hostname.toLowerCase().startsWith(q)) score = 90;
            else if (parsed.hostname.toLowerCase().includes(q)) score = 75;
          } catch {}
          suggestions.push({
            type: 'history',
            title,
            url,
            snippet: 'Visited',
            score
          });
        }
      }
    }

    // 4. Search Queries
    const searches = historyMgr.getRecentSearches(10);
    for (const s of searches) {
      if (typeof s === 'string' && s.toLowerCase().includes(q)) {
        const title = sanitize(s);
        if (!suggestions.some(item => item.title.toLowerCase() === title.toLowerCase())) {
          suggestions.push({
            type: 'search',
            title,
            url: s,
            snippet: 'Search History',
            score: title.toLowerCase().startsWith(q) ? 60 : 40
          });
        }
      }
    }

    // Sort descending by score, capped at 8 results
    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, 8).map(({ type, title, url, snippet }) => ({ type, title, url, snippet }));
  });

  // Bookmarks IPC (Scoped to active profile)
  ipcMain.handle('bookmarks:get', (event, query?: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getBookmarkManagerForProfile(profileId).getBookmarks(query);
  });
  ipcMain.handle('bookmarks:add', (event, { title, url, parentId, isFolder }) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getBookmarkManagerForProfile(profileId).addBookmark(title, url, parentId, isFolder);
  });
  ipcMain.handle('bookmarks:update', (event, { id, patch }) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getBookmarkManagerForProfile(profileId).updateBookmark(id, patch);
  });
  ipcMain.handle('bookmarks:delete', (event, id: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getBookmarkManagerForProfile(profileId).deleteBookmark(id);
  });
  ipcMain.handle('bookmarks:toggle', (event, { title, url }) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getBookmarkManagerForProfile(profileId).toggleUrlBookmark(title, url);
  });
  ipcMain.handle('bookmarks:import', (event, { content, format }: { content: string; format?: 'json' | 'html' }) => {
    if (!content) return { imported: 0, errors: 1 };
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getBookmarkManagerForProfile(profileId).importBookmarks(content, format);
  });

  // Bookmarks Bar Toggle IPC
  ipcMain.handle('browser:toggle-bookmarks-bar', (event, show: boolean) => {
    const isShown = Boolean(show);
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    profileManager.updateProfileSettings({ showBookmarksBar: isShown }, profileId);
    const height = isShown ? 118 : 84;
    for (const wCtx of windowRegistry.values()) {
      if (wCtx.profileId === profileId) {
        wCtx.tabManager.setChromeHeight(height);
        if (!wCtx.window.isDestroyed()) {
          wCtx.window.webContents.send('browser:bookmarks-bar-toggled', isShown);
        }
      }
    }
    return { success: true, showBookmarksBar: isShown, chromeHeight: height };
  });

  // Passwords Vault IPC (Scoped to caller's profile)
  ipcMain.handle('passwords:get', (event, query?: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getPasswordManagerForProfile(profileId).getCredentialList(query);
  });
  ipcMain.handle('passwords:save', (event, { website, username, password }) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getPasswordManagerForProfile(profileId).saveCredential(website, username, password);
  });
  ipcMain.handle('passwords:update', (event, item: { id: string; website?: string; username?: string; password?: string }) => {
    if (!item || !item.id) return { success: false, error: 'Missing credential ID' };
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getPasswordManagerForProfile(profileId).updateCredential(item.id, item);
  });
  ipcMain.handle('passwords:reveal', (event, id: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getPasswordManagerForProfile(profileId).revealPassword(id);
  });
  ipcMain.handle('passwords:delete', (event, id: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getPasswordManagerForProfile(profileId).deleteCredential(id);
  });
  ipcMain.handle('passwords:get-security-status', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getPasswordManagerForProfile(profileId).getVaultSecurityStatus();
  });
  ipcMain.handle('passwords:import-csv', (event, csvContent: string) => {
    try {
      const ctx = getWindowContextForSender(event.sender);
      const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
      const res = getPasswordManagerForProfile(profileId).importCsv(csvContent);
      return { success: true, ...res };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to import CSV', imported: 0, errors: 1, skipped: 0 };
    }
  });
  ipcMain.handle('passwords:export-csv', (event) => {
    try {
      const ctx = getWindowContextForSender(event.sender);
      const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
      const csv = getPasswordManagerForProfile(profileId).exportCsv();
      return { success: true, csv };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to export CSV' };
    }
  });
  ipcMain.handle('passwords:get-matching', (event, originOrUrl: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return getPasswordManagerForProfile(profileId).getMatchingCredentials(originOrUrl);
  });
  ipcMain.handle('autofill:query-accounts', (event, originOrUrl: string) => {
    try {
      const ctx = getWindowContextForSender(event.sender);
      const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
      const matching = getPasswordManagerForProfile(profileId).getMatchingCredentials(originOrUrl);
      return matching.map(m => ({ website: m.website, username: m.username }));
    } catch {
      return [];
    }
  });
  ipcMain.handle('autofill:request-fill', (event, { origin, username }: { origin: string; username: string }) => {
    try {
      const ctx = getWindowContextForSender(event.sender);
      const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
      const pwdMgr = getPasswordManagerForProfile(profileId);
      const matching = pwdMgr.getMatchingCredentials(origin);
      const cred = matching.find(m => m.username.toLowerCase() === (username || '').toLowerCase());
      if (!cred) return null;
      const rev = pwdMgr.revealPassword(cred.id);
      if (rev.success && rev.password) {
        return { username: cred.username, password: rev.password };
      }
      return null;
    } catch {
      return null;
    }
  });
  ipcMain.handle('tab:autofill-active', (event, cred: { username: string; password: string }) => {
    try {
      const ctx = getWindowContextForSender(event.sender);
      const activeWebContents = (ctx ? ctx.tabManager : tabManager)?.getActiveTabWebContents();
      if (activeWebContents && !activeWebContents.isDestroyed()) {
        activeWebContents.send('autofill:do-fill', cred);
        return { success: true };
      }
      return { success: false, error: 'No active tab view' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('passwords:save-or-update', (event, item: { website: string; username: string; password: string; id?: string }) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const pwdMgr = getPasswordManagerForProfile(profileId);
    if (item.id) {
      return pwdMgr.updateCredential(item.id, item);
    }
    const matching = pwdMgr.getMatchingCredentials(item.website);
    const existing = matching.find(m => m.username.toLowerCase() === item.username.toLowerCase());
    if (existing) {
      return pwdMgr.updateCredential(existing.id, { password: item.password });
    }
    return pwdMgr.saveCredential(item.website, item.username, item.password);
  });

  ipcMain.on('password:prompt-response', (event, { decision, data }: { decision: 'save' | 'update' | 'dismiss'; data: any }) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const pwdMgr = getPasswordManagerForProfile(profileId);
    if (decision === 'save' && data?.website && data?.username && data?.password) {
      pwdMgr.saveCredential(data.website, data.username, data.password);
    } else if (decision === 'update' && data?.id && data?.password) {
      pwdMgr.updateCredential(data.id, { password: data.password });
    }
  });

  ipcMain.on('autofill:form-submitted', (event, { origin, username, password }: { origin: string; username: string; password: string }) => {
    if (!origin || !password) return;
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const pwdMgr = getPasswordManagerForProfile(profileId);
    const targetWin = ctx ? ctx.window : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const cleanOrigin = pwdMgr.normalizeDomain(origin);
    const matching = pwdMgr.getMatchingCredentials(origin);
    const existing = matching.find(m => m.username.toLowerCase() === (username || '').toLowerCase());
    if (!existing) {
      if (targetWin && !targetWin.isDestroyed()) {
        targetWin.webContents.send('browser:password-prompt', {
          mode: 'save',
          origin: cleanOrigin || origin,
          username,
          password
        });
      }
    } else {
      const revealed = pwdMgr.revealPassword(existing.id);
      if (revealed.success && revealed.password && revealed.password !== password) {
        if (targetWin && !targetWin.isDestroyed()) {
          targetWin.webContents.send('browser:password-prompt', {
            mode: 'update',
            origin: cleanOrigin || origin,
            username: existing.username,
            password,
            id: existing.id
          });
        }
      }
    }
  });

  ipcMain.on('autofill:password-fields-detected', (event, data: { hasPasswordFields: boolean; origin?: string }) => {
    const ctx = getWindowContextForSender(event.sender);
    const targetWin = ctx ? ctx.window : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('browser:password-fields-detected', data);
    }
  });

  // Authentication & Accounts IPC
  ipcMain.handle('auth:create-account', (_event, params) => {
    let profileId = params.profileId;
    if (!profileId) {
      const newProf = profileManager.createProfile(params.displayName || params.email.split('@')[0], 'user', '#3B82F6');
      profileId = newProf.id;
    }
    const res = authManager.createAccount({ ...params, profileId });
    if (res.success && res.account) {
      applyActiveProfile(res.account.profileId, false);
    }
    return res;
  });

  ipcMain.handle('auth:sign-in', (_event, params) => {
    const res = authManager.signIn(params);
    if (res.success && res.account?.profileId) {
      applyActiveProfile(res.account.profileId, true);
    }
    return res;
  });

  ipcMain.handle('auth:sign-out', () => {
    const res = authManager.signOut();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:auth-changed', null);
    }
    tabManager?.broadcast('browser:auth-changed', null);
    return res;
  });

  ipcMain.handle('auth:get-current-user', () => authManager.getCurrentUser());
  ipcMain.handle('auth:update-profile', (_event, params) => {
    const res = authManager.updateProfile(params);
    if (res.success && res.account) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser:auth-changed', res.account);
      }
      tabManager?.broadcast('browser:auth-changed', res.account);
    }
    return res;
  });
  ipcMain.handle('auth:list-accounts', () => authManager.listAccounts());

  // Developer Tools IPC
  ipcMain.on('devtools:toggle', () => {
    tabManager?.toggleDevToolsActiveTab();
  });
  ipcMain.on('devtools:inspect', (_event, { x, y }: { x?: number; y?: number } = {}) => {
    tabManager?.inspectElementActiveTab(x, y);
  });

  // Tab Strip Context Menu IPC
  ipcMain.on('tab:context-menu', (_event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    if (isValid && sanitizedId !== undefined && tabManager) {
      tabManager.showTabContextMenu(sanitizedId);
    }
  });

  // News Provider & Reader IPC
  ipcMain.handle('news:get', async (_event, category?: string, page?: number, view?: string, forceRefresh?: boolean) =>
    newsProvider.getNews(category, page, 16, view, forceRefresh)
  );
  ipcMain.handle('news:get-rss-feeds', () => newsProvider.getCustomRssFeeds());
  ipcMain.handle('news:add-rss-feed', async (_event, { url, name, category }) =>
    newsProvider.validateAndAddRssFeed(url, name, category)
  );
  ipcMain.handle('news:delete-rss-feed', (_event, id: string) => newsProvider.deleteCustomRssFeed(id));
  ipcMain.handle('news:get-follow-state', () => newsProvider.getFollowState());
  ipcMain.handle('news:toggle-follow-publisher', (_event, publisher: string) =>
    newsProvider.toggleFollowPublisher(publisher)
  );
  ipcMain.handle('news:toggle-follow-channel', (_event, channel: string) =>
    newsProvider.toggleFollowChannel(channel)
  );
  ipcMain.handle('news:hide-publisher', (_event, publisher: string) => {
    newsProvider.hidePublisher(publisher);
    return { success: true };
  });
  ipcMain.handle('news:hide-topic', (_event, topic: string) => {
    newsProvider.hideTopic(topic);
    return { success: true };
  });

  ipcMain.handle('security:get-status', () => {
    const active = tabManager?.getActiveTabInfo();
    const origin = active?.url || 'thaaw://newtab';
    return trackerBlocker.getStatsForDomain(origin);
  });

  ipcMain.handle('security:toggle-shield', () => {
    const active = tabManager?.getActiveTabInfo();
    const origin = active?.url || '';
    const newStatus = trackerBlocker.toggleShield(origin);
    return { isShieldActive: newStatus };
  });

  ipcMain.handle('security:set-protection-level', (_event, level: ProtectionLevel) => {
    trackerBlocker.setProtectionLevel(level);
    return { level: trackerBlocker.getProtectionLevel() };
  });

  ipcMain.handle('adblock:get-status', () => {
    const active = tabManager?.getActiveTabInfo();
    const origin = active?.url || '';
    return {
      enabled: trackerBlocker.adBlocker.isEnabled(),
      siteBlockedCount: origin ? trackerBlocker.adBlocker.getBlockedCountForSite(origin) : 0,
      totalBlockedCount: trackerBlocker.adBlocker.getTotalBlockedCount(),
      siteEnabled: origin ? trackerBlocker.adBlocker.isShieldActive(origin) : true,
    };
  });

  ipcMain.handle('adblock:toggle', (_event, enabled?: boolean) => {
    const newState = enabled !== undefined ? enabled : !trackerBlocker.adBlocker.isEnabled();
    trackerBlocker.adBlocker.setEnabled(newState);
    profileManager.updateProfileSettings({ adBlockerEnabled: newState });
    return { enabled: newState };
  });

  ipcMain.handle('adblock:toggle-site', (_event, hostname?: string) => {
    const active = tabManager?.getActiveTabInfo();
    let target = hostname || '';
    if (!target && active?.url) {
      try {
        target = new URL(active.url).hostname;
      } catch {
        target = '';
      }
    }
    if (!target) return { siteEnabled: true };
    const siteEnabled = trackerBlocker.adBlocker.toggleSiteException(target);
    return { siteEnabled, hostname: target };
  });

  ipcMain.on('permission:respond', (_event, { requestId, decision }: { requestId: string; decision: PermissionDecision }) => {
    permissionManager.handleResponse(requestId, decision);
  });

  ipcMain.on('download:respond', (_event, { downloadId, accept }: { downloadId: string; accept: boolean }) => {
    ipcMain.emit(`download:decision:${downloadId}`, null, accept);
  });

  // Downloads Subsystem API Handlers
  ipcMain.handle('downloads:get-recent', () => downloadManager.getRecentDownloads(5));
  ipcMain.handle('downloads:get-all', () => downloadManager.getAllDownloads());
  ipcMain.handle('downloads:pause', (_event, id: string) => downloadManager.pauseDownload(id));
  ipcMain.handle('downloads:resume', (_event, id: string) => downloadManager.resumeDownload(id));
  ipcMain.handle('downloads:cancel', (_event, id: string) => !!downloadManager.cancelDownload(id));
  ipcMain.handle('downloads:open-file', async (_event, id: string) => downloadManager.openFile(id));
  ipcMain.handle('downloads:open-folder', (_event, id: string) => downloadManager.openContainingFolder(id));
  ipcMain.handle('downloads:delete-file', (_event, id: string) => downloadManager.deleteFile(id));
  ipcMain.handle('downloads:remove-item', (_event, id: string) => downloadManager.removeDownload(id));
  ipcMain.handle('downloads:clear-completed', () => {
    downloadManager.clearCompleted();
    return true;
  });

  // Site Intelligence for Right-Side Sidebar
  ipcMain.handle('tab:get-site-intelligence', async () => {
    if (!tabManager) return null;
    const tabInfo = tabManager.getActiveTabInfo();
    if (!tabInfo) return null;

    const url = tabInfo.url || '';
    const isInternal = url.startsWith('thaaw://') || url.startsWith('view-source:');
    let domain = 'THAAW';
    let isSecure = true;
    let protocol = 'thaaw:';
    let trackerStats: any = null;
    let cookieCount = 0;
    let permissions: Record<string, 'allow' | 'deny' | 'prompt'> = {};

    if (!isInternal && (url.startsWith('http://') || url.startsWith('https://'))) {
      try {
        const parsed = new URL(url);
        domain = parsed.hostname;
        protocol = parsed.protocol;
        isSecure = protocol === 'https:';
        trackerStats = trackerBlocker.getStatsForDomain(url);
        permissions = permissionManager.getPermissionsForOrigin(parsed.origin);

        const activeProfile = profileManager.getActiveProfile();
        const partition = profileManager.getPartitionName(activeProfile.id);
        const sess = session.fromPartition(partition);
        const cookies = await sess.cookies.get({ domain });
        cookieCount = cookies.length;
      } catch {
        // Fallback
      }
    }

    const allDownloads = downloadManager.getAllDownloads();
    const siteDownloads = domain !== 'THAAW'
      ? allDownloads.filter(d => d.url && d.url.includes(domain)).slice(0, 5)
      : [];

    return {
      url,
      title: tabInfo.title || domain,
      favicon: tabInfo.favicon,
      domain,
      protocol,
      isSecure,
      isInternal,
      trackerStats,
      cookieCount,
      permissions,
      shieldActive: trackerStats ? trackerStats.isShieldActive : true,
      protectionLevel: trackerBlocker.getProtectionLevel(),
      downloads: siteDownloads
    };
  });

  ipcMain.on('sidebar:set-right', (_event, width: number) => {
    if (tabManager && typeof width === 'number') {
      tabManager.setRightSidebar(width);
    }
  });

  ipcMain.handle('site:clear-data', async (_event, domain: string) => {
    if (!domain || domain === 'THAAW') return false;
    try {
      const activeProfile = profileManager.getActiveProfile();
      const partition = profileManager.getPartitionName(activeProfile.id);
      const sess = session.fromPartition(partition);
      await sess.clearStorageData({
        origin: `https://${domain}`,
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
      });
      await sess.clearStorageData({
        origin: `http://${domain}`,
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
      });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('site:set-permission', (_event, { origin, perm, value }: { origin: string; perm: string; value: 'allow' | 'deny' | 'prompt' }) => {
    permissionManager.setPermissionState(origin, perm as any, value);
    return true;
  });

  ipcMain.on('view:zoom-in', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    (ctx ? ctx.tabManager : tabManager)?.zoomInActiveTab();
  });
  ipcMain.on('view:zoom-out', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    (ctx ? ctx.tabManager : tabManager)?.zoomOutActiveTab();
  });
  ipcMain.on('view:zoom-reset', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    (ctx ? ctx.tabManager : tabManager)?.zoomResetActiveTab();
  });
  ipcMain.on('window:minimize', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const win = ctx ? ctx.window : mainWindow;
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('window:maximize', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const win = ctx ? ctx.window : mainWindow;
    const tm = ctx ? ctx.tabManager : tabManager;
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      if (tm) {
        setTimeout(() => tm.updateActiveViewBounds(), 30);
        setTimeout(() => tm.updateActiveViewBounds(), 100);
        setTimeout(() => tm.updateActiveViewBounds(), 250);
      }
    }
  });
  ipcMain.on('window:close', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const win = ctx ? ctx.window : mainWindow;
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.on('view:toggle-fullscreen', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const win = ctx ? ctx.window : mainWindow;
    if (win && !win.isDestroyed()) {
      win.setFullScreen(!win.isFullScreen());
    }
  });
  ipcMain.on('view:print', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const wc = (ctx ? ctx.tabManager : tabManager)?.getActiveTabWebContents();
    if (wc && !wc.isDestroyed()) wc.print();
  });
  ipcMain.on('view:save', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    const wc = tm?.getActiveTabWebContents();
    if (wc && !wc.isDestroyed()) (tm as any)?.savePageAs(wc);
  });
  ipcMain.on('view:source', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    const wc = tm?.getActiveTabWebContents();
    if (wc && !wc.isDestroyed()) (tm as any)?.viewPageSource(wc);
  });

  ipcMain.on('tab:mute', (event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    if (isValid && sanitizedId !== undefined && tm) {
      tm.toggleTabMute(sanitizedId);
    }
  });

  ipcMain.on('tab:pin', (event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    if (isValid && sanitizedId !== undefined && tm) {
      tm.pinTab(sanitizedId);
    }
  });

  ipcMain.on('tab:duplicate', (event, tabId: number) => {
    const { isValid, sanitizedId } = validateTabId(tabId);
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    if (isValid && sanitizedId !== undefined && tm) {
      tm.duplicateTab(sanitizedId);
    }
  });

  ipcMain.handle('tab:search', (event, query: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    if (!tm) return [];
    return tm.searchTabs(query || '');
  });

  ipcMain.on('tab:reopen-closed', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    tm?.reopenClosedTab();
  });

  // Settings State Store (Authoritative Profile-Scoped)
  ipcMain.handle('settings:get', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    return profileManager.getProfileSettings(profileId);
  });

  ipcMain.handle('settings:update', (event, patch: Partial<ProfileSettings>) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const updated = profileManager.updateProfileSettings(patch, profileId);

    if (typeof patch.showBookmarksBar === 'boolean') {
      const height = patch.showBookmarksBar ? 118 : 84;
      for (const wCtx of windowRegistry.values()) {
        if (wCtx.profileId === profileId) {
          wCtx.tabManager.setChromeHeight(height);
          if (!wCtx.window.isDestroyed()) {
            wCtx.window.webContents.send('browser:bookmarks-bar-toggled', patch.showBookmarksBar);
          }
        }
      }
    }
    if (patch.protectionLevel) {
      trackerBlocker.setProtectionLevel(patch.protectionLevel as ProtectionLevel);
    }
    if (patch.adBlockerEnabled !== undefined) {
      trackerBlocker.adBlocker.setEnabled(patch.adBlockerEnabled);
    }
    if (patch.defaultSearchEngine || patch.customSearchUrl !== undefined) {
      const engine = patch.defaultSearchEngine || updated.defaultSearchEngine || 'duckduckgo';
      const customUrl = patch.customSearchUrl !== undefined ? patch.customSearchUrl : updated.customSearchUrl;
      for (const wCtx of windowRegistry.values()) {
        if (wCtx.profileId === profileId) {
          wCtx.tabManager.setDefaultSearchEngine(engine, customUrl);
        }
      }
      const engineUpdate = {
        engine,
        customUrl,
        label: engine === 'duckduckgo' ? 'DDG' :
               engine === 'google' ? 'Google' :
               engine === 'bing' ? 'Bing' :
               engine === 'brave' ? 'Brave' : 'Custom'
      };
      broadcastToProfile(profileId, 'browser:engine-updated', engineUpdate);
    }
    if (patch.theme || patch.themePreset) {
      const update = {
        theme: updated.theme,
        preset: updated.themePreset || (updated.theme === 'light' ? 'white' : 'midnight')
      };
      broadcastToProfile(profileId, 'browser:theme-updated', update);
    }
    if (patch.wallpaper !== undefined) {
      broadcastToProfile(profileId, 'browser:wallpaper-updated', patch.wallpaper);
    }
    if (patch.shortcuts !== undefined) {
      broadcastToProfile(profileId, 'browser:shortcuts-updated', patch.shortcuts);
    }
    return updated;
  });

  ipcMain.handle('profile:list', () => profileManager.listProfiles());
  ipcMain.handle('profile:get-active', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    if (ctx) {
      const p = profileManager.listProfiles().find(pr => pr.id === ctx.profileId);
      if (p) return p;
    }
    return profileManager.getActiveProfile();
  });
  ipcMain.handle('profile:set-active', (event, id: string) => {
    const ctx = getWindowContextForSender(event.sender);
    return applyActiveProfile(id, true, ctx || undefined);
  });
  ipcMain.handle('profile:create', (_event, name: string) => profileManager.createProfile(name));
  ipcMain.handle('profile:update', (_event, id: string, patch: { name?: string; email?: string; color?: string; avatar?: string; avatarIcon?: string }) => {
    const updated = profileManager.updateProfile(id, patch || {});
    if (updated) {
      broadcastToProfile(id, 'browser:profile-changed', updated);
    }
    return updated;
  });
  ipcMain.handle('profile:duplicate', (_event, id: string) => profileManager.duplicateProfile(id));
  ipcMain.handle('profile:update-settings', (_event, id: string, patch: Partial<ProfileSettings>) => {
    const updated = profileManager.updateProfileSettings(patch || {}, id);
    if (patch.theme || patch.themePreset) {
      const update = {
        theme: updated.theme,
        preset: updated.themePreset || (updated.theme === 'light' ? 'white' : 'midnight')
      };
      broadcastToProfile(id, 'browser:theme-updated', update);
    }
    if (patch.wallpaper !== undefined) {
      broadcastToProfile(id, 'browser:wallpaper-updated', patch.wallpaper);
    }
    if (patch.shortcuts !== undefined) {
      broadcastToProfile(id, 'browser:shortcuts-updated', patch.shortcuts);
    }
    if (patch.defaultSearchEngine || patch.customSearchUrl !== undefined) {
      const engine = patch.defaultSearchEngine || updated.defaultSearchEngine || 'duckduckgo';
      const customUrl = patch.customSearchUrl !== undefined ? patch.customSearchUrl : updated.customSearchUrl;
      for (const wCtx of windowRegistry.values()) {
        if (wCtx.profileId === id) {
          wCtx.tabManager.setDefaultSearchEngine(engine, customUrl);
        }
      }
      const engineUpdate = {
        engine,
        customUrl,
        label: engine === 'duckduckgo' ? 'DDG' :
               engine === 'google' ? 'Google' :
               engine === 'bing' ? 'Bing' :
               engine === 'brave' ? 'Brave' : 'Custom'
      };
      broadcastToProfile(id, 'browser:engine-updated', engineUpdate);
    }
    return updated;
  });
  ipcMain.handle('profile:can-delete', (_event, id: string) => profileManager.canDeleteProfile(id));
  ipcMain.handle('profile:delete', async (_event, id: string) => {
    if (!profileManager.canDeleteProfile(id)) return { success: false, reason: 'Profile is active, protected, or the last available profile.' };
    const profile = profileManager.listProfiles().find(p => p.id === id);
    if (profile?.storagePath) {
      await session.fromPartition(profileManager.getPartitionName(id)).clearStorageData().catch(() => undefined);
    }
    return { success: profileManager.deleteProfile(id) };
  });
  ipcMain.handle('profile:get-startup-preference', () => profileManager.shouldShowProfilePickerOnStartup());
  ipcMain.handle('profile:set-startup-preference', (_event, val: boolean) => {
    profileManager.setShowProfilePickerOnStartup(val);
    return { success: true };
  });
  ipcMain.handle('profile:select-and-launch', (_event, profileId: string) => {
    applyActiveProfile(profileId, false);

    if (pickerWindow && !pickerWindow.isDestroyed()) {
      const pw = pickerWindow;
      pickerWindow = null;
      pw.close();
    }
    if (windowRegistry.size === 0) {
      createWindow(profileId);
    } else {
      const win = getMainWindow();
      if (win) win.focus();
    }
    return { success: true };
  });
  ipcMain.on('profile:picker-launch', () => {
    createProfilePickerWindow();
  });

  // PWA Subsystem IPC Handlers
  ipcMain.handle('pwa:install', async (_event, manifest) => {
    const res = await pwaManager.installPwa(manifest);
    if (res.success && res.pwa) {
      const activeProf = profileManager.getActiveProfile();
      const activePart = profileManager.getPartitionName(activeProf.id);
      pwaManager.openPwaWindow(res.pwa.id, activePart);
    }
    return res;
  });
  ipcMain.handle('pwa:open', (_event, id: string) => {
    const activeProf = profileManager.getActiveProfile();
    const activePart = profileManager.getPartitionName(activeProf.id);
    return { success: !!pwaManager.openPwaWindow(id, activePart) };
  });
  ipcMain.handle('pwa:list', () => pwaManager.listPwas());
  ipcMain.handle('pwa:uninstall', (_event, id: string) => pwaManager.uninstallPwa(id));
  ipcMain.handle('pwa:check-installed', (_event, originOrUrl: string) => pwaManager.isPwaInstalled(originOrUrl));

  ipcMain.on('profile:context-menu', (event, id: string) => {
    const profile = profileManager.listProfiles().find(p => p.id === id);
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    const targetWin = ctx ? ctx.window : mainWindow;
    if (!profile || !tm) return;
    const canDelete = profileManager.canDeleteProfile(id);
    tm.showCustomContextMenu([
      { id: 'open', label: 'Open Profile', icon: 'user' },
      { id: 'edit', label: 'Edit Profile', icon: 'edit' },
      { id: 'duplicate', label: 'Duplicate Profile', icon: 'copy', disabled: profile.isPrivate },
      { id: 'rename', label: 'Rename Profile', icon: 'edit', disabled: profile.isPrivate },
      { id: 'avatar', label: 'Change Avatar', icon: 'image', disabled: profile.isPrivate },
      { id: 'settings', label: 'Profile Settings', icon: 'settings' },
      { id: 'separator', type: 'separator', label: '' },
      { id: 'delete', label: 'Delete Profile', icon: 'trash', disabled: !canDelete }
    ], action => {
      if (action === 'open') applyActiveProfile(id, true, ctx || undefined);
      else targetWin?.webContents.send('browser:profile-context-action', { action, profileId: id });
    });
  });

  // Native Menus that render on top of WebContentsView
  ipcMain.on('menu:show-main', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const win = ctx ? ctx.window : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const tm = ctx ? ctx.tabManager : tabManager;
    if (!win) return;
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => tm?.createTab('thaaw://newtab') },
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow(ctx?.profileId) },
      { type: 'separator' },
      { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => tm?.createTab('thaaw://bookmarks') },
      { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => tm?.createTab('thaaw://history') },
      { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => tm?.createTab('thaaw://downloads') },
      { label: 'Password Vault', click: () => tm?.createTab('thaaw://passwords') },
      { type: 'separator' },
      { label: 'Security Center', click: () => tm?.createTab('thaaw://security') },
      { label: 'Privacy Center', click: () => tm?.createTab('thaaw://privacy') },
      { label: 'Settings', click: () => tm?.createTab('thaaw://settings') },
      { type: 'separator' },
      { label: 'About THAAW', click: () => tm?.createTab('thaaw://about') }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });

  ipcMain.on('menu:show-profile', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const win = ctx ? ctx.window : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const tm = ctx ? ctx.tabManager : tabManager;
    if (!win) return;
    const active = ctx ? (profileManager.listProfiles().find(p => p.id === ctx.profileId) || profileManager.getActiveProfile()) : profileManager.getActiveProfile();
    const profiles = profileManager.listProfiles();
    const currentUser = authManager.getCurrentUser();

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: currentUser ? `Signed In: ${currentUser.name || currentUser.email}` : `Profile: ${active.name}`,
        enabled: false
      },
      {
        label: currentUser ? currentUser.email : `Mode: ${active.isPrivate ? 'Private' : 'Standard'}`,
        enabled: false
      },
      { type: 'separator' }
    ];

    profiles.forEach(p => {
      template.push({
        label: p.name + (p.id === 'guest' || p.isPrivate ? ' (Guest)' : ''),
        type: 'radio',
        checked: p.id === active.id,
        click: () => {
          if (ctx) {
            applyActiveProfile(p.id, true, ctx);
          } else {
            applyActiveProfile(p.id, true);
          }
        }
      });
    });

    template.push({ type: 'separator' });
    template.push({
      label: 'Open Profile Selector...',
      click: () => {
        createProfilePickerWindow();
      }
    });
    template.push({
      label: 'Manage Profiles & Settings...',
      click: () => tm?.createTab('thaaw://settings')
    });

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });

  ipcMain.on('menu:show-engine', (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const win = ctx ? ctx.window : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    if (!win) return;
    const curSettings = profileManager.getProfileSettings(profileId);
    const engines: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'DuckDuckGo',
        type: 'radio',
        checked: curSettings.defaultSearchEngine === 'duckduckgo',
        click: () => {
          profileManager.updateProfileSettings({ defaultSearchEngine: 'duckduckgo' }, profileId);
          for (const wCtx of windowRegistry.values()) {
            if (wCtx.profileId === profileId) {
              wCtx.tabManager.setDefaultSearchEngine('duckduckgo');
            }
          }
          broadcastToProfile(profileId, 'browser:engine-updated', { engine: 'duckduckgo', label: 'DDG' });
        }
      },
      {
        label: 'Google',
        type: 'radio',
        checked: curSettings.defaultSearchEngine === 'google',
        click: () => {
          profileManager.updateProfileSettings({ defaultSearchEngine: 'google' }, profileId);
          for (const wCtx of windowRegistry.values()) {
            if (wCtx.profileId === profileId) {
              wCtx.tabManager.setDefaultSearchEngine('google');
            }
          }
          broadcastToProfile(profileId, 'browser:engine-updated', { engine: 'google', label: 'Google' });
        }
      },
      {
        label: 'Bing',
        type: 'radio',
        checked: curSettings.defaultSearchEngine === 'bing',
        click: () => {
          profileManager.updateProfileSettings({ defaultSearchEngine: 'bing' }, profileId);
          for (const wCtx of windowRegistry.values()) {
            if (wCtx.profileId === profileId) {
              wCtx.tabManager.setDefaultSearchEngine('bing');
            }
          }
          broadcastToProfile(profileId, 'browser:engine-updated', { engine: 'bing', label: 'Bing' });
        }
      },
      {
        label: 'Brave Search',
        type: 'radio',
        checked: curSettings.defaultSearchEngine === 'brave',
        click: () => {
          profileManager.updateProfileSettings({ defaultSearchEngine: 'brave' }, profileId);
          for (const wCtx of windowRegistry.values()) {
            if (wCtx.profileId === profileId) {
              wCtx.tabManager.setDefaultSearchEngine('brave');
            }
          }
          broadcastToProfile(profileId, 'browser:engine-updated', { engine: 'brave', label: 'Brave' });
        }
      }
    ];
    const menu = Menu.buildFromTemplate(engines);
    menu.popup({ window: win });
  });

  ipcMain.on('tab:modal-state', (event, isOpen: boolean) => {
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    const win = ctx ? ctx.window : mainWindow;
    tm?.setModalOpen(isOpen);
    win?.webContents.send('browser:modal-state', { isOpen });
  });

  ipcMain.handle('data:clear', async (event) => {
    const ctx = getWindowContextForSender(event.sender);
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    const partition = profileManager.getPartitionName(profileId);
    await session.fromPartition(partition).clearStorageData();
    return { success: true };
  });

  ipcMain.on('palette:action', (event, commandId: string) => {
    const ctx = getWindowContextForSender(event.sender);
    const tm = ctx ? ctx.tabManager : tabManager;
    const win = ctx ? ctx.window : mainWindow;
    const profileId = ctx ? ctx.profileId : profileManager.getActiveProfile().id;
    if (!tm) return;
    switch (commandId) {
      case 'new-window':
        createWindow(profileId);
        break;
      case 'new-incognito':
        createWindow('private');
        break;
      case 'exit-app':
        app.quit();
        break;
      case 'new-tab':
        tm.createTab('thaaw://newtab');
        break;
      case 'reopen-closed-tab':
        tm.reopenClosedTab();
        break;
      case 'open-security':
        tm.createTab('thaaw://security');
        break;
      case 'open-privacy':
        tm.createTab('thaaw://privacy');
        break;
      case 'open-settings':
        tm.createTab('thaaw://settings');
        break;
      case 'open-about':
        tm.createTab('thaaw://about');
        break;
      case 'open-downloads':
        tm.createTab('thaaw://downloads');
        break;
      case 'open-history':
        tm.createTab('thaaw://history');
        break;
      case 'open-bookmarks':
        tm.createTab('thaaw://bookmarks');
        break;
      case 'open-passwords':
        tm.createTab('thaaw://passwords');
        break;
      case 'toggle-theme': {
        const curSettings = profileManager.getProfileSettings(profileId);
        const nextTheme = curSettings.theme === 'dark' ? 'light' : 'dark';
        const nextPreset = nextTheme === 'light' ? 'white' : 'midnight';
        profileManager.updateProfileSettings({ theme: nextTheme, themePreset: nextPreset }, profileId);
        if (nextTheme === 'light') {
          nativeTheme.themeSource = 'light';
        } else if (nextTheme === 'dark') {
          nativeTheme.themeSource = 'dark';
        } else {
          nativeTheme.themeSource = 'system';
        }
        broadcastToProfile(profileId, 'browser:theme-updated', { theme: nextTheme, preset: nextPreset });
        break;
      }
      case 'toggle-sidebar': {
        win?.webContents.send('browser:toggle-sidebar');
        break;
      }
      case 'toggle-shield': {
        const active = tm.getActiveTabInfo();
        if (active) {
          trackerBlocker.toggleShield(active.url);
          const stats = trackerBlocker.getStatsForDomain(active.url);
          win?.webContents.send('browser:security-status-updated', stats);
        }
        break;
      }
      case 'clear-data':
        session.defaultSession.clearStorageData();
        break;
    }
  });
}

function createProfilePickerWindow(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.focus();
    return;
  }

  pickerWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#0A0D14',
    title: "Who's using THAAW?",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  if (process.platform === 'linux' && !appIcon.isEmpty()) {
    pickerWindow.setIcon(appIcon);
  }

  const candidate1 = path.join(__dirname, '..', 'profiles', 'profile-picker.html');
  const candidate2 = path.join(app.getAppPath(), 'browser', 'profiles', 'profile-picker.html');
  const candidate3 = path.join(app.getAppPath(), 'dist', 'browser', 'profiles', 'profile-picker.html');
  const pickerPath = fs.existsSync(candidate1) ? candidate1 : (fs.existsSync(candidate2) ? candidate2 : candidate3);
  pickerWindow.loadFile(pickerPath);

  pickerWindow.on('closed', () => {
    pickerWindow = null;
    if (!mainWindow && BrowserWindow.getAllWindows().length === 0) {
      app.quit();
    }
  });
}

function createWindow(targetProfileId?: string): BrowserWindow {
  // Completely suppress standard desktop application menu (File / Edit / View / Window / Help)
  Menu.setApplicationMenu(null);

  const initialProfile = targetProfileId
    ? (profileManager.listProfiles().find(p => p.id === targetProfileId) || profileManager.getActiveProfile())
    : profileManager.getActiveProfile();

  const newWin = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0A0D14',
    title: 'THAAW',
    frame: false, // Frameless: THAAW tab bar serves as top window interface without OS title bar
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false, // Chrome UI window runs with preload bridge
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  if (process.platform === 'linux' && !appIcon.isEmpty()) {
    newWin.setIcon(appIcon);
  }

  newWin.setMenuBarVisibility(false);

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = newWin;
  }

  const initialSettings = profileManager.getProfileSettings(initialProfile.id);
  const initialTheme = initialSettings.theme || 'dark';
  nativeTheme.themeSource = initialTheme === 'light' ? 'light' : initialTheme === 'dark' ? 'dark' : 'system';

  const newTabMgr = new TabManager(
    newWin,
    trackerBlocker,
    downloadManager,
    permissionManager,
    (tabs, activeTabId) => {
      if (!newWin.isDestroyed()) {
        newWin.webContents.send('browser:tabs-updated', { tabs, activeTabId });
      }
    },
    (activeUrl) => {
      if (!newWin.isDestroyed()) {
        const stats = trackerBlocker.getStatsForDomain(activeUrl);
        newWin.webContents.send('browser:security-status-updated', stats);
      }
    },
    getHistoryManagerForProfile(initialProfile.id),
    profileManager,
    configureSessionSecurity
  );
  newTabMgr.setDefaultSearchEngine(initialSettings.defaultSearchEngine || 'duckduckgo');
  if (initialSettings.showBookmarksBar) {
    newTabMgr.setChromeHeight(118);
  }

  const winCtx: WindowContext = {
    id: newWin.id,
    window: newWin,
    tabManager: newTabMgr,
    profileId: initialProfile.id
  };
  windowRegistry.set(newWin.id, winCtx);

  if (mainWindow === newWin) {
    tabManager = newTabMgr;
  }

  // Load browser shell UI
  const uiPath = path.join(__dirname, '..', 'ui', 'index.html');
  newWin.loadFile(uiPath);

  newWin.webContents.on('context-menu', (_e, params) => {
    if (newWin.isDestroyed() || !newTabMgr) return;
    const items: any[] = [];
    if (params.isEditable) {
      items.push(
        { id: 'undo', label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z' },
        { id: 'redo', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y' },
        { id: 'sep_1', type: 'separator', label: '' },
        { id: 'cut', label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X' },
        { id: 'copy', label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C' },
        { id: 'paste', label: 'Paste', icon: 'clipboard', shortcut: 'Ctrl+V' },
        { id: 'paste-and-go', label: 'Paste and Go', icon: 'arrow-right' },
        { id: 'sep_2', type: 'separator', label: '' },
        { id: 'select-all', label: 'Select All', icon: 'select', shortcut: 'Ctrl+A' },
        { id: 'sep_3', type: 'separator', label: '' },
        { id: 'inspect', label: 'Inspect', icon: 'code', shortcut: 'Ctrl+Shift+I' }
      );
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      const query = params.selectionText.trim();
      items.push(
        { id: 'copy', label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C' },
        { id: 'search-selection', label: `Search for "${query.length > 24 ? query.slice(0, 24) + '...' : query}"`, icon: 'search' },
        { id: 'sep_1', type: 'separator', label: '' },
        { id: 'inspect', label: 'Inspect', icon: 'code', shortcut: 'Ctrl+Shift+I' }
      );
    } else {
      items.push(
        { id: 'new-tab', label: 'New Tab', icon: 'plus', shortcut: 'Ctrl+T' },
        { id: 'reload', label: 'Reload', icon: 'refresh', shortcut: 'Ctrl+R' },
        { id: 'sep_1', type: 'separator', label: '' },
        { id: 'inspect', label: 'Inspect', icon: 'code', shortcut: 'Ctrl+Shift+I' }
      );
    }

    newTabMgr.showCustomContextMenu(items, (actionId: string) => {
      switch (actionId) {
        case 'undo': newWin.webContents.undo(); break;
        case 'redo': newWin.webContents.redo(); break;
        case 'cut': newWin.webContents.cut(); break;
        case 'copy': newWin.webContents.copy(); break;
        case 'paste': newWin.webContents.paste(); break;
        case 'paste-and-go': {
          const text = clipboard.readText().trim();
          if (text) newTabMgr.navigateActiveTab(text);
          break;
        }
        case 'select-all': newWin.webContents.selectAll(); break;
        case 'search-selection': {
          const query = params.selectionText.trim();
          if (query) newTabMgr.createTab(query);
          break;
        }
        case 'new-tab': newTabMgr.createTab('thaaw://newtab'); break;
        case 'reload': newTabMgr.getActiveTabWebContents()?.reload(); break;
        case 'inspect': newWin.webContents.inspectElement(params.x, params.y); break;
      }
    });
  });

  newWin.webContents.once('did-finish-load', () => {
    newWin.webContents.send('browser:profile-changed', initialProfile);
    newWin.webContents.send('browser:theme-updated', {
      theme: initialSettings.theme || 'dark',
      preset: initialSettings.themePreset || 'midnight'
    });
    if (initialSettings.wallpaper) {
      newWin.webContents.send('browser:wallpaper-updated', initialSettings.wallpaper);
    }
    if (initialSettings.shortcuts) {
      newWin.webContents.send('browser:shortcuts-updated', initialSettings.shortcuts);
    }
    const elapsed = Date.now() - startupStartTime;
    console.log(`[THAAW Benchmark] Window ${newWin.id} (profile: ${initialProfile.id}) ready in ${elapsed}ms`);
    newTabMgr.createTab('thaaw://newtab');
  });

  newWin.on('closed', () => {
    newTabMgr.destroy();
    windowRegistry.delete(newWin.id);
    if (mainWindow === newWin) {
      const remaining = getMainWindow();
      mainWindow = remaining;
      tabManager = remaining ? windowRegistry.get(remaining.id)?.tabManager || null : null;
    }
  });

  return newWin;
}

app.whenReady().then(() => {
  setupProtocolHandlers();
  configureSessionSecurity(session.defaultSession);
  app.on('session-created', (sess) => {
    configureSessionSecurity(sess);
  });

  // Configure active profile session immediately; any other sessions configure lazily on demand
  const activeProf = profileManager.getActiveProfile();
  const activePart = profileManager.getPartitionName(activeProf.id);
  const activeSess = session.fromPartition(activePart);
  configureSessionSecurity(activeSess);

  setupIpcHandlers();

  // Check for standalone PWA startup argument (--app=URL)
  const appArg = process.argv.find(arg => arg.startsWith('--app='));
  if (appArg) {
    const appUrl = appArg.replace('--app=', '');
    let pwa = pwaManager.getInstalledPwaForUrl(appUrl);
    if (!pwa) {
      try {
        const origin = new URL(appUrl).origin;
        pwa = {
          id: pwaManager.generatePwaId(origin, appUrl),
          name: 'Web Application',
          shortName: 'App',
          description: '',
          startUrl: appUrl,
          scope: origin,
          iconUrl: '',
          themeColor: '#0A0D14',
          backgroundColor: '#0A0D14',
          origin,
          installedAt: Date.now()
        };
      } catch {}
    }
    if (pwa) {
      pwaManager.openPwaWindow(pwa.id, activePart);
    } else {
      createWindow();
    }
  } else {
    // Multi-Profile Startup Check
    const selectable = profileManager.getSelectableProfiles();
    const shouldShowPicker = profileManager.shouldShowProfilePickerOnStartup() && selectable.length > 1;

    if (shouldShowPicker) {
      createProfilePickerWindow();
    } else {
      createWindow();
    }
  }
  console.log('[THAAW] Browser initialized successfully. "Stop What Shouldn\'t Pass."');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !pickerWindow) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  try {
    activeHistoryManager.flushSave();
    activeBookmarkManager.flushSave();
  } catch {}
});

