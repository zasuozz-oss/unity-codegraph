# unity-codegraph

A Unity overlay for [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph),
plus a multi-project graph dashboard.

This repo does **not** fork-and-edit codegraph in place. Instead it keeps upstream
pristine and layers Unity support on top as a separate `custom/` overlay, applied
at setup/update time. The generated `codegraph/` tree is left without nested Git
metadata, so this wrapper remains the only Git repo in the folder.

## What the overlay adds

- **Unity-aware C# indexing (gitnexus parity)** — on a Unity project, indexes only
  the game **C# scripts**. Unity asset/serialized files (`.prefab`, `.unity`,
  `.asset`, `.meta`, `.asmdef`) are skipped, and engine / SDK / plugin / editor
  directories are ignored (`Library`, `Packages`, `Plugins`, `Editor`,
  `TextMesh Pro`, `NuGet`, asset-only folders, …). The ignore lists live in
  `custom/new/src/extraction/unity-preset.ts`. Opt-in via the `unity` subcommand.
- **Project registry + dashboard** — every `codegraph init` registers the project
  in `~/.codegraph/projects.json`; `web/` is a React + sigma.js graph dashboard
  that lists all registered projects, lets you pick/switch (dropdown) between them,
  and delete them. Launch with `./dashboard.sh`.
- **Unity agent skills** — `custom/skills/*.md`, installed into Claude / Gemini /
  Codex skill dirs.

> Note: the older Unity **asset extractor** + **GUID/fileID resolver**
> (`unity-asset-extractor.ts`, `unity-yaml.ts`, `frameworks/unity.ts`) are retained
> but **dormant** — assets are no longer parsed, so prefab→script links are not
> emitted. Their unit tests assert the old behavior and currently fail `npm test`.

## Layout

```
unity-codegraph/            <- this wrapper repo (tracked)
├── custom/
│   ├── new/                drop-in new files (paths mirror the upstream tree)
│   │   ├── src/extraction/unity-preset.ts      ignore lists (C#-only gates)
│   │   ├── src/extraction/unity-mode.ts        Unity-mode marker/env
│   │   ├── src/registry/project-registry.ts    global project registry
│   │   ├── src/extraction/unity-asset-extractor.ts   (dormant)
│   │   ├── src/extraction/unity-yaml.ts              (dormant)
│   │   ├── src/resolution/frameworks/unity.ts        (dormant)
│   │   └── __tests__/unity/...
│   ├── patches/            git patches for upstream files we must modify
│   │   ├── 01-unity-core.patch        (extraction/resolution wiring, init registry hook)
│   │   ├── 02-unity-tests.patch       (Unity cases in existing test files)
│   │   └── 03-windows-test-fixes.patch (unrelated Windows EPERM teardown fixes)
│   └── skills/             Unity agent skills (*.md)
├── web/                    multi-project graph dashboard (React + Vite + sigma.js)
│   ├── server/             node:sqlite HTTP API over the registry + each project db
│   └── src/                React UI: project picker → graph canvas
├── dashboard.sh            launch the dashboard (API + Vite + open browser)
├── setup.sh                fetch upstream -> apply overlay -> strip .git -> build -> wire MCP -> skills -> registry
├── update.sh               refresh upstream -> re-apply overlay -> strip .git -> rebuild
└── codegraph/              <- generated upstream source tree (gitignored, created by setup.sh)
```

## Quick start

```bash
./setup.sh
```

`setup.sh` builds and `npm link`s the CLI (so `codegraph` is on your PATH) and
creates the empty project registry at `~/.codegraph/projects.json`.

Unity indexing is **opt-in** — it switches on only under the `unity` subcommand,
so plain `codegraph` keeps working exactly like upstream on non-Unity projects:

```bash
cd /path/to/UnityProject
codegraph unity init      # indexes game C# only; skips Unity assets + SDK/plugin dirs

cd /path/to/OtherProject
codegraph init            # upstream behavior on any codebase
```

Both register the project in the dashboard registry. `unity init` also drops a
`.codegraph/unity` marker, so later `codegraph sync` / `codegraph serve --mcp` stay
Unity-aware. MCP is wired to this **local** build (Unity-enabled) — not the npm
release, which has no Unity support.

## Dashboard

```bash
./dashboard.sh            # starts the API + UI and opens the project picker
```

Pick a project to view its graph; the topbar dropdown switches projects in place;
the trash button deletes a project's `.codegraph` and unregisters it. The server
auto-prunes registry entries whose `.codegraph` was deleted on disk. See
`web/README.md` for details and manual run steps.

## Updating

```bash
./update.sh                     # refresh upstream, re-apply overlay, rebuild
./update.sh --apply-custom-only # re-apply overlay only (after editing custom/)
```

`update.sh` fetches a fresh shallow upstream source tree into a temporary
directory, replaces `codegraph/`, re-applies the overlay, then removes
`codegraph/.git`. During a full refresh, patches can still use 3-way apply before
the metadata is stripped. `--apply-custom-only` just reapplies the overlay to the
existing generated source tree.

## Editing the overlay

- **New file** -> drop it under `custom/new/` at its upstream-relative path.
- **Change an upstream file** -> edit it inside `codegraph/`, then regenerate the
  patch from a temporary upstream clone outside this wrapper repo:
  `tmp="$(mktemp -d)" && git clone --depth 1 https://github.com/colbymchenry/codegraph.git "$tmp/codegraph"`.
  Copy the edited file(s) from `codegraph/` into `$tmp/codegraph/`, then run:
  `git -C "$tmp/codegraph" diff -- <file> > custom/patches/NN-name.patch`.
- Re-run `./update.sh --apply-custom-only` to verify it applies clean.
