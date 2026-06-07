#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# unity-codegraph — one-shot setup
#
# Fetches upstream colbymchenry/codegraph into ./codegraph, applies the Unity
# overlay from custom/ (new files + patches — upstream is never edited by hand),
# removes nested Git metadata, builds the CLI, wires MCP into your agents, and
# installs the Unity skills.
#
#   ./setup.sh            full setup (first install or re-run)
#   ./setup.sh --update   delegate to ./update.sh (refresh upstream + re-apply)
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

run_with_timeout() {
  local seconds="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    node -e '
      const [seconds, cmd, ...args] = process.argv.slice(1);
      const child = require("child_process").spawn(cmd, args, { stdio: "inherit" });
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      }, Number(seconds) * 1000);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (killed || signal) {
          console.error(`Timed out after ${seconds}s: ${cmd} ${args.join(" ")}`);
          process.exit(124);
        }
        process.exit(code ?? 0);
      });
    ' "$seconds" "$@"
  fi
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
  Darwin) OS="macos" ;;
  Linux)  OS="linux" ;;
  *) OS="unknown" ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_SLUG="colbymchenry/codegraph"
UPSTREAM_REPO="https://github.com/${UPSTREAM_SLUG}.git"
UPSTREAM_DIR="$SCRIPT_DIR/codegraph"
CUSTOM_SKILLS_DIR="$SCRIPT_DIR/custom/skills"
CLI="$UPSTREAM_DIR/dist/bin/codegraph.js"

# ── No-sudo guards / self-heal helpers ───────────────────────
# This script must run as your normal user. Running it with sudo makes the clone
# and the npm global package root-owned, which breaks every later (non-sudo) run.
# guard_no_root prevents that; path_has_foreign_files detects an already-poisoned
# tree from a past sudo run so we can fail with clear guidance instead of cryptically.

guard_no_root() {
  if [ "$(id -u)" = "0" ]; then
    err "Do NOT run this script with sudo / as root."
    err "It writes to your user dirs (~/.claude, ~/.codex, npm global) and clones a repo;"
    err "running as root makes those files root-owned and breaks future runs."
    err "Re-run as your normal user:  ./setup.sh"
    exit 1
  fi
}

# True if any entry under $1 is NOT owned by the current user (e.g. left behind
# by an accidental `sudo ./setup.sh`). Root-owned dirs are world-readable, so
# `find` can still traverse them as us.
path_has_foreign_files() {
  [ -e "$1" ] || return 1
  [ -n "$(find "$1" ! -user "$(id -un)" -print -quit 2>/dev/null)" ]
}

# ── Prerequisites ────────────────────────────────────────────
check_prereqs() {
  step "Checking prerequisites"
  command -v git  >/dev/null || { err "git not found"; exit 1; }
  command -v node >/dev/null || { err "Node.js not found (need >=18 <25)"; exit 1; }
  command -v npm  >/dev/null || { err "npm not found"; exit 1; }
  local major; major="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$major" -lt 18 ] || [ "$major" -ge 25 ]; then
    err "Node 18–24 required (found $(node -v)); codegraph hard-exits on 25.x"; exit 1
  fi
  ok "node $(node -v), npm $(npm -v)"
}

# ── Fetch upstream into ./codegraph ──────────────────────────
fetch_upstream() {
  step "Fetching upstream codegraph"
  # A previous accidental `sudo ./setup.sh` can leave a root-owned clone we can't
  # build into or patch. On macOS only root can delete a root-owned directory, so
  # we can't auto-fix it — but we refuse to limp on with a cryptic failure later.
  # Clear it ONCE with the command below; guard_no_root keeps it from recurring.
  if path_has_foreign_files "$UPSTREAM_DIR"; then
    err "Clone at $UPSTREAM_DIR has files not owned by $(id -un) — leftover from an"
    err "earlier 'sudo ./setup.sh'. The OS requires root to remove root-owned files."
    err "Run this ONCE, then re-run ./setup.sh (no sudo needed ever after):"
    err "    sudo rm -rf \"$UPSTREAM_DIR\""
    exit 1
  fi
  if [ -d "$UPSTREAM_DIR" ]; then
    [ -f "$UPSTREAM_DIR/package.json" ] || {
      err "$UPSTREAM_DIR already exists but does not look like a codegraph source tree."
      err "Remove it and re-run ./setup.sh."
      exit 1
    }
    ok "Upstream source already present at $UPSTREAM_DIR (run ./update.sh to refresh)"
    return
  fi
  git clone --depth 1 "$UPSTREAM_REPO" "$UPSTREAM_DIR"
  ok "Fetched $UPSTREAM_SLUG → codegraph/"
}

remove_nested_git_metadata() {
  [ -d "$UPSTREAM_DIR/.git" ] || return 0
  rm -rf "$UPSTREAM_DIR/.git"
  ok "Removed nested Git metadata from codegraph/"
}

# ── Apply Unity overlay (delegated to update.sh) ─────────────
apply_overlay() {
  step "Applying Unity overlay"
  bash "$SCRIPT_DIR/update.sh" --apply-custom-only
}

# ── Build + globally link the CLI ────────────────────────────
# True iff the `codegraph` on PATH is THIS Unity-enabled build (has `unity` cmd).
codegraph_has_unity() {
  command -v codegraph >/dev/null 2>&1 || return 1
  if command -v timeout >/dev/null 2>&1; then
    timeout 10 codegraph --help 2>/dev/null | grep -q "unity \[command"
  else
    codegraph --help 2>/dev/null | grep -q "unity \[command"
  fi
}

# Put a Unity-enabled `codegraph` on PATH (idempotent). Tries `npm link`, then a
# direct symlink fallback. Safe to call repeatedly — used by build_cli AND as a
# self-heal guard after `codegraph install` (whose global-install step can
# clobber our link with the published, non-Unity npm package).
link_unity_cli() {
  # A previously published global install of @colbymchenry/codegraph (the npm
  # thin-installer) owns the `codegraph` bin and shadows our local link. We don't
  # need to remove it: the verified fallback below overwrites the bin SYMLINK
  # (which lives in a user-owned dir, so no sudo needed) to point at this build.
  info "Removing any published global @colbymchenry/codegraph shim"
  run_with_timeout 30 npm rm -g @colbymchenry/codegraph || true
  info "Linking this Unity-enabled local build"
  ( cd "$UPSTREAM_DIR" && run_with_timeout 60 npm link ) || true
  hash -r 2>/dev/null || true
  codegraph_has_unity && return 0

  # npm link didn't win (commonly a root-owned stale install shadows it). Fall
  # back to a direct symlink — we own the global bin dir even if the stale pkg is
  # root-owned, so removing the symlink there and recreating it works without sudo.
  local gbin; gbin="$(npm prefix -g 2>/dev/null)/bin"
  if [ -d "$gbin" ] && [ -w "$gbin" ]; then
    rm -f "$gbin/codegraph"
    ln -s "$CLI" "$gbin/codegraph"
    hash -r 2>/dev/null || true
    codegraph_has_unity && return 0
  fi
  return 1
}

build_cli() {
  step "Building & linking codegraph CLI"

  # A past `sudo` run can leave root-owned files in the default npm cache (~/.npm),
  # making `npm install` fail with EACCES. We can't chown them without sudo, so for
  # this run route npm at a fresh user-owned cache (repo-local, gitignored) instead.
  if path_has_foreign_files "$(npm config get cache 2>/dev/null)"; then
    export npm_config_cache="$SCRIPT_DIR/.npm-cache"
    mkdir -p "$npm_config_cache"
    warn "Default npm cache has root-owned files (prior sudo run); using $npm_config_cache"
  fi

  info "Installing codegraph dependencies"
  ( cd "$UPSTREAM_DIR" && run_with_timeout 120 npm install )
  info "Building codegraph TypeScript output"
  ( cd "$UPSTREAM_DIR" && run_with_timeout 120 npm run build )
  [ -f "$CLI" ] || { err "Build produced no $CLI"; exit 1; }
  chmod +x "$CLI" 2>/dev/null || true

  if link_unity_cli; then
    ok "Built & linked — Unity-enabled 'codegraph' is on PATH ($(command -v codegraph))"
    return
  fi

  warn "Could not put a Unity-enabled 'codegraph' on PATH (npm global bin not writable?)."
  warn "Run the CLI directly meanwhile:  node $CLI unity init"
}

# ── Wire MCP into agents (upstream's own installer) ──────────
configure_mcp() {
  step "Configuring agent MCP (codegraph install)"
  # IMPORTANT: pass --yes. Without it, the installer's "Install the codegraph CLI
  # on your PATH?" step runs `npm install -g @colbymchenry/codegraph`, which
  # REPLACES our Unity-enabled symlink with the published (non-Unity) package —
  # that's the recurring `codegraph unity init → unknown command 'unity'` bug.
  # --yes assumes the CLI is already present (it is — build_cli linked it) and
  # skips that global install entirely.
  if node "$CLI" install --yes; then
    ok "MCP configured. NOTE: it points at this local build (Unity-enabled)."
  else
    warn "codegraph install failed — configure MCP manually to: node $CLI serve --mcp"
  fi

  # Belt-and-suspenders: re-verify and re-link if anything clobbered the symlink.
  if ! codegraph_has_unity; then
    warn "codegraph on PATH lost its Unity command after install — re-linking."
    link_unity_cli && ok "Re-linked Unity-enabled 'codegraph' ($(command -v codegraph))" \
      || warn "Re-link failed. Run directly:  node $CLI unity init"
  fi
}

# ── Unity skills are installed per indexed project ───────────
install_skills() {
  step "Unity skills"
  [ -d "$CUSTOM_SKILLS_DIR" ] || { warn "No custom/skills dir"; return; }
  ok "Unity skills will be installed project-locally by 'codegraph unity init'"
}

# ── Initialize the global project registry the dashboard reads ──────────
init_registry() {
  step "Project registry"
  local reg="$HOME/.codegraph/projects.json"
  if [ -f "$reg" ]; then
    ok "Registry exists: $reg"
  else
    mkdir -p "$HOME/.codegraph"
    printf '{\n  "version": 1,\n  "projects": []\n}\n' > "$reg"
    ok "Created registry: $reg"
  fi
}

main() {
  echo -e "\n${CYAN}🔧 unity-codegraph setup${NC}"
  guard_no_root
  check_prereqs
  fetch_upstream
  apply_overlay
  remove_nested_git_metadata
  build_cli
  configure_mcp
  install_skills
  init_registry
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Setup complete!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${DIM}Index a Unity project${NC}  cd <UnityProject> && codegraph unity init"
  echo -e "  ${DIM}Index a non-Unity project${NC} cd <Project> && codegraph init"
  echo -e "  ${DIM}Open the dashboard${NC}        ./dashboard.sh"
  echo -e "  ${DIM}Refresh upstream + overlay${NC} ./update.sh"
  echo -e "  ${DIM}Re-apply overlay only${NC}     ./update.sh --apply-custom-only"
  echo ""
  echo -e "  ${YELLOW}→ Restart your agent (Claude Code / Cursor / Codex) to load MCP + skills${NC}"
  echo ""
}

case "${1:-}" in
  --update|-u) exec bash "$SCRIPT_DIR/update.sh" ;;
  --help|-h)
    echo "Usage: ./setup.sh [--update]"
    echo "  (no args)   full setup: fetch upstream, apply overlay, build, wire MCP, install skills"
    echo "  --update    refresh upstream + re-apply overlay (delegates to ./update.sh)" ;;
  "") main ;;
  *) err "Unknown option: $1"; exit 1 ;;
esac
