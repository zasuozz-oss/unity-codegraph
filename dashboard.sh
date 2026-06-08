#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# unity-codegraph — dashboard launcher (multi-project)
#
# Boots the dashboard for EVERY project registered in
# ~/.codegraph/projects.json (each `codegraph init` registers itself).
# Starts the API server + Vite dev server, then opens the browser to the
# project picker. Pick a project to view its graph; delete removes its
# .codegraph and unregisters it. Ctrl-C stops both servers.
#
#   ./dashboard.sh                 # serve all registered projects
#   ./dashboard.sh --no-open       # don't auto-open the browser
#
#   API_PORT=4319 WEB_PORT=5173 ./dashboard.sh   # override ports
#
# Cross-platform: macOS, Linux, Windows (Git Bash / MSYS2 / WSL).
# ══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; DIM='\033[2m'; NC='\033[0m'
info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}  ✓${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }
step() { echo -e "\n${CYAN}── $* ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"
API_PORT="${API_PORT:-4319}"
WEB_PORT="${WEB_PORT:-5173}"
REGISTRY="$HOME/.codegraph/projects.json"

# ── args ──
OPEN_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) warn "Ignoring unknown arg: $arg" ;;
  esac
done

# ── preflight ──
command -v node >/dev/null 2>&1 || { err "node not found on PATH"; exit 1; }
[ -d "$WEB_DIR" ] || { err "web/ not found at $WEB_DIR"; exit 1; }
if [ ! -f "$REGISTRY" ]; then
  warn "No registry at $REGISTRY — no projects indexed yet."
  warn "Index one:  codegraph init <path>   (or  codegraph unity init)"
fi

# ── deps ──
step "Dependencies"
if [ ! -d "$WEB_DIR/node_modules" ]; then
  info "Installing web deps (first run)…"
  # A past `sudo` run can leave root-owned files in the default npm cache (~/.npm),
  # which breaks `npm install` with EACCES. Route npm at a user-owned cache instead
  # (no sudo needed) — same workaround as setup.sh. Skipped when the cache is clean.
  # Windows has no sudo/root, and `find ! -user` over the npm cache is pathologically
  # slow on MSYS (Windows ACL → POSIX uid per file), so skip the scan there.
  FOREIGN_CACHE=0
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) if find "$(npm config get cache 2>/dev/null)" ! -user "$(id -un)" -print -quit 2>/dev/null | grep -q .; then FOREIGN_CACHE=1; fi ;;
  esac
  if [ "$FOREIGN_CACHE" = "1" ]; then
    export npm_config_cache="$SCRIPT_DIR/.npm-cache"
    mkdir -p "$npm_config_cache"
    warn "Default npm cache has root-owned files; using $npm_config_cache"
  fi
  ( cd "$WEB_DIR" && npm install --no-fund --no-audit )
  ok "Installed"
else
  ok "node_modules present"
fi

# ── launch ──
step "Launch"
SRV_PID=""
VITE_PID=""
cleanup() {
  echo
  info "Stopping…"
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true
  [ -n "$SRV_PID" ]  && kill "$SRV_PID"  2>/dev/null || true
  wait 2>/dev/null || true
  ok "Stopped"
}
trap cleanup INT TERM EXIT

info "API server  → http://localhost:${API_PORT}"
PORT="$API_PORT" node "$WEB_DIR/server/server.mjs" &
SRV_PID=$!

# wait for the API to answer before starting the UI
for _ in $(seq 1 30); do
  if node -e "fetch('http://localhost:${API_PORT}/api/projects').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  kill -0 "$SRV_PID" 2>/dev/null || { err "API server exited early"; exit 1; }
  sleep 0.3
done
ok "API ready"

info "Dashboard   → http://localhost:${WEB_PORT}"
( cd "$WEB_DIR" && API_PORT="$API_PORT" node node_modules/vite/bin/vite.js --port "$WEB_PORT" ) &
VITE_PID=$!

if [ "$OPEN_BROWSER" = "1" ]; then
  URL="http://localhost:${WEB_PORT}"
  sleep 2
  case "$(uname -s)" in
    Darwin) open "$URL" 2>/dev/null || true ;;
    Linux)  xdg-open "$URL" 2>/dev/null || true ;;
    MINGW*|MSYS*|CYGWIN*) start "" "$URL" 2>/dev/null || cmd.exe /c start "" "$URL" 2>/dev/null || true ;;
  esac
fi

echo -e "${GREEN}Dashboard running.${NC} ${DIM}Pick a project in the browser. Ctrl-C to stop.${NC}"
wait "$VITE_PID"
