/**
 * THAAW Browser — Multi-Window & Profile Settings Persistence Tests
 * Verifies profile settings persistence, profile isolation, and multi-window consistency.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileManager } from '../../browser/profiles/profile-manager';

describe('Multi-Window Profile Settings & Wallpaper Persistence', () => {
  const testBaseDir = '/tmp/test-thaaw-multi-window-profiles';
  let profileManager: ProfileManager;

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

  describe('Wallpaper Persistence Across Windows & Restarts', () => {
    it('persists selected wallpaper under active profile and survives reload', () => {
      // 1. Initially default profile should have default settings
      const initial = profileManager.getProfileSettings('default');
      expect(initial.wallpaper).toBeDefined();

      // 2. Window A updates wallpaper to 'cyberpunk'
      const updated = profileManager.updateProfileSettings({ wallpaper: 'cyberpunk' }, 'default');
      expect(updated.wallpaper).toBe('cyberpunk');

      // 3. Window B opens under 'default' profile and reads saved wallpaper
      const windowBSettings = profileManager.getProfileSettings('default');
      expect(windowBSettings.wallpaper).toBe('cyberpunk');

      // 4. Application restarts: instantiate brand new ProfileManager pointing to disk
      const restartedManager = new ProfileManager(testBaseDir);
      const afterRestart = restartedManager.getProfileSettings('default');
      expect(afterRestart.wallpaper).toBe('cyberpunk');
    });

    it('isolates wallpaper preferences between different profiles', () => {
      // Create second profile
      const prof2 = profileManager.createProfile('Research Profile', '#10B981');

      // Set Wallpaper A for default profile
      profileManager.updateProfileSettings({ wallpaper: 'matrix' }, 'default');

      // Set Wallpaper B for second profile
      profileManager.updateProfileSettings({ wallpaper: 'sunset' }, prof2.id);

      // Verify Profile 1 has Wallpaper A
      expect(profileManager.getProfileSettings('default').wallpaper).toBe('matrix');

      // Verify Profile 2 has Wallpaper B
      expect(profileManager.getProfileSettings(prof2.id).wallpaper).toBe('sunset');

      // Mutate Profile 1 to 'deep-space'
      profileManager.updateProfileSettings({ wallpaper: 'deep-space' }, 'default');

      // Verify Profile 1 updated while Profile 2 remains unchanged
      expect(profileManager.getProfileSettings('default').wallpaper).toBe('deep-space');
      expect(profileManager.getProfileSettings(prof2.id).wallpaper).toBe('sunset');
    });
  });

  describe('Shortcuts & Pinned Sites Persistence Per Profile', () => {
    it('persists and isolates custom shortcuts per profile', () => {
      const shortcutsProf1 = [
        { id: '1', title: 'GitHub', url: 'https://github.com', icon: 'code', isCustom: true }
      ];
      const shortcutsProf2 = [
        { id: '2', title: 'ArXiv', url: 'https://arxiv.org', icon: 'book', isCustom: true }
      ];

      const prof2 = profileManager.createProfile('Academic', '#8B5CF6');

      profileManager.updateProfileSettings({ shortcuts: shortcutsProf1 }, 'default');
      profileManager.updateProfileSettings({ shortcuts: shortcutsProf2 }, prof2.id);

      expect(profileManager.getProfileSettings('default').shortcuts).toEqual(shortcutsProf1);
      expect(profileManager.getProfileSettings(prof2.id).shortcuts).toEqual(shortcutsProf2);
    });
  });

  describe('Search Engine & Theme Preferences Per Profile', () => {
    it('persists and isolates search engine and theme preferences', () => {
      const prof2 = profileManager.createProfile('Work', '#3B82F6');

      profileManager.updateProfileSettings({
        theme: 'dark',
        themePreset: 'midnight',
        defaultSearchEngine: 'duckduckgo'
      }, 'default');

      profileManager.updateProfileSettings({
        theme: 'light',
        themePreset: 'white',
        defaultSearchEngine: 'google'
      }, prof2.id);

      const p1Settings = profileManager.getProfileSettings('default');
      const p2Settings = profileManager.getProfileSettings(prof2.id);

      expect(p1Settings.theme).toBe('dark');
      expect(p1Settings.themePreset).toBe('midnight');
      expect(p1Settings.defaultSearchEngine).toBe('duckduckgo');

      expect(p2Settings.theme).toBe('light');
      expect(p2Settings.themePreset).toBe('white');
      expect(p2Settings.defaultSearchEngine).toBe('google');
    });
  });
});
