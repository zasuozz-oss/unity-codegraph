---
name: codegraph-unity-guide
description: Use when working in a Unity project and needing to initialize, synchronize, or troubleshoot CodeGraph indexing and configuration.
---

# CodeGraph Unity Guide

## Overview

Unity projects require optimized indexing to ignore system directories and editor boilerplate. This skill guides the setup, synchronization, and query architecture of CodeGraph for Unity C# scripts.

## When to Use
- When setting up CodeGraph indexing for a Unity repository.
- When querying and exploring MonoBehaviour classes, ScriptableObjects, and serialized C# fields.
- When needing to understand what gets indexed (game C# files) versus what is excluded (engine, editor, plugins, package folders).

### When NOT to Use
- When working on non-Unity projects (use general CodeGraph guides instead).

## How to Use

### 1. Enabling Unity Mode
Unity indexing is opt-in and tailored to ignore standard boilerplate.
- **Initialize Unity Mode**: Runs custom configuration setup and creates a `.codegraph/unity` marker:
  ```bash
  codegraph unity init
  ```
- **Sync/Index the project**: Builds the initial graph or refreshes it after substantial code modifications:
  ```bash
  codegraph unity index
  ```
- **Run the MCP server**: Keeps the MCP server active and syncs files incrementally using file watchers:
  ```bash
  codegraph serve --mcp
  ```

### 2. The Unity Graph Model
- **MonoBehaviours & ScriptableObjects**: Indexed as standard class nodes.
- **Lifecycle Hooks**: Methods like `Awake()`, `Start()`, `Update()`, `OnDestroy()` map as standard method nodes connected via standard edges.
- **Edges**: Custom C# relationships are tracked via standard edges: `contains`, `calls`, `references`, `extends`, `implements`, `instantiates`.
- **Exclusion Presets**: To keep the database fast and relevant, the following folders are automatically bypassed:
  - System/Engine-generated folders: `Library/`, `Temp/`, `Logs/`, `UserSettings/`, `ProjectSettings/`, `Packages/`.
  - External SDKs & Assets: `Plugins/`, `TextMesh Pro/`, `NuGet/`.
  - Editor scripts: Any script in an `Editor/` directory.

## Quick Reference

| Action | Command | Purpose |
| :--- | :--- | :--- |
| **Initialize Unity Mode** | `codegraph unity init` | Setup a Unity-specific CodeGraph configuration |
| **Re-index / Refresh** | `codegraph unity index` | Fully rebuild the code graph representation |
| **Start Server** | `codegraph serve --mcp` | Start local CodeGraph serve with auto file watch |
| **Query Class/Symbol** | `codegraph query "<Name>"` | Lookup definitions and nodes for a specific class or symbol |

## Common Mistakes
- **Using `codegraph init` instead of `codegraph unity init`**: Plain initialization will attempt to index engine directories like `Library/` and `Packages/`, leading to massive graph inflation and poor query latency.
- **Expecting third-party components to show up**: Classes from plugins (e.g. `DOTween`, `UniTask`) are omitted by default to ensure rapid first-party exploration.
