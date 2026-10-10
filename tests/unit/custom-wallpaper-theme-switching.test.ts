/**
 * THAAW Browser — Regression Tests: Custom Wallpaper Disappearing on Theme Switch
 *
 * Verifies that switching themes never replaces, resets, or removes a user's custom wallpaper:
 * - Test A: Basic theme switching across all 8 presets (4 dark + 4 light)
 * - Test B: Persistence across multiple theme switches, reloads, and restarts
 * - Test C: Profile isolation between profiles with different wallpapers
 * - Test D: Default backgrounds when no custom wallpaper is active
 * - Test E: Multi-window synchronization and consistency
 * - Test F: CSS & DOM rendering layer integrity
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileManager } from '../../browser/profiles/profile-manager';

describe('Custom Wallpaper Theme Switching Regression Suite', () => {
  const testBaseDir = '/tmp/test-thaaw-wallpaper-theme-switching';
  let profileManager: ProfileManager;

  const ALL_THEME_PRESETS = [
    { theme: 'dark', preset: 'midnight' },
    { theme: 'dark', preset: 'deep-space' },
    { theme: 'dark', preset: 'obsidian' },
    { theme: 'dark', preset: 'eclipse' },
    { theme: 'light', preset: 'white' },
    { theme: 'light', preset: 'frost' },
    { theme: 'light', preset: 'pearl' },
    { theme: 'light', preset: 'cloud' }
  ];

  beforeEach(() => {
    try {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    } catch {}
    profileManager = new ProfileManager(testBaseDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    } catch {}
  });

  // -------------------------------------------------------------
  // Test A: Basic theme switching
  // -------------------------------------------------------------
  describe('Test A — Basic theme switching', () => {
    it('preserves a custom uploaded wallpaper when switching to a different theme', () => {
      const customWallpaperUrl = 'thaaw://custom-wallpapers/custom-1718999999000.webp';
      profileManager.updateProfileSettings({ wallpaper: customWallpaperUrl }, 'default');

      // Switch theme to light
      profileManager.updateProfileSettings({ theme: 'light', themePreset: 'white' }, 'default');
      const settingsAfterLight = profileManager.getProfileSettings('default');
      expect(settingsAfterLight.theme).toBe('light');
      expect(settingsAfterLight.themePreset).toBe('white');
      expect(settingsAfterLight.wallpaper).toBe(customWallpaperUrl);
    });

    it('preserves the custom wallpaper when switching through every available theme preset', () => {
      const customWallpaperUrl = 'thaaw://custom-wallpapers/neon-aurora.png';
      profileManager.updateProfileSettings({ wallpaper: customWallpaperUrl }, 'default');

      for (const t of ALL_THEME_PRESETS) {
        profileManager.updateProfileSettings({ theme: t.theme, themePreset: t.preset }, 'default');
        const current = profileManager.getProfileSettings('default');
        expect(current.theme).toBe(t.theme);
        expect(current.themePreset).toBe(t.preset);
        expect(current.wallpaper).toBe(customWallpaperUrl);
      }
    });

    it('preserves a curated gallery wallpaper when switching through themes', () => {
      const galleryWallpaper = 'aurora-borealis';
      profileManager.updateProfileSettings({ wallpaper: galleryWallpaper }, 'default');

      for (const t of ALL_THEME_PRESETS) {
        profileManager.updateProfileSettings({ theme: t.theme, themePreset: t.preset }, 'default');
        const current = profileManager.getProfileSettings('default');
        expect(current.wallpaper).toBe(galleryWallpaper);
      }
    });
  });

  // -------------------------------------------------------------
  // Test B: Persistence
  // -------------------------------------------------------------
  describe('Test B — Persistence', () => {
    it('retains custom wallpaper on disk after multiple theme switches and application restart', () => {
      const customWallpaper = 'thaaw://custom-wallpapers/custom-space-nebula.jpg';
      profileManager.updateProfileSettings({ wallpaper: customWallpaper }, 'default');

      // Rapidly switch themes back and forth
      const switches = [
        { theme: 'light', preset: 'white' },
        { theme: 'dark', preset: 'obsidian' },
        { theme: 'light', preset: 'frost' },
        { theme: 'dark', preset: 'deep-space' },
        { theme: 'light', preset: 'pearl' },
        { theme: 'dark', preset: 'eclipse' }
      ];

      for (const s of switches) {
        profileManager.updateProfileSettings({ theme: s.theme, themePreset: s.preset }, 'default');
      }

      // Check raw JSON file on disk
      const profDir = profileManager.getProfileDir('default');
      const diskSettings = JSON.parse(fs.readFileSync(path.join(profDir, 'settings.json'), 'utf8'));
      expect(diskSettings.wallpaper).toBe(customWallpaper);
      expect(diskSettings.theme).toBe('dark');
      expect(diskSettings.themePreset).toBe('eclipse');

      // Simulate full application restart by initializing a brand new ProfileManager instance
      const restartedManager = new ProfileManager(testBaseDir);
      const restored = restartedManager.getProfileSettings('default');
      expect(restored.wallpaper).toBe(customWallpaper);
      expect(restored.theme).toBe('dark');
      expect(restored.themePreset).toBe('eclipse');
    });
  });

  // -------------------------------------------------------------
  // Test C: Profile isolation
  // -------------------------------------------------------------
  describe('Test C — Profile isolation', () => {
    it('isolates custom wallpapers and theme choices between independent profiles', () => {
      const profB = profileManager.createProfile('Work Profile', '#10B981');

      const wallpaperA = 'thaaw://custom-wallpapers/profile-a-wallpaper.webp';
      const wallpaperB = 'thaaw://custom-wallpapers/profile-b-wallpaper.webp';

      profileManager.updateProfileSettings({ wallpaper: wallpaperA, theme: 'dark', themePreset: 'midnight' }, 'default');
      profileManager.updateProfileSettings({ wallpaper: wallpaperB, theme: 'light', themePreset: 'pearl' }, profB.id);

      // Switch themes in Profile A through all dark and light themes
      for (const t of ALL_THEME_PRESETS) {
        profileManager.updateProfileSettings({ theme: t.theme, themePreset: t.preset }, 'default');
      }

      // Verify Profile A wallpaper remains wallpaperA
      const settingsA = profileManager.getProfileSettings('default');
      expect(settingsA.wallpaper).toBe(wallpaperA);

      // Verify Profile B wallpaper remains completely intact and unaffected
      const settingsB = profileManager.getProfileSettings(profB.id);
      expect(settingsB.wallpaper).toBe(wallpaperB);
      expect(settingsB.theme).toBe('light');
      expect(settingsB.themePreset).toBe('pearl');
    });
  });

  // -------------------------------------------------------------
  // Test D: Default backgrounds
  // -------------------------------------------------------------
  describe('Test D — Default backgrounds', () => {
    it('preserves default wallpaper state when switching themes, allowing theme-default backgrounds to change', () => {
      // Profile without a custom wallpaper has wallpaper: 'default'
      const initial = profileManager.getProfileSettings('default');
      expect(initial.wallpaper).toBe('default');

      // Switching theme must keep wallpaper as 'default' rather than locking in a specific wallpaper id
      for (const t of ALL_THEME_PRESETS) {
        profileManager.updateProfileSettings({ theme: t.theme, themePreset: t.preset }, 'default');
        const current = profileManager.getProfileSettings('default');
        expect(current.wallpaper).toBe('default');
      }
    });
  });

  // -------------------------------------------------------------
  // Test E: Multiple windows
  // -------------------------------------------------------------
  describe('Test E — Multiple windows', () => {
    it('ensures two windows using the same profile share theme and retain custom wallpaper', () => {
      const customWallpaper = 'thaaw://custom-wallpapers/multi-window-wp.webp';

      // Window 1 applies custom wallpaper
      profileManager.updateProfileSettings({ wallpaper: customWallpaper }, 'default');

      // Window 2 reads the settings
      const win2InitialSettings = profileManager.getProfileSettings('default');
      expect(win2InitialSettings.wallpaper).toBe(customWallpaper);

      // Window 2 switches theme to light frost
      profileManager.updateProfileSettings({ theme: 'light', themePreset: 'frost' }, 'default');

      // Both windows inspect current profile settings
      const win1Read = profileManager.getProfileSettings('default');
      const win2Read = profileManager.getProfileSettings('default');

      expect(win1Read.wallpaper).toBe(customWallpaper);
      expect(win2Read.wallpaper).toBe(customWallpaper);
      expect(win1Read.theme).toBe('light');
      expect(win1Read.themePreset).toBe('frost');
      expect(win2Read.theme).toBe('light');
      expect(win2Read.themePreset).toBe('frost');
    });
  });

  // -------------------------------------------------------------
  // Test F: CSS and rendering
  // -------------------------------------------------------------
  describe('Test F — CSS and rendering inspection', () => {
    const rootDir = path.resolve(__dirname, '../../');

    it('verifies theme:set in main index.ts does not overwrite wallpaper or broadcast wallpaper updates', () => {
      const indexTs = fs.readFileSync(path.join(rootDir, 'browser/main/index.ts'), 'utf8');
      
      // Match the theme:set handler block
      const themeSetMatch = indexTs.match(/ipcMain\.handle\('theme:set',[\s\S]*?return \{ success: true, \.\.\.update \};/);
      expect(themeSetMatch).not.toBeNull();
      const themeSetCode = themeSetMatch![0];

      // Must not update wallpaper in profile settings
      expect(themeSetCode).not.toContain('wallpaper: newWallpaper');
      expect(themeSetCode).not.toContain('wallpaper = theme ===');
      // Must not broadcast wallpaper-updated on theme switch
      expect(themeSetCode).not.toContain("broadcastToProfile(profileId, 'browser:wallpaper-updated'");
    });

    it('verifies newtab.html apply method never overwrites active wallpaper during theme changes', () => {
      const newtabHtml = fs.readFileSync(path.join(rootDir, 'browser/internal-pages/newtab.html'), 'utf8');
      
      // Find ThemeEngine.apply method
      const applyIndex = newtabHtml.indexOf('apply(theme, preset');
      expect(applyIndex).toBeGreaterThan(-1);
      const selectPresetIndex = newtabHtml.indexOf('selectPreset(theme, preset');
      const applyBlock = newtabHtml.substring(applyIndex, selectPresetIndex > -1 ? selectPresetIndex : applyIndex + 2000);

      // Must NOT contain the old bug where activeWallpaper was replaced with light-13 or midnight-mountains
      expect(applyBlock).not.toContain("nextWp = this.theme === 'light' ? 'light-13' : 'midnight-mountains'");
      expect(applyBlock).not.toContain("this.setWallpaper(nextWp, true)");
      // Must directly apply existing active wallpaper
      expect(applyBlock).toContain("this.applyWallpaperToDOM(this.activeWallpaper)");
    });

    it('verifies internal.css ensures transparency so custom wallpaper remains visible on new tab page', () => {
      const internalCss = fs.readFileSync(path.join(rootDir, 'browser/internal-pages/internal.css'), 'utf8');
      
      expect(internalCss).toContain('html.inside-thaaw-chrome');
      expect(internalCss).toContain('body.inside-thaaw-chrome');
      expect(internalCss).toContain('background: transparent !important;');
      expect(internalCss).toContain('.newtab-wallpaper-container');
      expect(internalCss).toContain('display: none !important;');
    });

    it('verifies renderer.ts uses theme-adaptive tokens for background color and does not obscure active wallpaper', () => {
      const rendererTs = fs.readFileSync(path.join(rootDir, 'browser/ui/renderer.ts'), 'utf8');
      
      expect(rendererTs).toContain("layer.style.backgroundColor = 'var(--thaaw-bg)'");
      expect(rendererTs).toContain("layer.className = 'chrome-wallpaper-layer'");
      expect(rendererTs).toContain('resolveWallpaperTargetUrl');
    });
  });
});
