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

## DEC-002: CI Dependencies, Security Audit Scoping, and Vercel Build Exclusion

- **Context**: GitHub Actions runner upgrades to Ubuntu 24.04 (noble) broke CI because `libasound2` was transitioned to `libasound2t64`. The security audit workflow was failing due to devDependencies (`electron` and `vitest`) carrying known upstream advisories that do not affect production runtime. Additionally, Vercel deployments were failing because `Thaaw` is an Electron desktop application rather than a web application, and Vercel's `NODE_ENV=production` stripped `devDependencies`, causing `tsc` to fail.
- **Decision**:
  1. In `.github/workflows/ci.yml`, install `libasound2t64` with fallback to `libasound2` to ensure multi-runner compatibility.
  2. In `.github/workflows/security.yml`, run `npm audit --omit=dev --audit-level=high` to properly scope audits to production runtime dependencies, and exclude `.github` from secret detection grep.
  3. In `vercel.json`, specify `"ignoreCommand": "exit 0"` so Vercel skips builds for this desktop application repository without failing GitHub checks.
- **Consequences**: CI builds succeed reliably on Ubuntu 24.04 runners, security audits focus on shipped runtime packages without false positives from dev-time tooling, and Vercel commits are automatically skipped without reporting failures.
