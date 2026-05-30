---
name: codegraph-unity-guide
description: Graph model and working rules for a Unity project indexed by CodeGraph — how Unity C# scripts map into the graph and enabling Unity mode with `codegraph unity init`.
---

# CodeGraph Unity Guide

Use this skill when working in a Unity project indexed by CodeGraph.

## Enabling Unity Mode

Unity indexing is opt-in. Index a Unity project with `codegraph unity init`
(not plain `codegraph init`). Unity mode indexes the project's **game C# scripts**
and skips engine / SDK / plugin / editor directories so the graph stays
first-party code. It drops a `.codegraph/unity` marker so `codegraph sync` /
`codegraph serve --mcp` stay Unity-aware afterward. Re-index with
`codegraph unity index`.

## Graph Model

- Unity C# scripts are indexed as normal `csharp` files — classes, methods,
  properties, fields, enums, structs.
- A `MonoBehaviour` or `ScriptableObject` subclass is an ordinary `class` node; its
  lifecycle methods (`Awake`, `Start`, `Update`, …) are `method` nodes.
- Edges are the usual code edges: `contains`, `calls`, `references`, `extends`,
  `implements`, `instantiates`, `imports`.
- Skipped (never indexed): engine/generated dirs (`Library/`, `Temp/`, `Logs/`,
  `MemoryCaptures/`, `UserSettings/`, `ProjectSettings/`, `Packages/`), third-party
  SDK/plugin folders (`Plugins/`, `TextMesh Pro/`, `NuGet/`, …), `Editor/`
  directories, and asset-only folders. Full lists live in
  `custom/new/src/extraction/unity-preset.ts`.

## Useful Queries

Find a class or symbol:

```text
codegraph query "PlayerController"
```

Survey a feature area:

```text
codegraph context "player movement and input handling"
```

Who calls a method / what it calls:

```text
codegraph callers "PlayerController.TakeDamage"
codegraph callees "PlayerController.TakeDamage"
```

## Working Rules

- The graph is the project's C# code structure and call flow — use it for
  understanding, navigation, callers/callees, and impact before grep/read.
- Engine, SDK/plugin, and editor code is intentionally absent; don't expect
  third-party classes (e.g. DOTween, TextMesh Pro) to appear in results.
- After large edits, refresh with `codegraph unity index` (the file watcher also
  auto-syncs incrementally).
