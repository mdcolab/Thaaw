# Project Map

Generated: 2026-10-10T08:23:37+00:00
Indexed files: 102

## Languages

- `ts`: 41 file(s)
- `md`: 17 file(s)
- `html`: 13 file(s)
- `svg`: 11 file(s)
- `json`: 7 file(s)
- `css`: 3 file(s)
- `js`: 3 file(s)
- `mjs`: 2 file(s)
- `yml`: 2 file(s)
- `.gitignore`: 1 file(s)
- `py`: 1 file(s)
- `sh`: 1 file(s)

## Directories and files

### Project root
- `.gitignore` (36 lines) — node_modules/
- `CHANGELOG.md` (54 lines) — All notable changes to the THAAW Browser project will be documented in this file.
- `CODE_OF_CONDUCT.md` (57 lines) — We as members, contributors, and leaders pledge to make participation in our
- `CONTRIBUTING.md` (55 lines) — Thank you for your interest in contributing to **THAAW — Stop What Shouldn’t Pass**! We are building an open-source, security-first web browser and value community participation.
- `README.md` (157 lines) — <p align="center">
- `ROADMAP.md` (65 lines) — This document outlines the engineering milestones for the THAAW browser project.
- `SECURITY.md` (61 lines) — The THAAW project takes security issues seriously. We maintain a defense-in-depth, security-first stance. We welcome contributions and reports from independent cybersecurity researchers, developers, and users.
- `context.md` (137 lines) — > **Quick Reference for AI Agents & Developers**
- `memory.md` (347 lines) — > **Agent Memory Document**
- `package-lock.json` (2505 lines) — {
- `package.json` (39 lines) — {
- `tsconfig.json` (26 lines) — {
- `vercel.json` (5 lines) — {
### `.github/`
- `pull_request_template.md` (21 lines) — - [ ] No security-sensitive changes
### `scratch/`
- `create_favicons.js` (24 lines) — const fs = require('fs');
- `generate_wallpapers.py` (481 lines) — symbols: save_wallpaper, gen_cyan_mist, gen_pink_night, gen_dark_ocean, gen_abstract_flow, gen_night_forest, gen_modern_architecture, gen_deep_space
- `test-scenarios-e2e.mjs` (297 lines) — symbols: sleep, CdpConnection, getCdpTargets, run
- `verify-e2e-theme-wallpaper.mjs` (401 lines) — symbols: sleep, CdpConnection, getCdpTargets, run, expectEqual
### `scripts/`
- `launch-thaaw.sh` (140 lines) — set -o pipefail
### `.agents/rules/`
- `virtualragmd.md` (15 lines) — trigger: always_on
### `.github/ISSUE_TEMPLATE/`
- `bug_report.md` (30 lines) — name: Bug Report
- `feature_request.md` (20 lines) — name: Feature Request
### `.github/workflows/`
- `ci.yml` (44 lines) — name: CI
- `security.yml` (32 lines) — name: Security Audit
### `assets/branding/`
- `branding-tokens.json` (54 lines) — {
### `assets/favicons/`
- `chatgpt.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#10A37F"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .5
- `duckduckgo.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="11" fill="#DE5833"/><path d="M12 4C7.58 4 4 7.58 4 12c0 3.31 2.02 6.16 4.9 7.37.2-.38.56-1.1.56-1.1s-.41-.53-.28-1.57c.15-1.18 1.13-2.04 2.22-2.04.42 0 .8.13 1.12.36.42-.
- `github.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#FFFFFF"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.1
- `gmail.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path fill="#EA4335" d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.272H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L12 9.682l8.073-
- `google.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.9
- `linkedin.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#0A66C2"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-
- `reddit.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><circle cx="12" cy="12" r="11" fill="#FF4500"/><path fill="#FFFFFF" d="M19.5 12a1.5 1.5 0 0 0-2.47-1.13c-.94-.65-2.22-1.07-3.64-1.12l.62-2.92 2.03.43a1.25 1.25 0 1 0 1.25-1.25c-.45 0-.84.24-1.05.6l
- `wikipedia.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#FFFFFF"><path d="M12.09 13.124l2.77-6.932h1.616l-3.614 8.766h-1.546l-2.493-6.197-2.493 6.197H4.784L1.17 6.192h1.616l2.77 6.932 2.126-5.328h1.616l2.802 5.328zM19.216 6.192h1.616l3.168 8.766h-
- `x.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#FFFFFF"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
- `youtube.svg` (1 lines) — <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 
### `assets/logo/`
- `thaaw-logo.svg` (10 lines) — <?xml version="1.0" encoding="UTF-8"?>
### `assets/themes/`
- `theme-presets.json` (95 lines) — {
### `assets/wallpapers/`
- `wallpapers.json` (273 lines) — [
### `browser/downloads/`
- `download-manager.ts` (551 lines) — symbols: DownloadManager
### `browser/internal-pages/`
- `about.html` (1634 lines) — <!DOCTYPE html>
- `bookmarks.html` (352 lines) — symbols: loadBookmarks, renderBookmarks, openEditModal, showToast
- `downloads.html` (521 lines) — symbols: showInternalToast, formatBytes, getIconName, loadDownloads, renderFilteredDownloads, handleCardClick, openPageActionsModal, closePageActionsModal
- `error.html` (326 lines) — <!DOCTYPE html>
- `favicon-resolver.js` (128 lines) — symbols: extractDomain, getDomainInitials, createFallbackBadgeSvg
- `history.html` (306 lines) — symbols: loadHistory, renderHistory
- `icons.js` (110 lines) — window.SVG_ICONS = {
- `internal.css` (5217 lines) — :root {
- `newtab.html` (3815 lines) — symbols: showToast, getList, nextSlide, updateUI, cleanup, loadCustomWallpapers, renderMyWallpapers, handleUpload
- `passwords.html` (484 lines) — symbols: syncVaultSecurityStatus, loadVault, showToast, renderVault, openAddModal, openEditModal, closeCredModal
- `privacy.html` (171 lines) — symbols: selectTier
- `security.html` (173 lines) — <!DOCTYPE html>
- `settings.html` (2046 lines) — symbols: selectCategory, toggleExtensionDevMode, toggleAdBlockerGlobal, refreshAdblockStats, showToast, toggleBookmarksBarSetting, selectThemePreset, applyDensity
### `browser/main/`
- `bookmark-manager.ts` (246 lines) — symbols: BookmarkManager
- `context-menu-preload.ts` (21 lines) — import { contextBridge, ipcRenderer } from 'electron';
- `history-manager.ts` (214 lines) — symbols: HistoryManager
- `index.ts` (2417 lines) — symbols: appIconPath, getMainWindow, getWindowContextForSender, broadcastToProfile, broadcastToAllWindows, getHistoryManagerForProfile, getBookmarkManagerForProfile, getPasswordManagerForProfile
- `news-provider.ts` (1255 lines) — symbols: NewsProvider
- `password-manager.ts` (435 lines) — symbols: PasswordManager
- `preload.ts` (1353 lines) — symbols: handler, initAutofill, removeAutofillPopup, triggerSubmitDetection, handleInputActivation, notifyPasswordPresence, schedulePasswordCheck, initPageEnhancements
- `pwa-manager.ts` (244 lines) — symbols: PwaManager
- `tab-manager.ts` (1538 lines) — symbols: TabManager, triggerUpdate
### `browser/permissions/`
- `permission-manager.ts` (266 lines) — symbols: PermissionManager
### `browser/privacy/`
- `ad-blocker.ts` (494 lines) — symbols: AdBlocker
- `tracker-blocker.ts` (267 lines) — symbols: TrackerBlocker
### `browser/profiles/`
- `auth-manager.ts` (367 lines) — symbols: AuthManager
- `profile-manager.ts` (443 lines) — symbols: ProfileManager
- `profile-picker.html` (488 lines) — symbols: loadProfiles, renderProfiles, selectAndLaunch, initPicker
### `browser/security/`
- `ipc-validator.ts` (399 lines) — symbols: sanitizeNavigationUrl, validateIpcChannel, validateTabId, validateIpcMessage, validatePermissionResponse, validateDownloadResponse, validateCustomSearchTemplate
### `browser/ui/`
- `context-menu.html` (278 lines) — symbols: renderMenu, setSelectedIndex
- `icons.ts` (98 lines) — symbols: getSvgIcon
- `index.html` (1273 lines) — <!DOCTYPE html>
- `renderer.ts` (4190 lines) — symbols: updateFlyoutState, openModal, closeModal, openImageLightbox, closeImageLightbox, renderTabs, checkBookmarkState, updateSecurityIndicator
- `styles.css` (4877 lines) — @import url('theme/tokens.css');
### `docs/architecture/`
- `ARCHITECTURE.md` (216 lines) — > **“THAAW — Stop What Shouldn’t Pass.”**
### `docs/development/`
- `LINUX_SETUP.md` (102 lines) — This guide describes how to set up, build, test, and run the **THAAW** browser on a modern Linux distribution (Ubuntu/Debian, Fedora, Arch, or generic X11/Wayland desktop).
- `REPOSITORY_PLAN.md` (151 lines) — > **Classification:** Public Open-Source Development Specification
- `ROADMAP.md` (65 lines) — This document outlines the engineering milestones for the THAAW browser project.
### `docs/security/`
- `THREAT_MODEL.md` (85 lines) — > **Status:** Active / Living Document
### `tests/integration/`
- `smoke.test.ts` (98 lines) — import { describe, it, expect } from 'vitest';
### `tests/security/`
- `ipc-fuzz.test.ts` (152 lines) — import { describe, it, expect } from 'vitest';
### `tests/unit/`
- `ad-blocker.test.ts` (131 lines) — import { describe, it, expect, beforeEach } from 'vitest';
- `auth-manager.test.ts` (241 lines) — import { describe, it, expect, beforeEach, afterEach } from 'vitest';
- `bookmark-manager.test.ts` (130 lines) — import { describe, it, expect, beforeEach, afterEach } from 'vitest';
- `browser-core.test.ts` (154 lines) — import { describe, it, expect, beforeEach, afterEach } from 'vitest';
- `custom-wallpaper-theme-switching.test.ts` (259 lines) — import fs from 'fs';
- `download-security.test.ts` (105 lines) — import { describe, it, expect } from 'vitest';
- `download-system-upgrade.test.ts` (195 lines) — import { describe, it, expect, beforeEach, afterEach } from 'vitest';
- `history-manager.test.ts` (92 lines) — import { describe, it, expect, beforeEach, afterEach } from 'vitest';
- `ipc-validator.test.ts` (173 lines) — import { describe, it, expect } from 'vitest';
- `multi-window-profile-settings.test.ts` (121 lines) — import fs from 'fs';
- `news-provider.test.ts` (326 lines) — import { describe, it, expect, beforeEach, afterEach } from 'vitest';
- `newtab-redesign.test.ts` (202 lines) — symbols: isUrl, normalizeUrl, buildSearchUrl
- `no-emojis.test.ts` (39 lines) — import { describe, it, expect } from 'vitest';
- `password-manager.test.ts` (98 lines) — import { describe, it, expect, beforeEach, afterEach } from 'vitest';
- `permission-manager.test.ts` (128 lines) — import { describe, it, expect, beforeEach } from 'vitest';
- `profile-manager.test.ts` (110 lines) — import fs from 'fs';
- `pwa-manager.test.ts` (133 lines) — import { describe, it, expect, beforeEach } from 'vitest';
- `search-shortcuts.test.ts` (47 lines) — import { describe, it, expect } from 'vitest';
- `site-control-modal.test.ts` (86 lines) — import { describe, it, expect } from 'vitest';
- `theme-and-features.test.ts` (182 lines) — import { describe, it, expect } from 'vitest';
- `tracker-blocker.test.ts` (133 lines) — import { describe, it, expect, beforeEach } from 'vitest';
### `browser/ui/theme/`
- `tokens.css` (475 lines) — :root {

## Usage

Use `virtualragmd search . "keywords"` and `virtualragmd context . --query "task description"` before reading large portions of the repository.
