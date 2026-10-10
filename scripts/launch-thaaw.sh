#!/usr/bin/env bash
# ==============================================================================
# THAAW Browser — One-Click Native Desktop Launcher
# ==============================================================================
# Launches the THAAW Browser Electron desktop application window directly.
# Resolves environment variables, ensures correct working directory, prevents
# accidental window-focus collisions with coding agents or IDEs, and logs output.
# ==============================================================================

set -o pipefail

PROJECT_DIR="/home/mujtaba/Desktop/Thaaw"
LOG_DIR="$HOME/.config/thaaw-browser"
LOG_FILE="$LOG_DIR/launcher.log"
ICON_FILE="$PROJECT_DIR/assets/icons/thaaw-app-icon.png"

mkdir -p "$LOG_DIR" 2>/dev/null || true

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg" >> "$LOG_FILE"
}

show_error() {
    local title="THAAW Browser — Startup Failed"
    local message="$*"
    log "ERROR: $message"
    
    if command -v zenity >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
        zenity --error --title="$title" --text="$message\n\nLog: $LOG_FILE" --width=450 2>/dev/null &
    elif command -v notify-send >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
        notify-send -u critical "$title" "$message" 2>/dev/null
    fi
}

log "=== THAAW Launcher Invocation: $* ==="

# 1. Environment initialization (Desktop GUI sessions do not load ~/.bashrc)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    for node_dir in "$NVM_DIR"/versions/node/*/bin; do
        if [ -d "$node_dir" ]; then
            export PATH="$node_dir:$PATH"
            break
        fi
    done
fi
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
export DISPLAY="${DISPLAY:-:0}"

# 2. Validate Project Directory
if [ ! -d "$PROJECT_DIR" ]; then
    show_error "THAAW project directory not found at $PROJECT_DIR"
    exit 1
fi

cd "$PROJECT_DIR" || {
    show_error "Failed to enter directory: $PROJECT_DIR"
    exit 1
}

# 3. Diagnostic check support
for arg in "$@"; do
    if [ "$arg" = "--check" ] || [ "$arg" = "--dry-run" ]; then
        log "Diagnostic verification passed successfully."
        echo "DIAGNOSTIC_OK"
        exit 0
    fi
done

# 4. Handle Duplicate Instances — Target ONLY the real THAAW window
FORCE_NEW=0
REBUILD=0
FORWARD_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --new-instance|--force|-f)
            FORCE_NEW=1
            ;;
        --build|--rebuild)
            REBUILD=1
            ;;
        *)
            FORWARD_ARGS+=("$arg")
            ;;
    esac
done

if [ "$FORCE_NEW" -eq 0 ] && command -v wmctrl >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    # Strictly filter by window class 'thaaw-browser.thaaw-browser' (column 3)
    # NEVER use fuzzy substring title matching (e.g. 'THAAW'), which collides with
    # open coding agents, editors, or terminals referencing the project folder!
    EXISTING_THAAW_WIN=$(wmctrl -l -x 2>/dev/null | awk '$3 ~ /^thaaw-browser\./ {print $1}' | head -n 1)
    if [ -n "$EXISTING_THAAW_WIN" ]; then
        log "Existing THAAW Browser window ($EXISTING_THAAW_WIN) detected. Bringing to front."
        wmctrl -i -a "$EXISTING_THAAW_WIN"
        if command -v notify-send >/dev/null 2>&1; then
            notify-send -i "$ICON_FILE" "THAAW Browser" "Brought active browser window to front." 2>/dev/null || true
        fi
        exit 0
    fi
fi

# 5. Ensure Application Assets and Build Exist
if [ "$REBUILD" -eq 1 ] || [ ! -f "$PROJECT_DIR/dist/browser/main/index.js" ]; then
    log "Building THAAW Browser TypeScript bundle..."
    npm run build >> "$LOG_FILE" 2>&1
    BUILD_STATUS=$?
    if [ $BUILD_STATUS -ne 0 ]; then
        show_error "Build failed with code $BUILD_STATUS. See $LOG_FILE for details."
        exit $BUILD_STATUS
    fi
fi

# 6. Locate Electron Runtime
ELECTRON_EXEC="$PROJECT_DIR/node_modules/.bin/electron"
if [ ! -x "$ELECTRON_EXEC" ]; then
    if command -v electron >/dev/null 2>&1; then
        ELECTRON_EXEC="electron"
    elif command -v npx >/dev/null 2>&1; then
        ELECTRON_EXEC="npx electron"
    else
        show_error "Electron runtime not found in node_modules or system PATH."
        exit 1
    fi
fi

# 7. Launch THAAW Browser Application Window
# Replaces the shell process with the native Electron application directly.
# Does NOT open a terminal window, IDE, or coding agent.
log "Executing THAAW Electron application ($ELECTRON_EXEC .)..."

exec $ELECTRON_EXEC . "${FORWARD_ARGS[@]}" >> "$LOG_FILE" 2>&1
