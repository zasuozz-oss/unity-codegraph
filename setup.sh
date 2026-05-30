#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# unity-codegraph — one-shot setup
#
# Clones (or forks) upstream colbymchenry/codegraph into ./codegraph, applies
# the Unity overlay from custom/ (new files + patches — upstream is never edited
# by hand), builds the CLI, wires MCP into your agents, and installs the Unity
# skills.
#
#   ./setup.sh            full setup (first install or re-run)
#   ./setup.sh --update   delegate to ./update.sh (pull upstream + re-apply)
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

# Skill destinations per agent (see custom/skills/README.md).
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
GEMINI_SKILLS_DIR="$HOME/.gemini/config/skills"
CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"

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

# ── Clone / fork upstream into ./codegraph ───────────────────
fetch_upstream() {
  step "Fetching upstream codegraph"
  if [ -d "$UPSTREAM_DIR/.git" ]; then
    ok "Already cloned at $UPSTREAM_DIR (run ./update.sh to pull)"
    return
  fi
  if command -v gh >/dev/null 2>&1; then
    info "Forking $UPSTREAM_SLUG via gh…"
    if gh repo fork "$UPSTREAM_SLUG" --clone=false >/dev/null 2>&1; then
      local me; me="$(gh api user -q .login 2>/dev/null || true)"
      if [ -n "$me" ] && git clone "https://github.com/$me/codegraph.git" "$UPSTREAM_DIR" 2>/dev/null; then
        git -C "$UPSTREAM_DIR" remote add upstream "$UPSTREAM_REPO" 2>/dev/null || true
        ok "Forked → $me/codegraph, cloned → codegraph/ (origin=fork, upstream=$UPSTREAM_SLUG)"
        return
      fi
    fi
    warn "Fork path failed — falling back to direct clone"
  fi
  git clone "$UPSTREAM_REPO" "$UPSTREAM_DIR"
  git -C "$UPSTREAM_DIR" remote rename origin upstream 2>/dev/null || true
  ok "Cloned $UPSTREAM_SLUG → codegraph/"
}

# ── Apply Unity overlay (delegated to update.sh) ─────────────
apply_overlay() {
  step "Applying Unity overlay"
  bash "$SCRIPT_DIR/update.sh" --apply-custom-only
}

# ── Build + globally link the CLI ────────────────────────────
build_cli() {
  step "Building & linking codegraph CLI"
  ( cd "$UPSTREAM_DIR" && npm install && npm run build )
  [ -f "$CLI" ] || { err "Build produced no $CLI"; exit 1; }
  # A previously published global install of @colbymchenry/codegraph (the npm
  # thin-installer) owns the `codegraph` bin and shadows our local link — drop it
  # first so `npm link` below actually wins.
  npm rm -g @colbymchenry/codegraph >/dev/null 2>&1 || true
  if ( cd "$UPSTREAM_DIR" && npm link >/dev/null 2>&1 ); then
    command -v codegraph >/dev/null 2>&1 \
      && ok "Built & linked — 'codegraph' is on PATH ($(command -v codegraph))" \
      || warn "Linked, but 'codegraph' not on PATH — add your npm global bin ($(npm prefix -g 2>/dev/null)) to PATH"
  else
    warn "npm link failed — use 'node $CLI' directly"
  fi
}

# ── Wire MCP into agents (upstream's own installer) ──────────
configure_mcp() {
  step "Configuring agent MCP (codegraph install)"
  if node "$CLI" install; then
    ok "MCP configured. NOTE: it points at this local build (Unity-enabled)."
  else
    warn "codegraph install failed — configure MCP manually to: node $CLI serve --mcp"
  fi
}

# ── Install Unity skills into each agent ─────────────────────
install_skills() {
  step "Installing Unity skills"
  [ -d "$CUSTOM_SKILLS_DIR" ] || { warn "No custom/skills dir"; return; }
  local target
  for target in "$CLAUDE_SKILLS_DIR" "$GEMINI_SKILLS_DIR" "$CODEX_SKILLS_DIR"; do
    local n=0 f name
    for f in "$CUSTOM_SKILLS_DIR"/*.md; do
      name="$(basename "$f" .md)"
      [ "$name" = "README" ] && continue
      mkdir -p "$target/$name"
      cp "$f" "$target/$name/SKILL.md"
      n=$((n + 1))
    done
    ok "$n skill(s) → $target"
  done
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
  check_prereqs
  fetch_upstream
  apply_overlay
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
  echo -e "  ${DIM}Update upstream + overlay${NC} ./update.sh"
  echo -e "  ${DIM}Re-apply overlay only${NC}     ./update.sh --apply-custom-only"
  echo ""
  echo -e "  ${YELLOW}→ Restart your agent (Claude Code / Cursor / Codex) to load MCP + skills${NC}"
  echo ""
}

case "${1:-}" in
  --update|-u) exec bash "$SCRIPT_DIR/update.sh" ;;
  --help|-h)
    echo "Usage: ./setup.sh [--update]"
    echo "  (no args)   full setup: clone upstream, apply overlay, build, wire MCP, install skills"
    echo "  --update    pull upstream + re-apply overlay (delegates to ./update.sh)" ;;
  "") main ;;
  *) err "Unknown option: $1"; exit 1 ;;
esac
