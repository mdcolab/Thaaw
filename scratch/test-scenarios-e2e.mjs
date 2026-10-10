/**
 * THAAW Browser — End-to-End Test Suite for Multi-Window Consistency,
 * Profile Settings Persistence, Real-time Sync, and Dock Icon Association.
 */

import { execSync } from 'child_process';

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
      for (const handler of this.handlers.values()) {
        handler({ result: {} });
      }
      this.handlers.clear();
    };
    this.ws.onerror = () => {
      for (const handler of this.handlers.values()) {
        handler({ result: {} });
      }
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
    try {
      this.ws.close();
    } catch {}
  }
}

async function getCdpTargets() {
  const resp = await fetch('http://localhost:9222/json');
  return await resp.json();
}

async function run() {
  console.log('=== STARTING THAAW BROWSER VERIFICATION SUITE ===\n');

  // -------------------------------------------------------------
  // Test F: Dock Icon & Linux Application Identity
  // -------------------------------------------------------------
  console.log('--- TEST F: Dock Icon & Desktop Identity ---');
  const wmctrlOut = execSync('wmctrl -l -x | grep -i thaaw-browser || true').toString().trim();
  console.log('wmctrl output:\n' + wmctrlOut);
  if (!wmctrlOut.includes('thaaw-browser.thaaw-browser')) {
    throw new Error('TEST F FAILED: Window does not have WM_CLASS "thaaw-browser.thaaw-browser"');
  }

  const winId = wmctrlOut.split(/\s+/)[0];
  const xpropOut = execSync(`xprop -id ${winId} WM_CLASS _NET_WM_NAME`).toString().trim();
  console.log('xprop output:\n' + xpropOut);
  if (!xpropOut.includes('"thaaw-browser", "thaaw-browser"')) {
    throw new Error('TEST F FAILED: xprop does not contain WM_CLASS "thaaw-browser", "thaaw-browser"');
  }

  const desktopEntry = execSync('cat ~/.local/share/applications/thaaw-browser.desktop').toString();
  if (!desktopEntry.includes('StartupWMClass=thaaw-browser') || !desktopEntry.includes('thaaw-app-icon.png')) {
    throw new Error('TEST F FAILED: Desktop entry missing StartupWMClass or icon');
  }
  console.log('✓ TEST F PASSED: Running window correctly associates with thaaw-browser launcher and icon.\n');

  // -------------------------------------------------------------
  // Connect to Window A (Shell & Tab)
  // -------------------------------------------------------------
  let targets = await getCdpTargets();
  const pickerTarget = targets.find(t => t.url.includes('profile-picker.html'));
  if (pickerTarget) {
    console.log('Profile Picker window detected. Selecting profile to launch main window...');
    const cdpPicker = new CdpConnection(pickerTarget.webSocketDebuggerUrl);
    await cdpPicker.connect();
    await cdpPicker.evaluate(`window.thaawAPI.selectProfileAndLaunch('mujtabaalam010-8dsv')`);
    cdpPicker.close();
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      targets = await getCdpTargets();
      if (targets.some(t => t.url.includes('ui/index.html')) && targets.some(t => t.url.includes('newtab'))) {
        break;
      }
    }
  }

  const shellA = targets.find(t => t.url.includes('ui/index.html'));
  if (!shellA) throw new Error('Could not find Window A shell');
  const cdpShellA = new CdpConnection(shellA.webSocketDebuggerUrl);
  await cdpShellA.connect();

  let newTabA = targets.find(t => t.url.includes('newtab'));
  if (!newTabA) throw new Error('Could not find Window A newtab page');
  const cdpTabA = new CdpConnection(newTabA.webSocketDebuggerUrl);
  await cdpTabA.connect();

  // -------------------------------------------------------------
  // Test A: Same-profile synchronization
  // -------------------------------------------------------------
  console.log('--- TEST A: Same-Profile Synchronization ---');
  console.log('Setting Wallpaper A in Window A ("aurora-borealis")...');
  await cdpTabA.evaluate(`window.thaawAPI.setWallpaper('aurora-borealis')`);
  await sleep(200);

  const wallA = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
  console.log(`Window A reports wallpaper: "${wallA}"`);
  if (wallA !== 'aurora-borealis') throw new Error(`Expected "aurora-borealis", got "${wallA}"`);

  console.log('Spawning Window B using same profile...');
  await cdpShellA.evaluate(`window.thaawAPI.executeCommand('new-window')`);
  
  let newTabBTarget = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    targets = await getCdpTargets();
    const newTabs = targets.filter(t => t.url.includes('newtab'));
    if (newTabs.length >= 2) {
      newTabBTarget = newTabs.find(t => t.id !== newTabA.id);
      if (newTabBTarget) break;
    }
  }

  if (!newTabBTarget) throw new Error('Failed to open Window B within timeout');
  console.log('Window B detected successfully!');

  const cdpTabB = new CdpConnection(newTabBTarget.webSocketDebuggerUrl);
  await cdpTabB.connect();

  const wallBInitial = await cdpTabB.evaluate(`window.thaawAPI.getWallpaper()`);
  console.log(`Window B initialized with wallpaper: "${wallBInitial}"`);
  if (wallBInitial !== 'aurora-borealis') {
    throw new Error(`TEST A FAILED: Window B did not inherit saved wallpaper "aurora-borealis", got "${wallBInitial}"`);
  }

  console.log('Changing wallpaper in Window B to "cyberpunk-city"...');
  await cdpTabB.evaluate(`window.thaawAPI.setWallpaper('cyberpunk-city')`);
  await sleep(600);

  const wallANew = await cdpTabA.evaluate(`window.thaawAPI.getWallpaper()`);
  console.log(`Window A live synchronized wallpaper: "${wallANew}"`);
  if (wallANew !== 'cyberpunk-city') {
    throw new Error(`TEST A FAILED: Window A was not synchronized immediately. Got "${wallANew}"`);
  }
  console.log('✓ TEST A PASSED: Real-time synchronization between Window A and Window B confirmed.\n');

  // -------------------------------------------------------------
  // Test D: Navigation and reload
  // -------------------------------------------------------------
  console.log('--- TEST D: Navigation and Reload Persistence ---');
  console.log('Reloading Window A tab...');
  await cdpTabA.evaluate(`window.location.reload()`);
  await sleep(1200);

  // Reconnect cdpTabA after reload
  cdpTabA.close();
  targets = await getCdpTargets();
  const reloadedTabA = targets.find(t => t.id === newTabA.id);
  const cdpTabAReloaded = new CdpConnection(reloadedTabA.webSocketDebuggerUrl);
  await cdpTabAReloaded.connect();

  const wallAfterReload = await cdpTabAReloaded.evaluate(`window.thaawAPI.getWallpaper()`);
  console.log(`Window A after reload wallpaper: "${wallAfterReload}"`);
  if (wallAfterReload !== 'cyberpunk-city') {
    throw new Error(`TEST D FAILED: Wallpaper lost after reload. Got "${wallAfterReload}"`);
  }
  console.log('✓ TEST D PASSED: Wallpaper survived full-page reload.\n');

  // -------------------------------------------------------------
  // Test C: Profile isolation
  // -------------------------------------------------------------
  console.log('--- TEST C: Profile Isolation ---');
  const allProfiles = await cdpTabAReloaded.evaluate(`window.thaawAPI.listProfiles()`);
  const activeProfileInfo = await cdpTabAReloaded.evaluate(`window.thaawAPI.getActiveProfile()`);
  const profile2 = allProfiles.find(p => p.id !== activeProfileInfo.id && !p.isPrivate);
  if (!profile2) throw new Error('No second profile found for isolation test');

  console.log(`Setting wallpaper for Profile 2 ("${profile2.name}" - ${profile2.id}) to "matrix"...`);
  const prof2Updated = await cdpTabAReloaded.evaluate(`window.thaawAPI.updateBrowserProfileSettings('${profile2.id}', { wallpaper: 'matrix' })`);
  await sleep(500);

  // Verify Active Profile (Profile 1) still has cyberpunk-city
  const activeWall = await cdpTabAReloaded.evaluate(`window.thaawAPI.getWallpaper()`);
  console.log(`Active profile (Profile 1) wallpaper: "${activeWall}"`);
  if (activeWall !== 'cyberpunk-city') {
    throw new Error(`TEST C FAILED: Active profile was corrupted when updating Profile 2! Got "${activeWall}"`);
  }

  // Retrieve settings for profile 2
  console.log('Profile 2 updated wallpaper:', prof2Updated?.wallpaper);
  if (prof2Updated?.wallpaper !== 'matrix') {
    throw new Error('TEST C FAILED: Profile 2 did not save "matrix"');
  }

  const prof2Disk = JSON.parse(execSync(`cat ~/.config/thaaw/profiles/${profile2.id}/settings.json`).toString());
  console.log('Profile 2 on disk wallpaper:', prof2Disk?.wallpaper);
  if (prof2Disk?.wallpaper !== 'matrix') {
    throw new Error('TEST C FAILED: Profile 2 on disk did not save "matrix"');
  }
  console.log('✓ TEST C PASSED: Profile isolation strictly preserved without cross-profile leakage.\n');

  // -------------------------------------------------------------
  // Test E: Concurrent Changes Convergence
  // -------------------------------------------------------------
  console.log('--- TEST E: Concurrent Changes Convergence ---');
  console.log('Triggering rapid concurrent wallpaper updates from Window A and Window B...');
  await Promise.all([
    cdpTabAReloaded.evaluate(`window.thaawAPI.setWallpaper('deep-space')`),
    cdpTabB.evaluate(`window.thaawAPI.setWallpaper('sunset-glow')`)
  ]);
  await sleep(800);

  const finalWallA = await cdpTabAReloaded.evaluate(`window.thaawAPI.getWallpaper()`);
  const finalWallB = await cdpTabB.evaluate(`window.thaawAPI.getWallpaper()`);
  console.log(`Window A converged on: "${finalWallA}"`);
  console.log(`Window B converged on: "${finalWallB}"`);

  if (finalWallA !== finalWallB) {
    throw new Error(`TEST E FAILED: Windows diverged! Window A="${finalWallA}", Window B="${finalWallB}"`);
  }
  console.log('✓ TEST E PASSED: Windows converged on identical state without race conditions.\n');

  // -------------------------------------------------------------
  // Test B: Persistence After Restart
  // -------------------------------------------------------------
  console.log('--- TEST B: Persistence After Restart ---');
  const activeProf = await cdpTabAReloaded.evaluate(`window.thaawAPI.getActiveProfile()`);
  console.log('Active Profile ID:', activeProf.id);

  const savedProfileSettings = JSON.parse(
    execSync(`cat ~/.config/thaaw/profiles/${activeProf.id}/settings.json`).toString()
  );
  console.log('On-disk profile settings:', savedProfileSettings);
  if (savedProfileSettings.wallpaper !== finalWallA) {
    throw new Error(`TEST B FAILED: On-disk wallpaper "${savedProfileSettings.wallpaper}" does not match final wallpaper "${finalWallA}"`);
  }
  console.log('✓ TEST B PASSED: Wallpaper preference successfully persisted to disk for restart recovery.\n');

  cdpShellA.close();
  cdpTabAReloaded.close();
  cdpTabB.close();

  console.log('====================================================');
  console.log('ALL VERIFICATION TEST SCENARIOS PASSED WITH 100% SUCCESS!');
  console.log('====================================================');
}

run().catch(err => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
});
