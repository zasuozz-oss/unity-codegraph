#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# unity-codegraph — refresh / re-apply the Unity overlay
#
# Refreshes upstream colbymchenry/codegraph into ./codegraph and re-applies the
# Unity custom overlay (new files + patches) on top. The generated source tree is
# left without nested Git metadata so the wrapper repo remains the only Git repo.
#
#   ./update.sh                     refresh upstream, re-apply overlay, rebuild
#   ./update.sh --apply-custom-only just (re)apply the overlay (no refresh/build)
# ══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}  ✓${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }
step() { echo -e "\n${CYAN}── $* ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_SLUG="colbymchenry/codegraph"
UPSTREAM_REPO="https://github.com/${UPSTREAM_SLUG}.git"
UPSTREAM_DIR="$SCRIPT_DIR/codegraph"
CUSTOM_DIR="$SCRIPT_DIR/custom"
PATCH_DIR="$CUSTOM_DIR/patches"
NEW_DIR="$CUSTOM_DIR/new"

require_source() {
  if [ ! -f "$UPSTREAM_DIR/package.json" ]; then
    err "Upstream source not found at $UPSTREAM_DIR — run ./setup.sh first."
    exit 1
  fi
}

remove_nested_git_metadata() {
  [ -d "$UPSTREAM_DIR/.git" ] || return 0
  rm -rf "$UPSTREAM_DIR/.git"
  ok "Removed nested Git metadata from codegraph/"
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
  local has_git=0
  [ -d "$UPSTREAM_DIR/.git" ] && has_git=1
  shopt -s nullglob
  for p in "$PATCH_DIR"/*.patch; do
    [ -s "$p" ] || continue
    local name; name="$(basename "$p")"
    if git -C "$UPSTREAM_DIR" apply --check "$p" >/dev/null 2>&1; then
      git -C "$UPSTREAM_DIR" apply --whitespace=nowarn "$p"
      ok "Applied $name"
      applied=$((applied + 1))
    elif [ "$has_git" -eq 1 ] && git -C "$UPSTREAM_DIR" apply --check --3way "$p" >/dev/null 2>&1; then
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
  require_source
  step "Applying Unity overlay onto upstream source"
  # The clone must differ from upstream ONLY by our overlay, so revert any
  # previously-applied patch hunks (tracked files) back to pristine HEAD first.
  # This makes re-applying idempotent — patches always land on a clean base
  # instead of failing because they're already (partially) applied. Untracked
  # overlay files are simply overwritten by copy_new_files next.
  if [ -d "$UPSTREAM_DIR/.git" ]; then
    git -C "$UPSTREAM_DIR" checkout -- . 2>/dev/null || true
  fi
  copy_new_files
  apply_patches
}

refresh_upstream() {
  step "Refreshing upstream codegraph"
  local tmp
  tmp="$(mktemp -d "$SCRIPT_DIR/.codegraph-fetch.XXXXXX")"
  if git clone --depth 1 "$UPSTREAM_REPO" "$tmp"; then
    rm -rf "$UPSTREAM_DIR"
    mv "$tmp" "$UPSTREAM_DIR"
    ok "Fetched fresh $UPSTREAM_SLUG → codegraph/"
  else
    rm -rf "$tmp"
    err "Could not fetch $UPSTREAM_REPO"
    exit 1
  fi
}

rebuild() {
  step "Rebuilding codegraph"
  ( cd "$UPSTREAM_DIR" && npm install && npm run build )
  ok "Build complete"
}

main() {
  refresh_upstream
  apply_custom_only
  remove_nested_git_metadata
  rebuild
  echo ""; ok "Update complete. Restart your agent to reload."
}

case "${1:-}" in
  --apply-custom-only) apply_custom_only; remove_nested_git_metadata ;;
  --help|-h)
    echo "Usage: ./update.sh [--apply-custom-only]"
    echo "  (no args)            refresh upstream, re-apply overlay, rebuild"
    echo "  --apply-custom-only  re-apply overlay only (no refresh/build)" ;;
  "") main ;;
  *) err "Unknown option: $1"; exit 1 ;;
esac
