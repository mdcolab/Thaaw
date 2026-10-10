# Technical Decisions

Record meaningful architectural decisions and their reasons. Do not log every code edit.

## DEC-001: Separation of Theme Preferences and Custom Wallpaper Preferences

- **Context**: Switching themes previously caused custom wallpapers to be overridden because `theme:set` in the main process checked whether the current wallpaper was light/dark and replaced it with a theme default wallpaper, persisting this override to `settings.json` and broadcasting a wallpaper update. Furthermore, `ThemeEngine.apply` in `newtab.html` conditionally reset `this.activeWallpaper` to default wallpapers on theme changes.
- **Decision**: Decouple theme preferences from wallpaper preferences completely:
  1. Theme changes (`theme:set`) only update `theme` and `themePreset`, preserving the existing `wallpaper` setting on disk and never broadcasting `browser:wallpaper-updated`.
  2. The custom wallpaper setting (`wallpaper`) remains independent and takes precedence over theme default backgrounds whenever a custom wallpaper or gallery wallpaper is active.
  3. When `wallpaper === 'default'`, the theme's default background adapts between light and dark themes dynamically.
  4. Chrome wallpaper transitions in `renderer.ts` finalize cleanly on interruptions and theme switches apply without transition delay or occlusion.
- **Consequences**: User custom wallpapers are preserved across unlimited theme switches, page reloads, app restarts, and across windows under the same profile, with strict profile isolation maintained.
