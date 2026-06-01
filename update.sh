#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# unity-codegraph — update / re-apply the Unity overlay
#
# Keeps upstream colbymchenry/codegraph pristine in ./codegraph and re-applies
# the Unity custom overlay (new files + patches) on top. Never edits upstream
# source by hand, so `git pull upstream` never conflicts on our account.
#
#   ./update.sh                     pull upstream, re-apply overlay, rebuild
#   ./update.sh --apply-custom-only just (re)apply the overlay (no pull/build)
# ══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}  ✓${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }
step() { echo -e "\n${CYAN}── $* ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="$SCRIPT_DIR/codegraph"
CUSTOM_DIR="$SCRIPT_DIR/custom"
PATCH_DIR="$CUSTOM_DIR/patches"
NEW_DIR="$CUSTOM_DIR/new"

require_clone() {
  if [ ! -d "$UPSTREAM_DIR/.git" ]; then
    err "Upstream clone not found at $UPSTREAM_DIR — run ./setup.sh first."
    exit 1
  fi
}

# ── Copy drop-in new files (paths under custom/new mirror the upstream tree) ──
copy_new_files() {
  [ -d "$NEW_DIR" ] || return 0
  local count=0 rel dst
  while IFS= read -r src; do
    rel="${src#"$NEW_DIR"/}"
    dst="$UPSTREAM_DIR/$rel"
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    count=$((count + 1))
  done < <(find "$NEW_DIR" -type f)
  ok "Copied $count new file(s) into upstream tree"
}

# ── Apply patches with 3-way merge (degrades gracefully on upstream drift) ──
apply_patches() {
  [ -d "$PATCH_DIR" ] || return 0
  local applied=0 failed=0 p
  shopt -s nullglob
  for p in "$PATCH_DIR"/*.patch; do
    [ -s "$p" ] || continue
    local name; name="$(basename "$p")"
    if git -C "$UPSTREAM_DIR" apply --check "$p" >/dev/null 2>&1; then
      git -C "$UPSTREAM_DIR" apply --whitespace=nowarn "$p"
      ok "Applied $name"
      applied=$((applied + 1))
    elif git -C "$UPSTREAM_DIR" apply --check --3way "$p" >/dev/null 2>&1; then
      git -C "$UPSTREAM_DIR" apply --3way --whitespace=nowarn "$p"
      ok "Applied $name (3-way)"
      applied=$((applied + 1))
    elif git -C "$UPSTREAM_DIR" apply --check -R "$p" >/dev/null 2>&1; then
      ok "$name already applied — skipping"
    else
      warn "Could not apply $name cleanly — upstream drifted; resolve manually:"
      warn "  cd codegraph && git apply --3way ../custom/patches/$name"
      failed=$((failed + 1))
    fi
  done
  shopt -u nullglob
  [ "$failed" -eq 0 ] && ok "Overlay patches applied ($applied)" \
    || warn "$failed patch(es) need manual attention"
}

apply_custom_only() {
  require_clone
  step "Applying Unity overlay onto upstream clone"
  # The clone must differ from upstream ONLY by our overlay, so revert any
  # previously-applied patch hunks (tracked files) back to pristine HEAD first.
  # This makes re-applying idempotent — patches always land on a clean base
  # instead of failing because they're already (partially) applied. Untracked
  # overlay files are simply overwritten by copy_new_files next.
  git -C "$UPSTREAM_DIR" checkout -- . 2>/dev/null || true
  copy_new_files
  apply_patches
}

pull_upstream() {
  require_clone
  step "Pulling upstream codegraph (resetting to a pristine base first)"
  # Reset tracked files to pristine upstream so our patches always apply to a
  # clean base. Untracked overlay files (custom/new copies) are re-copied next.
  git -C "$UPSTREAM_DIR" fetch upstream --tags 2>/dev/null \
    || git -C "$UPSTREAM_DIR" fetch origin --tags
  local base
  base="$(git -C "$UPSTREAM_DIR" rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "origin/main")"
  git -C "$UPSTREAM_DIR" reset --hard "$base"
  ok "Upstream reset to $base ($(git -C "$UPSTREAM_DIR" rev-parse --short HEAD))"
}

rebuild() {
  step "Rebuilding codegraph"
  ( cd "$UPSTREAM_DIR" && npm install && npm run build )
  ok "Build complete"
}

main() {
  pull_upstream
  apply_custom_only
  rebuild
  echo ""; ok "Update complete. Restart your agent to reload."
}

case "${1:-}" in
  --apply-custom-only) apply_custom_only ;;
  --help|-h)
    echo "Usage: ./update.sh [--apply-custom-only]"
    echo "  (no args)            pull upstream, re-apply overlay, rebuild"
    echo "  --apply-custom-only  re-apply overlay only (no pull/build)" ;;
  "") main ;;
  *) err "Unknown option: $1"; exit 1 ;;
esac
