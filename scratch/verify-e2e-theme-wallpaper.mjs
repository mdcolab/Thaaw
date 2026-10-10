/**
 * End-to-End Regression Test for Custom Wallpaper & Theme Switching
 * Tests all 6 scenarios (A, B, C, D, E, F) against live Electron instance via CDP.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.handlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onclose = () => {
      for (const handler of this.handlers.values()) handler({ result: {} });
      this.handlers.clear();
    };
    this.ws.onerror = () => {
      for (const handler of this.handlers.values()) handler({ result: {} });
      this.handlers.clear();
    };
    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.id && this.handlers.has(data.id)) {
          const handler = this.handlers.get(data.id);
          this.handlers.delete(data.id);
          handler(data);
        }
      } catch (e) {
        console.error('Error parsing CDP message:', e);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const callId = this.id++;
      this.handlers.set(callId, (data) => {
        if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
        else resolve(data.result);
      });
      this.ws.send(JSON.stringify({ id: callId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error('Evaluation exception: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

const DEBUG_PORT = 9333;
const TEST_USER_DATA = '/tmp/thaaw-e2e-theme-wp-test';

async function getCdpTargets() {
  const resp = await fetch(`http://localhost:${DEBUG_PORT}/json`);
  return await resp.json();
}

async function run() {
  console.log('=== STARTING THAAW E2E THEME & WALLPAPER VERIFICATION ===\n');

  try { fs.rmSync(TEST_USER_DATA, { recursive: true, force: true }); } catch {}

  console.log('Launching isolated THAAW Browser instance on debug port ' + DEBUG_PORT + '...');
  const env = { ...process.env, THAAW_TEST_USER_DATA: TEST_USER_DATA };
  const child = spawn('node_modules/.bin/electron', [
    '.',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${TEST_USER_DATA}`
  ], {
    cwd: process.cwd(),
    env,
    stdio: 'ignore'
  });

  child.on('error', (err) => {
    console.error('Child process error:', err);
  });

  // Wait for debug port to become available
  let connected = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const targets = await getCdpTargets();
      if (targets && targets.length > 0) {
        connected = true;
        break;
      }
    } catch {}
  }

  if (!connected) {
    child.kill('SIGKILL');
    throw new Error('Could not connect to Electron remote debugging port within timeout');
  }

  console.log('Successfully connected to Electron debugging port!\n');

  try {
    let targets = await getCdpTargets();

    // Check for profile picker
    const pickerTarget = targets.find(t => t.url.includes('profile-picker.html'));
    if (pickerTarget) {
      console.log('Profile Picker window detected. Selecting default profile...');
      const cdpPicker = new CdpConnection(pickerTarget.webSocketDebuggerUrl);
      await cdpPicker.connect();
      await cdpPicker.evaluate(`window.thaawAPI.selectProfileAndLaunch('default')`);
      cdpPicker.close();
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        targets = await getCdpTargets();
        if (targets.some(t => t.url.includes('ui/index.html')) && targets.some(t => t.url.includes('newtab'))) {
          break;
        }
      }
    }

    // Locate Window A shell and tab
    const shellA = targets.find(t => t.url.includes('ui/index.html'));
    if (!shellA) throw new Error('Could not find Window A shell');
    const cdpShellA = new CdpConnection(shellA.webSocketDebuggerUrl);
    await cdpShellA.connect();

    let newTabA = targets.find(t => t.url.includes('newtab'));
    if (!newTabA) {
      // Create new tab or wait
      await sleep(1000);
      targets = await getCdpTargets();
      newTabA = targets.find(t => t.url.includes('newtab'));
    }
    if (!newTabA) throw new Error('Could not find Window A newtab page');
    let cdpTabA = new CdpConnection(newTabA.webSocketDebuggerUrl);
    await cdpTabA.connect();

    for (let i = 0; i < 30; i++) {
      try {
        const ready = await cdpTabA.evaluate(`Boolean(window.thaawAPI && window.thaawAPI.setWallpaper)`);
        if (ready) break;
      } catch (_) {}
      await sleep(300);
    }

    // =========================================================================
    // Test A: Basic theme switching
    // =========================================================================
    console.log('--- TEST A: Basic Theme Switching ---');
    const customWp = 'aurora-borealis';
    console.log(`Applying wallpaper: "${customWp}"...`);
    await cdpTabA.evaluate(`window.thaawAPI.setWallpaper('${customWp}')`);
    await sleep(400);

    let activeWp = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
    expectEqual(activeWp, customWp, 'Initial wallpaper applied');

    const themesToTest = [
      { theme: 'light', preset: 'white' },
      { theme: 'dark', preset: 'deep-space' },
      { theme: 'light', preset: 'frost' },
      { theme: 'dark', preset: 'obsidian' },
      { theme: 'light', preset: 'pearl' },
      { theme: 'dark', preset: 'eclipse' },
      { theme: 'light', preset: 'cloud' },
      { theme: 'dark', preset: 'midnight' }
    ];

    for (const t of themesToTest) {
      console.log(`Switching theme to ${t.theme} (${t.preset})...`);
      await cdpTabA.evaluate(`window.thaawAPI.setTheme('${t.theme}', '${t.preset}')`);
      await sleep(300);

      const currentWp = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
      expectEqual(currentWp, customWp, `Wallpaper remains "${customWp}" after switching to ${t.theme} (${t.preset})`);

      // Check shell background layer retains custom wallpaper and does not have .default-bg
      const layerInfo = await cdpShellA.evaluate(`(() => {
        const layer = document.getElementById('chromeWallpaperLayer');
        return {
          bgImage: layer ? layer.style.backgroundImage : '',
          className: layer ? layer.className : '',
          opacity: layer ? window.getComputedStyle(layer).opacity : ''
        };
      })()`);
      
      if (!layerInfo.bgImage.includes('aurora-borealis')) {
        throw new Error(`TEST A FAILED: Shell background layer did not contain custom wallpaper. Got: ${layerInfo.bgImage}`);
      }
      if (layerInfo.className.includes('default-bg')) {
        throw new Error(`TEST A FAILED: Shell background layer unexpectedly retained "default-bg" class.`);
      }
    }
    console.log('✓ TEST A PASSED: Custom wallpaper remained unchanged through all theme switches.\n');

    // =========================================================================
    // Test B: Persistence
    // =========================================================================
    console.log('--- TEST B: Persistence Across Navigation and Reload ---');
    console.log('Reloading New Tab page...');
    await cdpTabA.evaluate(`window.location.reload()`);
    await sleep(1500);

    cdpTabA.close();
    targets = await getCdpTargets();
    const reloadedTab = targets.find(t => t.id === newTabA.id) || targets.find(t => t.url.includes('newtab'));
    cdpTabA = new CdpConnection(reloadedTab.webSocketDebuggerUrl);
    await cdpTabA.connect();

    const wpAfterReload = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
    expectEqual(wpAfterReload, customWp, 'Wallpaper after reload');
    console.log('✓ TEST B PASSED: Custom wallpaper persisted after reload.\n');

    // =========================================================================
    // Test C: Profile isolation
    // =========================================================================
    console.log('--- TEST C: Profile Isolation ---');
    const createdProfile = await cdpTabA.evaluate(`window.thaawAPI.createProfile('Isolated Test Profile')`);
    console.log(`Created second profile: ${createdProfile.name} (${createdProfile.id})`);

    await cdpTabA.evaluate(`window.thaawAPI.updateBrowserProfileSettings('${createdProfile.id}', { wallpaper: 'matrix', theme: 'dark', themePreset: 'obsidian' })`);
    await sleep(400);

    // Verify Profile A is still aurora-borealis
    const profileAWall = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
    expectEqual(profileAWall, customWp, 'Profile A wallpaper remains unaffected');

    // Switch themes in Profile A to light white
    await cdpTabA.evaluate(`window.thaawAPI.setTheme('light', 'white')`);
    await sleep(300);

    // Verify Profile A is still aurora-borealis
    const profileAWallAfterTheme = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
    expectEqual(profileAWallAfterTheme, customWp, 'Profile A wallpaper after theme switch');

    console.log('✓ TEST C PASSED: Profile isolation preserved between profiles.\n');

    // =========================================================================
    // Test D: Default backgrounds
    // =========================================================================
    console.log('--- TEST D: Default Backgrounds When No Custom Wallpaper Active ---');
    console.log('Resetting wallpaper to "default"...');
    await cdpTabA.evaluate(`window.thaawAPI.setWallpaper('default')`);
    await sleep(400);

    const defaultWpVal = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
    expectEqual(defaultWpVal, 'default', 'Wallpaper value is default');

    // Switch to dark midnight
    await cdpTabA.evaluate(`window.thaawAPI.setTheme('dark', 'midnight')`);
    await sleep(300);

    let shellBgDark = await cdpShellA.evaluate(`(() => {
      const layer = document.getElementById('chromeWallpaperLayer');
      return {
        bgImage: layer ? layer.style.backgroundImage : '',
        hasDefaultBg: layer ? layer.classList.contains('default-bg') : false
      };
    })()`);
    if (!shellBgDark.bgImage.includes('midnight-mountains') && !shellBgDark.hasDefaultBg) {
      throw new Error(`TEST D FAILED: Dark theme default background missing. Got: ${JSON.stringify(shellBgDark)}`);
    }

    // Switch to light white
    await cdpTabA.evaluate(`window.thaawAPI.setTheme('light', 'white')`);
    await sleep(300);

    let shellBgLight = await cdpShellA.evaluate(`(() => {
      const layer = document.getElementById('chromeWallpaperLayer');
      return {
        bgImage: layer ? layer.style.backgroundImage : '',
        hasDefaultBg: layer ? layer.classList.contains('default-bg') : false
      };
    })()`);
    if (!shellBgLight.bgImage.includes('light-13') && !shellBgLight.hasDefaultBg) {
      throw new Error(`TEST D FAILED: Light theme default background missing. Got: ${JSON.stringify(shellBgLight)}`);
    }

    console.log('✓ TEST D PASSED: Default background properly adapts to theme when no custom wallpaper is set.\n');

    // =========================================================================
    // Test E: Multiple windows
    // =========================================================================
    console.log('--- TEST E: Multiple Windows Synchronization ---');
    await cdpTabA.evaluate(`window.thaawAPI.setWallpaper('cyberpunk-city')`);
    await sleep(400);

    console.log('Spawning Window B...');
    await cdpShellA.evaluate(`window.thaawAPI.executeCommand('new-window')`);

    let newTabB = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      targets = await getCdpTargets();
      const allTabs = targets.filter(t => t.url.includes('newtab'));
      if (allTabs.length >= 2) {
        newTabB = allTabs.find(t => t.id !== newTabA.id);
        if (newTabB) break;
      }
    }

    if (!newTabB) throw new Error('Failed to detect Window B newtab page');
    const cdpTabB = new CdpConnection(newTabB.webSocketDebuggerUrl);
    await cdpTabB.connect();

    const winBWall = await cdpTabB.evaluate(`window.thaawAPI.getWallpaper()`);
    expectEqual(winBWall, 'cyberpunk-city', 'Window B initial wallpaper');

    // Switch theme in Window B to dark deep-space
    console.log('Switching theme to dark deep-space in Window B...');
    await cdpTabB.evaluate(`window.thaawAPI.setTheme('dark', 'deep-space')`);
    await sleep(500);

    const winAWallAfter = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
    const winBWallAfter = await cdpTabB.evaluate(`window.thaawAPI.getWallpaper()`);

    expectEqual(winAWallAfter, 'cyberpunk-city', 'Window A retains wallpaper after Window B theme switch');
    expectEqual(winBWallAfter, 'cyberpunk-city', 'Window B retains wallpaper after Window B theme switch');

    cdpTabB.close();
    console.log('✓ TEST E PASSED: Multi-window wallpaper and theme consistency verified.\n');

    // =========================================================================
    // Test F: CSS and rendering
    // =========================================================================
    console.log('--- TEST F: CSS and Background Stacking Inspection ---');
    const renderInspection = await cdpTabA.evaluate(`(() => {
      const htmlStyle = window.getComputedStyle(document.documentElement);
      const bodyStyle = window.getComputedStyle(document.body);
      const container = document.getElementById('wallpaperContainer');
      const containerDisplay = container ? window.getComputedStyle(container).display : '';
      return {
        htmlBg: htmlStyle.backgroundColor,
        bodyBg: bodyStyle.backgroundColor,
        containerDisplay
      };
    })()`);

    console.log('Render inspection in Tab A:', renderInspection);
    if (renderInspection.htmlBg !== 'rgba(0, 0, 0, 0)' && renderInspection.htmlBg !== 'transparent') {
      throw new Error(`TEST F FAILED: html background is not transparent! Got: ${renderInspection.htmlBg}`);
    }
    if (renderInspection.bodyBg !== 'rgba(0, 0, 0, 0)' && renderInspection.bodyBg !== 'transparent') {
      throw new Error(`TEST F FAILED: body background is not transparent! Got: ${renderInspection.bodyBg}`);
    }
    if (renderInspection.containerDisplay !== 'none') {
      throw new Error(`TEST F FAILED: wallpaperContainer in tab is not display: none! Got: ${renderInspection.containerDisplay}`);
    }

    console.log('✓ TEST F PASSED: New Tab page is completely transparent allowing custom wallpaper to render without occlusion.\n');

    cdpShellA.close();
    cdpTabA.close();

    console.log('==================================================================');
    console.log('ALL 6 E2E REGRESSION SCENARIOS (A, B, C, D, E, F) PASSED WITH 100% SUCCESS!');
    console.log('==================================================================');
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    try { child.kill('SIGKILL'); } catch {}
  }
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED (${message}): Expected "${expected}", but got "${actual}"`);
  }
}

run().catch((err) => {
  console.error('\n❌ E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
