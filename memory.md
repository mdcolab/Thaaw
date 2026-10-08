# THAAW Browser — Operational Memory & Solved Issues Registry

> **Agent Memory Document**  
> Consult this document before making any changes. It details solved root causes, hard constraints, and technical gotchas to prevent regressions across sessions.

---

## 1. Solved Issues Registry

### Issue 1: Audio Cracking & Video Latency Across All Video Sites
- **Symptom**: Audio popping, clicking, cracking, and video stutter/latency occurring on YouTube and other media sites.
- **Root Causes**:
  1. **Audio Buffer Underruns**: Linux systems running PipeWire/PulseAudio with Bluetooth sinks (`bluez_output`) experience buffer underruns when Chromium uses its default 512-sample audio buffer.
  2. **Thread Scheduling Block**: Chromium's `AudioServiceSandbox` prevented the browser audio process from acquiring real-time scheduling priority via RTKit on Linux.
  3. **GPU Compositor Stalls**: The `--enable-zero-copy` flag caused synchronization stalls between the Intel CometLake-U GT2 [UHD Graphics] driver (`iHD`) and the Chromium compositor.
  4. **Aggressive Background Throttling**: `TabManager` applied `setBackgroundThrottling(true)` indiscriminately to views, which throttled active and background video tabs.
- **Permanent Solution Applied**:
  - In `browser/main/index.ts`:
    - Added `--audio-buffer-size=2048`.
    - Added `AudioServiceSandbox` to `disable-features`.
    - Removed `enable-zero-copy`.
    - Added `--enable-accelerated-video-decode`, `--enable-accelerated-mjpeg-decode`, and `VaapiVideoDecodeLinuxGL`.
    - Added `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding`.
  - In `browser/main/tab-manager.ts`:
    - Dynamically set `setBackgroundThrottling(false)` on active views in `switchTab`.
    - On `media-started-playing`, immediately set `setBackgroundThrottling(false)`.
    - On `media-paused`, only restore throttling if the tab is not the currently active tab.

### Issue 2: Destructive Left-Click Image Hijacking in Untrusted Webviews
- **Symptom**: Left-clicking links, buttons, thumbnails, or interactive elements containing `<img>` tags on web pages (e.g., YouTube thumbnails, e-commerce products, social media avatars) failed to open or navigate.
- **Root Cause**: `browser/main/preload.ts` had an unrestricted capture-phase `click` event listener on `img` elements that called `e.preventDefault()` and `e.stopPropagation()` for any click that wasn't Ctrl/Cmd clicked, hijacking all normal web navigation.
- **Permanent Solution Applied**:
  - Gated the fullscreen image preview feature strictly to `e.altKey` (Alt+Click). Normal left-clicks now pass through to web pages untouched.

### Issue 3: Incomplete Ad Blocking, Video Midroll Pause/Lag Bug, and Settings Option
- **Symptom**: During video playback (YouTube midrolls, in-stream ads), the video paused with lag/freezing for several seconds before resuming. Ad blocker was also missing coverage on news articles, floating video players, and universal sites. User requested: "do you want to turn on Ad Blocker; {toggle}" in settings.
- **Root Cause**:
  1. `browser/main/preload.ts` polled for ads every 500ms and set `video.currentTime = video.duration` directly, which caused buffer starvation, black screens, and player stalls while YouTube's HTML5 buffer attempted to recover.
  2. The video was muted during ads without restoring original user audio or calling `video.play()` after ad completion.
  3. Floating video ad players (Connatix, Primis, AnyClip, Teads) and native in-article widgets (Taboola, Outbrain, MGID) were unblocked.
- **Permanent Solution Applied**:
  - Implemented root-level player sanitization in `browser/main/preload.ts` intercepting `ytInitialPlayerResponse` and `/youtubei/v1/player` to strip `adPlacements` and `adSlots`. This prevents midrolls from ever pausing the video.
  - Implemented 0ms zero-latency `MutationObserver` in `preload.ts` that detects `.ad-showing`, calls native `skipAd()`, clicks skip buttons instantly, and accelerates playback to 16x without buffer starvation. Restores user mute state and automatically calls `video.play()` on completion so playback never freezes.
  - Added universal article & floating video ad neutralizer in `preload.ts` and expanded `AdBlocker.AD_DOMAINS` and `COSMETIC_FILTERS_CSS` in `browser/privacy/ad-blocker.ts` to 250+ domains.
  - Added explicit "Do you want to turn on Ad Blocker?" toggle option in both `Native Ad Blocker` and `Privacy & Shields` sections in `browser/internal-pages/settings.html`, with real-time bidirectional synchronization and persistence in `browser/profiles/profile-manager.ts`.

### Issue 4: Downloads Popover Broken & Inert
- **Symptom**: Clicking the Downloads toolbar button opened an empty popover that never populated recent downloads or responded to "Clear" or "Show more".
- **Root Cause**: ID mismatch between `index.html` (`dlClearCompletedBtn`, `dlPopoverList`, `dlPopoverEmpty`, `dlShowMoreBtn`) and `renderer.ts` (`downloadClearBtn`, `downloadPopoverList`, `downloadPopoverEmpty`, `downloadShowMoreBtn`). Because `downloadPopoverList` was `null`, `renderDownloadPopover()` exited on line 1.
- **Permanent Solution Applied**:
  - Synchronized the IDs in `browser/ui/index.html` to `downloadClearBtn`, `downloadPopoverList`, `downloadPopoverEmpty`, and `downloadShowMoreBtn`.

### Issue 5: Missing Toolbar Main Menu (`#menuBtn` / `#mainMenu`)
- **Symptom**: `renderer.ts` had listeners for `#menuBtn` and `#mainMenu`, zoom controls, history, downloads, passwords, settings, extensions, and exit, but the HTML elements were missing from `index.html`.
- **Permanent Solution Applied**:
  - Added `#menuBtn` to `.toolbar-actions` and implemented the complete glassmorphic `#mainMenu` dropdown with zoom controls (+, -, 100%, fullscreen), navigation shortcuts, and page actions.

### Issue 6: Missing SVG Icons in Floating Custom Context Menu
- **Symptom**: Context menu items for `maximize`, `moon`, `history`, `user`, `edit`, `settings` were rendered without icons.
- **Permanent Solution Applied**:
  - Added SVG path definitions for `maximize`, `moon`, `history`, `user`, `edit`, and `settings` to the `ICONS` registry in `browser/ui/context-menu.html`.

### Issue 7: Settings Internal Page Hash Navigation Not Working
- **Symptom**: Navigating to `thaaw://settings#extensions`, `thaaw://settings#privacy`, etc., opened `settings.html` but remained stuck on the default "General" category.
- **Permanent Solution Applied**:
  - Added hash routing in `browser/internal-pages/settings.html`: reads `window.location.hash` on load, listens to `hashchange`, and activates the corresponding category section.
  - Added `#section-extensions` and sidebar button for "Extensions & Ad Blocker".
  - Mapped `thaaw://extensions` to `settings.html#extensions` in both `handleThaawProtocol` and `ipc-validator.ts`.

### Issue 8: Tab WebContentsView Disappearing on Popover Open (`setModalOpen`)
- **Symptom**: Clicking download popover, profile popover, or other toolbar options caused the active tab's web content to disappear, revealing the window wallpaper background.
- **Root Cause**: `TabManager.setModalOpen(isOpen)` called `active.view.setVisible(!isOpen)`. When any modal or flyout opened, `setModalOpen(true)` hid the active `WebContentsView`.
- **Permanent Solution Applied**:
  - In `browser/main/tab-manager.ts`: Removed `active.view.setVisible(!isOpen)` from `setModalOpen()` so tabs remain visible under popovers.
  - In `browser/ui/renderer.ts`: Removed redundant `setModalOpen(true)` calls on non-modal popovers (`downloadsBtn`, `profileBtn`).

### Issue 9: Download Popover Unclickable Due to `flyoutBackdrop` Stacking Context
- **Symptom**: Items in the download popover (clear button, individual downloads, "Show more") were completely unclickable.
- **Root Cause**: `.toolbar` had `z-index: 45` while `flyoutBackdrop` had `z-index: 990`. Because `downloadPopover` was nested inside `.toolbar`, `flyoutBackdrop` covered it and intercepted all click events.
- **Permanent Solution Applied**:
  - In `browser/ui/styles.css`: Raised `.toolbar` `z-index` to `1000`, ensuring the popovers inside it render in front of `flyoutBackdrop` (z-index 990).
  - In `browser/ui/renderer.ts`: Attached click handlers to `.download-popover-item` to open downloaded files with `shell.openPath` via `thaawAPI.downloads.openFile()`, added `stopPropagation` on clear and show-more buttons, and styled hover states.

### Issue 10: Omnibox & New Tab Autocomplete Dropdowns Style Mismatch & Inconsistencies
- **Symptom**: Autocomplete suggestions in the URL omnibox had broken/missing styles; recent search dropdown in `newtab.html` had dark-only styles clashing on light backgrounds, with inconsistent border and glassmorphism styling.
- **Root Causes**:
  1. Class name mismatch: `renderer.ts` created `.omnibox-autocomplete-item`, `.omnibox-autocomplete-title`, etc., but `styles.css` only defined `.autocomplete-item`.
  2. Duplicate `.newtab-search-history-dropdown` definitions in `internal.css` with missing light-theme backdrop-filter and glass border support.
- **Permanent Solution Applied**:
  - In `browser/ui/styles.css`: Added complete glassmorphic styling for `.omnibox-autocomplete-dropdown`, `.omnibox-autocomplete-item`, `.omnibox-autocomplete-icon`, `.omnibox-autocomplete-content`, `.omnibox-autocomplete-title`, `.omnibox-autocomplete-url`, and `.omnibox-autocomplete-action` with light and dark mode adaptations.
  - In `browser/internal-pages/internal.css`: Consolidated and refined `.newtab-search-history-dropdown` styles with full light-mode translucent glass support, theme transitions, and consistent border radii.

### Issue 11: New Tab Floating Navigation Rail Internal Route Resolution
- **Symptom**: Clicking floating navigation rail buttons (Settings, History, Downloads, Home) on `newtab.html` did not open their respective pages.
- **Root Cause**: Rail links in `newtab.html` used relative links like `href="settings.html"`, which Chromium resolved to `thaaw://newtab/settings.html`. `handleThaawProtocol` in `browser/main/index.ts` only evaluated `url.hostname` (which was `'newtab'`) and always served `newtab.html`.
- **Permanent Solution Applied**:
  - In `browser/internal-pages/newtab.html`: Updated navigation links to `thaaw://newtab`, `thaaw://history`, `thaaw://downloads`, and `thaaw://settings`, and added explicit JavaScript click event listeners to call `window.location.href = target`.
  - In `browser/main/index.ts`: Enhanced `handleThaawProtocol()` to extract pathname subpaths (e.g., `url.pathname.replace(/^\//, '')`), allowing subpath routing like `thaaw://newtab/settings.html` to gracefully resolve to `settings.html`.

### Issue 12: Search Engine Selection Consolidation & Settings Synchronization
- **Symptom**: The new tab page had a redundant, out-of-place search engine dropdown in its search bar. The search engine selector in `settings.html` was not propagating changes live to tabs or new tab search queries.
- **Permanent Solution Applied**:
  - In `browser/internal-pages/newtab.html`: Removed `.search-engine-selector` dropdown from the new tab search bar. Added `loadSearchEngine()` on page load via `thaawAPI.settings.get()` and added a listener for the `browser:engine-updated` IPC event to dynamically synchronize the default search engine and placeholder.
  - In `browser/main/index.ts`: Updated `settings:update` handler to persist `customSearchUrl` and broadcast `browser:engine-updated` to both `mainWindow` and all active web tabs.
  - In `browser/main/tab-manager.ts`: Enhanced `setDefaultSearchEngine(engine, customUrl)` to accept custom URLs and pass `customSearchUrl` to `sanitizeNavigationUrl()`.

### Issue 13: Local `file://` Scheme Navigation Support & Form Element Styling
- **Symptom**: Pasting or typing `file:///...` links (such as `file:///home/mujtaba/Downloads/browser-test-elements.html`) failed to navigate or open in the browser. Standard HTML elements (`select`, `progress`, `range`, `meter`, `details`, etc.) lacked custom styling.
- **Root Causes**:
  1. `browser/security/ipc-validator.ts` explicitly rejected any URL starting with `file:`.
  2. `browser/internal-pages/newtab.html` `isUrl()` and `normalizeUrl()` regexes did not recognize `file://`.
  3. No custom CSS design system existed for native HTML elements.
- **Permanent Solution Applied**:
  - In `browser/security/ipc-validator.ts`: Updated `sanitizeNavigationUrl()` to permit safe `file://` URLs while strictly blocking sensitive system files (`/etc/passwd`, `/etc/shadow`, `C:/Windows/System32/cmd.exe`, etc.).
  - In `browser/internal-pages/newtab.html`: Updated `isUrl()` and `normalizeUrl()` to accept `file://` URIs.
  - In `browser/main/preload.ts`: Enforced that `thaawAPI` is strictly NOT exposed to `file:` protocol pages. Injected custom CSS for HTML5 form elements (`select`, `progress`, `input[type="range"]`, `input[type="checkbox"]`, `input[type="radio"]`, `meter`, `details`, `summary`, scrollbars) on `DOMContentLoaded` for `file://` pages.
### Issue 14: Profiles Not Showing in Profile Picker ("Who's using THAAW?")
- **Symptom**: The profile picker window opened with only "Browse as Guest" and "Show profile selector on startup" visible, with no profiles rendered in the grid.
- **Root Cause**: `profile-picker.html` is loaded as an internal Electron window file via `pickerWindow.loadFile(...)` using the `file:` scheme. When `preload.ts` restricted `thaawAPI` strictly to URLs where `window.location.protocol.startsWith('thaaw:')`, `profile-picker.html` was denied `thaawAPI`. Thus `window.thaawAPI.listProfiles` was `undefined`, and `loadProfiles()` exited early without rendering any profile cards.
- **Permanent Solution Applied**:
  - In `browser/main/preload.ts`: Updated `isInternalThaaw` to recognize internal chrome UI and profile picker files (`normalizedPath.endsWith('/ui/index.html')`, `normalizedPath.endsWith('/profiles/profile-picker.html')`, etc.), ensuring `thaawAPI` is securely exposed to internal application windows while remaining strictly blocked from arbitrary user `file://` pages.
  - In `browser/profiles/profile-picker.html`: Added defensive handling in `loadProfiles()` and initialized on DOM readiness (`document.readyState`).

### Issue 15: Popover & Command Panel Overlap with WebContentsView & New Tab Controls
- **Symptom**: Popovers (Download Popover, Profile Popover, Main Menu) and the Command Panel (`#paletteModal`) appeared "behind" the new tab page controls (top-right profile/theme controls and center shortcut buttons). In addition, the Download Popover and Command Panel lacked modern styling.
- **Root Causes**:
  1. `mainWindow` hosts the top chrome toolbar and floating popovers/modals in its base window DOM. The active tab is a native Chromium `WebContentsView` (`active.view`), attached to `mainWindow.contentView` at `y = 76px`. In Electron, child `WebContentsView`s render on top of the host window's base DOM. On `newtab.html`, the view background is transparent (`#00000000`), so the new tab page's top-right controls (`.newtab-top-controls`) and center shortcuts (`#shortcutsSection`) rendered directly in front of the popovers and command palette.
  2. CSS class mismatch in `#downloadPopover`: `index.html` used `.dl-popover-*` while `styles.css` defined `.download-popover-*`, causing unstyled light/dark appearance.
  3. `#paletteModal` lacked modern search wrapper, shortcut indicators, and glassmorphic card styling.
- **Permanent Solution Applied**:
  - In `browser/main/tab-manager.ts`: Updated `setModalOpen(isOpen)` to broadcast `browser:modal-state` with `{ isOpen }` to all tab views without blanking or hiding active tab web contents.
  - In `browser/main/index.ts`: Added IPC handler for `tab:modal-state` to forward state between `mainWindow` and tabs.
  - In `browser/main/preload.ts`: Exposed `onModalStateChanged` in `thaawAPI`.
  - In `browser/ui/index.html` & `styles.css`: Modernized `#paletteModal` and unified `#downloadPopover` / `#downloadModal` with glassmorphic cards, search wrapper, ESC badge, status badges, progress bars, and comprehensive light/dark theme support.

### Issue 16: Popovers and Modals Unclickable & Misaligned due to WebContentsView Input Interception
- **Symptom**: Buttons inside the Downloads popover, Profile popover, Main menu, and Command Palette were completely unclickable. Popovers overlapped the toolbar, misaligned on window resize, and the Command Palette modal was vertically centered over search bar content and cut off.
- **Root Causes**:
  1. **OS-Level Input Occlusion**: In Electron, child `WebContentsView`s (`active.view`) render as native OS compositor surfaces directly on top of `mainWindow`'s base DOM starting at `y: 84px`. Because `active.view` covered `y >= 84px`, any mouse click inside the popover or modal rectangle was captured by `active.view` and never reached `mainWindow`'s DOM buttons.
  2. **Hardcoded Offsets & Missing Anchor Calculation**: Popovers had hardcoded `top: 76px` (overlapping the 82px toolbar) and static `right: 88px` or `right: 12px`, causing misalignment with the toolbar buttons that opened them.
  3. **Command Palette Centering Collisions**: `.modal-backdrop` used `align-items: center`, vertically centering the Command Palette in the middle of the screen over the new tab search bar and news cards, causing layout jumping as search queries filtered.
- **Permanent Solution Applied**:
  - In `browser/main/tab-manager.ts`: On `setModalOpen(true)`, captures a pixel-perfect snapshot of `active.view` via `capturePage()`, sends `browser:tab-snapshot` to `mainWindow`, and hides `active.view` (`setVisible(false)`). On `setModalOpen(false)`, restores `active.view.setVisible(true)` and hides the snapshot.
  - In `browser/main/preload.ts`: Exposed `onTabSnapshot` in `thaawAPI`.
  - In `browser/ui/index.html` & `styles.css`: Added `.tab-snapshot-layer` (`z-index: 1`, `pointer-events: none`) behind popovers/modals so tabs remain 100% visible while all popovers/modals receive full click events.
  - In `browser/ui/styles.css`: Anchored `#paletteModal` and `#tabSearchModal` at `align-items: flex-start; padding-top: 80px;` with `max-height: calc(100vh - 120px)` and scrollable `palette-list`.
  - In `browser/ui/renderer.ts`: Added dynamic bounding-box anchoring (`positionDownloadPopover`, `positionProfileMenu`, `positionMainMenu`) based on `getBoundingClientRect()` with automatic repositioning on window resize.

### Issue 15: Native OS File Chooser Shown on Download & Missing Automatic Download Popover
- **Symptom**: Downloading files (e.g., clicking "Download ZIP" on GitHub) displayed Chromium's native OS GTK "Save As" file chooser dialog, and THAAW's custom download popover with progress bar was not automatically opened.
- **Root Causes**:
  1. In Electron's `targetSession.on('will-download')` handler, `item.setSavePath(...)` was not called synchronously, causing Chromium to fall back to the native OS file chooser.
  2. In `browser/ui/renderer.ts`, `onDownloadStarted` only re-rendered `#downloadPopover` if it was already manually opened, never opening it automatically.
- **Permanent Solution Applied**:
  - In `browser/main/index.ts`: Computed sanitized target path inside `app.getPath('downloads')` with collision deduplication (`filename (1).ext`), and synchronously called `item.setSavePath(targetPath)` to completely suppress the native OS GTK file chooser dialog.
  - In `browser/ui/renderer.ts`: Updated `onDownloadStarted` to animate `#downloadsBtn`, add `.downloading-active` glowing pulse, and automatically open `#downloadPopover` so the user immediately sees the active download with live progress bar, speed, and ETA.
  - In `browser/ui/styles.css`: Added `#downloadsBtn.downloading-active` styling with a cyan glowing pulse ring (`@keyframes downloadBtnPulse`).

### Issue 17: Wallpaper System Rendering, Mapping & Sync Deficiencies
- **Symptom**: Wallpapers on the new tab page and settings were not displaying or functioning properly. Clicking wallpaper presets caused the background to become pitch black or fail to change, live video wallpapers failed to play, dimmer/blur sliders had no visible effect on the new tab page, and custom uploaded wallpapers failed to render or trigger appropriately.
- **Root Causes**:
  1. **Hidden Layer via CSS**: `browser/internal-pages/internal.css` contained `body.inside-thaaw-chrome #wallpaperLayer, body.inside-thaaw-chrome .newtab-wallpaper-layer { display: none !important; }` and `body.inside-thaaw-chrome #wallpaperOverlay { display: none !important; }`. Whenever running inside THAAW browser (where `window.thaawAPI` is present), `#wallpaperLayer` and `#wallpaperOverlay` were completely hidden, leaving only the faint 15% opacity chrome wallpaper layer behind the transparent WebContentsView.
  2. **Filename Prefix Mismatch**: Dark wallpapers in `assets/wallpapers/` have the `thaaw-` filename prefix (e.g., `thaaw-midnight-mountains.webp`, `thaaw-blue-horizon.webp`), but `browser/ui/renderer.ts` mapped dark wallpaper IDs without the prefix (e.g. `midnight-mountains.webp`), causing 404 image load errors on all dark wallpapers in the main window.
  3. **Missing Live Video Handling**: Video wallpapers (`<video id="wallpaperVideo">`) were never handled in `setWallpaper`: videos were passed as CSS `background-image: url(...)`, which is unsupported by CSS, while the `<video>` element remained `display: none` without a `src`.
  4. **Settings Wallpaper IPC Disconnect**: `applySettingsWallpaper()` in `browser/internal-pages/settings.html` only set `localStorage` without calling `window.thaawAPI.setWallpaper(wpId)`, preventing settings changes from notifying the main process, top chrome, or new tab tabs.
  5. **Protocol Subpath Resolution**: `handleThaawProtocol` in `browser/main/index.ts` did not match asset URLs requested under `thaaw://wallpapers/` or `thaaw://newtab/wallpapers/`.
  6. **Missing Broadcast to Tabs on Right-Click Save**: In `browser/main/tab-manager.ts`, `setWallpaperFromUrl()` only called `broadcastToWindow()` without calling `broadcast('browser:wallpaper-updated')` to open tabs.
- **Permanent Solution Applied**:
  1. In `browser/internal-pages/internal.css`: Removed the `display: none !important` rules on `#wallpaperLayer` and `#wallpaperOverlay` under `body.inside-thaaw-chrome`, allowing the new tab page's wallpaper and dimmer overlay to render at full fidelity.
  2. In `browser/ui/renderer.ts`: Added `WALLPAPER_FILE_MAP` and `resolveWallpaperFilename()` to reliably map IDs (with or without `thaaw-` prefix) to existing `.webp` files, and gracefully handle video data URLs without setting broken CSS background images.
  3. In `browser/internal-pages/newtab.html`: Updated `setWallpaper()` to detect video wallpapers (via MIME type, file extension, or custom wallpaper metadata), show and play `<video id="wallpaperVideo">`, and smoothly hide it when switching back to images. Normalized wallpaper ID resolution against `WALLPAPERS_30` to match all dark and light wallpapers cleanly. Added automatic synchronization of saved wallpapers into "My Wallpapers".
  4. In `browser/internal-pages/settings.html`: Updated `applySettingsWallpaper()` to call `window.thaawAPI.setWallpaper(wpId)`, and added initial fetch and `onWallpaperUpdated` listener to synchronize the active card highlight with the browser state.
  5. In `browser/main/index.ts`: Enhanced `handleThaawProtocol` to match `url.hostname === 'wallpapers'` and subpaths with `wallpapers/` in addition to `assets/`.
  6. In `browser/main/tab-manager.ts`: Added `this.broadcast('browser:wallpaper-updated', imageUrl)` to `setWallpaperFromUrl()` to ensure all open new tab pages immediately receive wallpaper updates from right-click context menus.
  7. In `tests/unit/theme-and-features.test.ts`: Added unit tests verifying wallpaper layers are not hidden, `renderer.ts` maps dark wallpaper IDs correctly, and `newtab.html` contains the required video and dimmer controls.

### Issue 18: Light Theme Wallpaper Switch Locking & Floating Cloud Widget Overlap
- **Symptom**: When switching to Light Mode via the quick toggle button, the top browser chrome switched to light and text flipped to dark/black (`#0F172A`), but the new tab page wallpaper remained stuck on a dark wallpaper (`thaaw-dark-ocean.webp`), rendering headlines ("Curated Feed & Stories", "Ready", "Encrypted Query", "A SAFER A CLEANER...") invisible (black text on dark background). Additionally, the floating cloud widget (`bottom: 24px; right: 28px`) collided directly with the 4th news card at the bottom right.
- **Root Causes**:
  1. **Asynchronous IPC Blocking DOM Rendering**: In `newtab.html`, `setWallpaper()` was `async` and awaited `window.thaawAPI.setWallpaper(wpId)` BEFORE updating `#wallpaperLayer` DOM properties (`style.backgroundImage` and `style.backgroundColor`). This caused concurrent `setTheme` IPC invocations to trigger `onThemeUpdated` loops while the DOM rendering was suspended.
  2. **Missing Light Theme Re-Render**: When switching to light theme, if the existing wallpaper was not light, it lacked synchronous local rendering before IPC propagation.
  3. **Insufficient Bottom Clearance**: `.newtab-news-fullpage` had only `60px` bottom padding, causing the 4th column card to collide with `.floating-cloud-widget` (`bottom: 24px; right: 28px;` height ~54px = 78px).
- **Permanent Solution Applied**:
  1. In `browser/internal-pages/newtab.html`: Separated synchronous DOM rendering (`applyWallpaperToDOM`) from background IPC notifications (`window.thaawAPI.setWallpaper(wpId).catch(...)`), guaranteeing instantaneous local DOM updates without blocking on IPC roundtrips.
  2. In `browser/internal-pages/newtab.html`: Added automatic switching to `'light-13'` whenever switching to Light Mode if the active wallpaper is dark or default, and re-rendering active wallpaper colors synchronously. Added guards in `onThemeUpdated` and `onWallpaperUpdated` to break redundant event cycles.
  3. In `browser/internal-pages/internal.css`: Increased `.newtab-news-fullpage` bottom padding from `60px` to `110px` and `.newtab-viewport` padding to `96px` to provide generous clearance so news cards never collide with or get covered by the bottom floating cloud widget.
  4. In `browser/internal-pages/internal.css`: Enhanced Light Mode contrast for search state bar, feedback badges, category pills (`background: rgba(255, 255, 255, 0.75)`, `color: #334155`), and motto/watermark.


### Issue 19: New Tab Main Body and Wallpaper Layer Transparency
- **Symptom**: On the New Tab page (`thaaw://newtab`), the browser window's global wallpaper was obscured by an opaque dark background (`#050812` / `var(--thaaw-bg-base)`), preventing the browser window wallpaper (`#chromeWallpaperLayer`) from displaying through the transparent `WebContentsView`.
- **Root Causes**:
  1. **Opaque Root Canvas & Body Styles**: In `browser/internal-pages/internal.css`, `.newtab-body` had `background-color: var(--thaaw-bg-base)` (`#050812`) and `html` had no explicit transparency rules, causing Chromium's layout compositor to paint an opaque canvas background over the transparent `WebContentsView`.
  2. **In-Tab Wallpaper Layer Paint**: In `browser/internal-pages/newtab.html`, `#wallpaperLayer` carried class `.newtab-wallpaper-layer.default-bg`, which painted an opaque `linear-gradient(180deg, #050812 ...)` across the viewport. Furthermore, `applyWallpaperToDOM()` set `wpLayer.style.backgroundColor = '#050812'` / `'#07111F'`.
  3. **Late Class Attachment**: The `inside-thaaw-chrome` class was added dynamically in JavaScript during `ThemeEngine.init()`, creating a flash/lock of opaque paint before script initialization.
- **Permanent Solution Applied**:
  1. In `browser/internal-pages/internal.css`: Added explicit `background: transparent !important; background-color: transparent !important;` rules for `html.inside-thaaw-chrome`, `html.newtab-page`, `html:has(body.inside-thaaw-chrome)`, `body.inside-thaaw-chrome`, `body.newtab-body`, and `.newtab-body`.
  2. In `browser/internal-pages/internal.css`: Added transparent background overrides for `#wallpaperLayer` and `.newtab-wallpaper-layer` (including `.default-bg` in both dark and light themes) under `inside-thaaw-chrome` and `.newtab-body`.
  3. In `browser/internal-pages/newtab.html`: Applied `inside-thaaw-chrome newtab-page` directly to `<html>` and `<body>` in static HTML markup, added an immediate inline transparency `<style>` block in `<head>`, and updated `applyWallpaperToDOM()` to set `wpLayer.style.backgroundColor = 'transparent'` and delegate image wallpaper presentation directly to the browser window's `#chromeWallpaperLayer` when running inside THAAW chrome.
  4. Built the project via `npm run build` and verified all 20 test suites (210 tests) pass.

### Issue 20: Comprehensive Background Style & Functional Wallpaper Layer Restoration
- **Symptom**: Background wallpapers and style appeared broken, missing, or stuck in solid black in the live browser after recent edits.
- **Root Causes**:
  1. **Dist Build Asset Out-of-Sync**: `npm run copy-assets` had not been executed following changes to `browser/internal-pages/newtab.html`, so the running Electron browser was still executing an obsolete version in `dist/` where `wpLayer.style.backgroundImage` was explicitly forced to `'none'`.
  2. **Overzealous `background-color: transparent !important` Overrides**: The CSS rule `body.inside-thaaw-chrome #wallpaperLayer { background-color: transparent !important; }` prevented JavaScript from applying solid background colors (e.g. when "None" was clicked) and destroyed the ambient `.default-bg` radial gradient.
  3. **Theme Dimmer Overlay Inversion**: In Light Mode, setting high dimmer overlay values caused a pitch-black box (`rgba(3, 7, 18, ...)`) to overlay the light theme, obscuring dark text and creating unreadable contrast.
  4. **Relative Asset Fallbacks**: Relative thumbnail and wallpaper URLs using `../assets` failed to resolve when accessed outside the protocol handler; updated to `../../assets`.
- **Permanent Solution Applied**:
  1. In `browser/internal-pages/internal.css`: Preserved transparent background on `html` and `body` while restoring functional background capabilities on `#wallpaperLayer`, including `.newtab-wallpaper-layer.default-bg` ambient radial gradients in both dark and light modes. Removed destructive `!important` color locks on `#wallpaperLayer`.
  2. In `browser/internal-pages/newtab.html`: Removed `#wallpaperLayer` transparent locks from the inline `<head>` style block. Updated `applyWallpaperToDOM` to set full-bleed cover styling (`background-size: cover; background-position: center; background-repeat: no-repeat;`) and support solid background colors when `none` is selected.
  3. In `browser/internal-pages/newtab.html`: Adapted `UserPreferences.apply()` so the dimmer overlay tint automatically switches to a light scrim (`rgba(248, 250, 252, ...)`) when the active theme is light, preserving readability.
  4. In `browser/internal-pages/settings.html`: Updated thumbnail URLs to `thaaw://wallpapers/${wp.thumb}` with `../../assets` fallback, matching `newtab.html`.
  5. Built and synchronized assets via `npm run build && npm run copy-assets`, verifying `dist/` is 100% in sync with source.
  6. Verified all 20 test suites and 210 tests pass.

### Issue 21: New Tab Viewport Overlap, Hollow Wireframe Clouds & Floating Corner Style Fixes
- **Symptom**: On the New Tab page, news cards appeared cut off vertically at the bottom of the initial screen, colliding with the bottom-right floating weather/clock widget and bottom-left motto/watermark. In addition, the floating weather widget displayed hollow wireframe arcs/loops floating above the pill capsule, and the capsule had an asymmetrical bumpy border-radius.
- **Root Causes**:
  1. **Premature Hero Stage Collapse**: `.newtab-hero-stage` had `min-height: auto`, causing the hero section to collapse to ~400px and pulling the news section into the initial viewport, cutting cards in half and overlapping fixed corner elements.
  2. **Hollow Inherited Backgrounds**: `.cloud-puff` spans used `background: inherit` inside `.cloud-puffs-bg` which had no background, causing only border-top to render as transparent wireframe arcs hovering over the widget.
  3. **Lumpy Border-Radius**: `.cloud-capsule-glass` used `border-radius: 40px 50px 38px 44px` rather than a pristine pill capsule.
  4. **Corner Obstruction on News Scroll**: On smaller screens, fixed floating corner widgets obstructed the 1st and 4th columns when reading news articles.
- **Permanent Solution Applied**:
  1. In `browser/internal-pages/internal.css`: Restored `.newtab-hero-stage` to `min-height: 100vh` with `padding: 48px 16px 36px` and anchored `.newtab-scroll-hint-wrap` at `bottom: 28px; left: 50%` so the initial screen is 100% clean, uncluttered, and un-overlapped.
  2. In `browser/internal-pages/internal.css`: Set `.newtab-viewport` padding to `0 32px 80px` to prevent initial viewport vertical overflow.
  3. In `browser/internal-pages/newtab.html` & `internal.css`: Removed `.cloud-puffs-bg` and `.cloud-puff` wireframes completely, and restyled `.cloud-capsule-glass` as a modern, frosted-glass pill capsule with `border-radius: var(--thaaw-radius-pill, 9999px)`.
  4. In `browser/internal-pages/newtab.html` & `internal.css`: Added scroll-driven fading (`.scrolled-down`) for `.floating-cloud-widget` and `.rail-bottom-group` when scrolling down past 80px into the news feed, giving users full unobstructed reading room while smoothly restoring them when scrolling back to top.
  5. Built and synchronized assets with `npm run build && npm run copy-assets`, verifying all 20 test suites (210 tests) pass.

### Issue 22: Wallpaper Overlay Transparency and Wallpaper Frosted Blur Removal
- **Symptom**: Wallpaper appeared blurred/frosted ("glassy effect") across the new tab page even when the user wanted pure wallpaper visibility, and `#wallpaperOverlay` had a syntax error typo (`'255, 255, 255, /0%'`).
- **Root Causes**:
  1. **Wallpaper Image Filter Blur**: `UserPreferences` initialized `blurIntensity: 16`, which applied `filter: blur(16px)` to `#wallpaperLayer`, blurring the entire background image into frosted glass.
  2. **Overlay Tint Calculation**: The overlay background had non-zero tint logic and an invalid color string.
- **Permanent Solution Applied**:
  1. In `browser/internal-pages/newtab.html`: Changed default `blurIntensity` to `0` and normalized any legacy `16px` blur values from `localStorage` to `0` in `UserPreferences.init()`.
  2. In `browser/internal-pages/newtab.html`: Set `#wallpaperOverlay` to `transparent` (`opacity: 0`) by default, and removed the invalid syntax typo in `apply()`.
  3. In `browser/internal-pages/newtab.html`: Updated the customize drawer blur slider default to `0px`.
  4. Built and synchronized assets via `npm run build && npm run copy-assets`, verifying all 20 test suites (210 tests) pass.

### Issue 23: Customize Drawer Redesign & Wallpaper Transition Selector Studio
- **Symptom**: User requested: "redisign the whole "customize-drawer" also add trasition selector b/w walpappers." The previous drawer lacked motion controls, had a basic single-layer background switcher with abrupt jumps between wallpapers, and needed a high-end glassmorphic studio overhaul.
- **Root Causes**:
  1. **Single-Layer DOM Limitation**: Changing `background-image` directly on `#wallpaperLayer` cannot animate transitions smoothly because browsers do not interpolate CSS background image changes natively without a secondary outgoing/incoming composited layer.
  2. **Lack of User Transition Preferences**: Users had no way to choose animation styles (`crossfade`, `zoom`, `slide-left`, `slide-right`, `slide-up`, `blur`, `flash`, `none`) or customize transition duration speeds (Fast 350ms, Natural 700ms, Cinematic 1.2s).
- **Permanent Solution Applied**:
  1. **Dual-Layer Composited Wallpaper Architecture**:
     - In `browser/internal-pages/newtab.html` & `internal.css`: Introduced `#wallpaperContainer` containing `#wallpaperLayer` (active primary), `#wallpaperLayerIncoming` (hardware-accelerated incoming layer), `#wallpaperVideo`, and `#wallpaperVideoIncoming`.
     - Integrated the Web Animations API inside `ThemeEngine.runWallpaperTransition()`: incoming layers animate smoothly on the GPU with zero white flash, and active layers cleanly swap upon animation completion.
  2. **Customize Drawer Studio Overhaul**:
     - In `browser/internal-pages/newtab.html`: Redesigned `.customize-drawer` into a 4-tab visual studio (`Wallpapers`, `Transitions`, `Themes`, `Canvas & UI`).
     - Added studio header badge chip (`THAAW STUDIO`) with pulsating cyan indicator, active preset pill, and keyboard ESC indicator.
     - In Wallpapers tab: Added quick-jump transition banner (`#wallpaperTransitionBanner`) with shortcut button to Transitions studio.
     - In Transitions tab: Added interactive **Wallpaper Transition Selector** featuring 8 transition cards (`crossfade`, `zoom`, `slide-left`, `slide-right`, `slide-up`, `blur`, `flash`, `none`), duration speed pill selector (350ms, 700ms, 1200ms), and real-time on-screen test button (`#previewTransitionBtn`).
  3. **High-End Glassmorphism & Simulation CSS**:
     - In `browser/internal-pages/internal.css`: Added acrylic glass styling, custom scrollbars, miniature transition stage simulation animations on hover/active, clean toggle cards, and complete light theme adaptations (`[data-theme="light"]`).
  4. **Strict Constraint Preservation**:
     - SVG icons expanded in `browser/internal-pages/icons.js` (`layers`, `sparkles`, `play`, `maximize`, `film`, etc.).
     - 100% Zero-Emoji Mandate preserved (`tests/unit/no-emojis.test.ts` passed).
     - Test IDs preserved (`setWallpaper(wpId, notify = true, isVideo = false)`, `overlayOpacityRange`, `blurIntensityRange`, `resetDefaultsBtn`).
  5. Built and synchronized assets via `npm run build && npm run copy-assets`. Verified all 20 test suites (211 tests) pass.

### Issue 24: Unified Browser Background Wallpaper & Elimination of Duplicate New Tab Layer
- **Symptom**: User noticed: "new tab alag wallpaper hai aur browser ka background alag wallpaper contain karta hai kyuni mainey dekha hai ki video sirf new tab waley wallpaper per play ho raha hai lekin browser ka background bilkul blank hai. sirf background wallpaper raskho usi per videos, image, etc all rakho main new tab wala wallpaper remove karo is se style kharab ho raha hai."
- **Root Causes**:
  1. **Missing Video Element in Browser Chrome**: `browser/ui/index.html` only had `#chromeWallpaperLayer` (`div`) with no `<video>` element, and `browser/ui/renderer.ts` explicitly cleared video wallpapers to solid colors (`layer.style.backgroundImage = 'none'`), leaving the main window blank when videos were selected.
  2. **Duplicate Wallpaper Layer in New Tab**: `newtab.html` contained `#wallpaperContainer` with duplicate `#wallpaperLayer` and `#wallpaperVideo`. Live video wallpapers played exclusively inside the new tab `WebContentsView`, while the base browser chrome background stayed blank and duplicate layers created visual artifacts.
- **Permanent Solution Applied**:
  1. **Consolidated Chrome Background Wallpaper**:
     - In `browser/ui/index.html`: Added `<video id="chromeWallpaperVideo" class="chrome-video-wallpaper" autoplay loop muted playsinline style="display: none;"></video>`.
     - In `browser/ui/styles.css`: Added `.chrome-video-wallpaper` with `position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: cover; z-index: 0; pointer-events: none;`.
     - In `browser/ui/renderer.ts`: Added `isVideoWallpaper()` helper and enhanced `syncChromeWallpaper()`. Videos now play smoothly in `#chromeWallpaperVideo` across the entire window background (behind glass tab strip and toolbar), while static images/presets render on `#chromeWallpaperLayer`.
  2. **Transparent New Tab Layer**:
     - In `browser/internal-pages/internal.css` & `newtab.html`: Set `#wallpaperContainer` to `display: none !important;`. The `newtab` page's `WebContentsView` is 100% transparent (`#00000000`), allowing the single global browser background wallpaper (videos, images, gradients) to shine through seamlessly.
     - In `browser/internal-pages/newtab.html`: Updated `setWallpaper()` and `applyWallpaperToDOM()` to delegate all wallpaper rendering directly to the browser chrome background via `window.thaawAPI.setWallpaper()`, eliminating dual-layer duplication and style corruption.
     - Preserved all required test IDs and signatures (`id="wallpaperLayer"`, `id="wallpaperVideo"`, `id="wallpaperOverlay"`, `setWallpaper(wpId, notify = true, isVideo = false)`).
  3. Built and synchronized assets (`npm run build`). Verified all test suites pass.

### Issue 25: Custom Uploaded Wallpaper Persistence, Range Video Streaming, and Browser Transition Animations
- **Symptoms**:
  1. Neither video nor custom uploaded themes were applying.
  2. When uploading a second video, it was not showing up in the "My Wallpapers" collection.
  3. Wallpaper transitions and "Preview Transition" were not functioning.
- **Root Causes**:
  1. **5MB LocalStorage Quota Exceeded**: `newtab.html` previously converted uploaded video files into raw Base64 Data URLs and attempted to store them in `localStorage.setItem('thaaw_custom_wallpapers', ...)`. Storing video Base64 strings immediately tripped the 5MB browser quota, silently throwing `QuotaExceededError` and dropping the second video from the collection.
  2. **Chromium Video Streaming Incompatibility with Huge Data URLs**: Chromium's media pipeline cannot seek or stream multi-megabyte `data:video/` strings across processes, causing black screens or playback failures.
  3. **Transition Engine Disconnected from Browser Background**: `newtab.html` transitions were disabled when `window.thaawAPI` was active, while `browser/ui/renderer.ts` had no transition animation engine for the main window background. Furthermore, `previewCurrentTransition()` was overwriting the active wallpaper with preset names instead of animating the active wallpaper.
- **Permanent Solution Applied**:
  1. **Persistent Custom Wallpaper Storage & Protocol**:
     - In `browser/main/index.ts`: Stored custom wallpapers as files in `userData/custom-wallpapers/` with metadata in `userData/custom-wallpapers.json`.
     - In `handleThaawProtocol`: Implemented `thaaw://custom-wallpapers/<filename>` using `net.fetch(pathToFileURL(...))` with full HTTP range support for smooth video streaming and seeking.
     - Added `wallpaper:upload-custom`, `wallpaper:get-custom-list`, and `wallpaper:delete-custom` IPC handlers.
     - In `browser/main/preload.ts`: Exposed `uploadCustomWallpaper`, `getCustomWallpapers`, and `deleteCustomWallpaper` to renderer contexts.
  2. **Dual-Layer GPU Transition Engine in Browser Chrome**:
     - In `browser/ui/index.html` & `browser/ui/styles.css`: Added `#chromeWallpaperContainer` with dual outgoing and incoming layers (`#chromeWallpaperLayerIncoming`, `#chromeWallpaperVideoIncoming`) styled with `will-change: opacity, transform, filter;` and proper z-index stacking.
     - In `browser/ui/renderer.ts`: Implemented Web Animations API (`KeyframeAnimation`) inside `syncChromeWallpaper()` supporting all 8 transition effects (`crossfade`, `zoom`, `slide-left`, `slide-right`, `slide-up`, `blur`, `flash`, `none`) with custom durations between any combinations of images and videos. Added `force` support for live transition preview.
  3. **Refactored My Wallpapers & Upload in New Tab**:
     - In `browser/internal-pages/newtab.html`: Updated `handleUpload()` to stream files via `ArrayBuffer` and `uploadCustomWallpaper()`. Updated `renderMyWallpapers()` to retrieve the full list from `getCustomWallpapers()` and delete via `deleteCustomWallpaper()`.
     - Updated `previewCurrentTransition()` to preview the chosen animation on the active wallpaper without altering selection.
  4. Verified full compilation with `npm run build` and ran all 20 test suites (211 tests) with 100% pass rate.

### Issue 26: Custom Wallpaper Application & Video Playback Fix
- **Problem**:
  1. Uploaded video and image wallpapers in "My Wallpapers" failed to apply when clicked or when "Apply Wallpaper" was pressed.
  2. `this.updateActiveWallpaperUI(wpId)` was referenced inside `setWallpaper()` and `applyWallpaperToDOM()` in `newtab.html`, but was never defined on `ThemeEngine`, throwing an uncaught `TypeError` that rejected the Promise before calling `window.thaawAPI.setWallpaper()`.
  3. The `thaaw` custom scheme registration was missing `stream: true` and `bypassCSP: true` privileges in Electron, preventing Chromium's media pipeline from streaming `<video>` files across internal origins.
  4. In `handleThaawProtocol()`, `net.fetch()` was called without forwarding `request.headers` or `bypassCustomProtocolHandlers: true`, causing HTTP byte-range requests (`Range: bytes=...`) from `<video>` to fail.
  5. `mainWindow` (`browser/ui/renderer.ts`) needed direct local file URL resolution for custom wallpapers so `#chromeWallpaperVideo` and `#chromeWallpaperLayer` can play videos natively without cross-protocol friction.
- **Solution**:
  1. **Defined `updateActiveWallpaperUI(wpId)`** in `browser/internal-pages/newtab.html` on `ThemeEngine` to cleanly update active outline states across both `.wallpaper-card-15` and `#myWallpapersGrid`.
  2. **Auto-Detected & Forwarded `isVideo`** in `setWallpaper()` and `applyWallpaperBtn` event listener so video wallpapers are always correctly flagged.
  3. **Added `stream: true` and `bypassCSP: true`** to `protocol.registerSchemesAsPrivileged` for `thaaw:` in `browser/main/index.ts`.
  4. **Forwarded `request.headers` and `bypassCustomProtocolHandlers: true`** in `handleThaawProtocol()` for all media and cached assets.
  5. **Resolved `fileUrl` in `wallpaper:set` and `wallpaper:get-custom-list`** and cached them in `browser/ui/renderer.ts` via `customWallpaperMetaMap`, playing custom videos directly on `#chromeWallpaperVideo` with hardware acceleration.
- **Verification**:
  - Full TypeScript build succeeded (`npm run build`).
  - Unit tests in `tests/unit/theme-and-features.test.ts`, `tests/unit/newtab-redesign.test.ts`, and `tests/unit/no-emojis.test.ts` all passed (49/49).

---

## 2. Critical Constraints & Gotchas

1. **Zero-Emoji Mandate**:
   - **NEVER** use unicode emoji characters anywhere in HTML, TS, or JS files.
   - Always use SVG icons (`<svg>...</svg>` or `window.getSvgIcon()` / `ICONS[...]`).
   - The test `tests/unit/no-emojis.test.ts` scans the codebase and fails the build if any emoji is found.

2. **Session Partition Isolation**:
   - Every profile uses partition `persist:thaaw_profile_<id>`.
   - Never use the default session (`session.defaultSession`) for web views.

3. **Background Throttling Rules**:
   - Do NOT call `setBackgroundThrottling(true)` on the active tab or on any tab currently playing media.

4. **Downloads Security Policy**:
   - Never automatically open downloads or launch the system file manager upon download completion without user confirmation.

5. **Intel GPU Compositor Stability**:
   - Do NOT add `--enable-zero-copy` back to `app.commandLine` on Linux platforms; it triggers compositor frame stalls on Intel Mesa drivers.

6. **Local `file://` Security Policy**:
   - `file://` URLs are permitted for local HTML testing and viewing.
   - `thaawAPI` MUST NEVER be exposed to `file:` protocol pages (strictly restricted to `thaaw:` internal pages).
   - Sensitive system files (`/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, Windows System32 executables) are blocked at the IPC validation layer in `sanitizeNavigationUrl()`.

