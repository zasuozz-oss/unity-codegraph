---
name: codegraph-unity-exploring
description: Use when starting or exploring a Unity C# project indexed by CodeGraph, or when trying to locate gameplay systems and call pathways in first-party scripts.
---

# CodeGraph Unity Exploring

## Overview

CodeGraph maps call structures and semantic concepts across C# scripts. This skill provides techniques to quickly build a mental map of a new or large Unity project and locate its core systems using CodeGraph commands.

## When to Use
- When first joining or opening a Unity project and needing to build a mental map of features.
- When wanting to find core MonoBehaviour classes and ScriptableObjects related to a concept.
- When tracing call paths and dependencies end-to-end to understand how a gameplay feature is implemented.

### When NOT to Use
- When looking for third-party libraries, Unity Engine code, or packages (these are not indexed).
- When searching for asset files like prefabs, scenes, or materials.

## How to Use

1. **Check index status**: Check index size and freshness:
   ```bash
   codegraph status
   ```

2. **Survey the feature area**: Search the semantic space of a feature or concept to identify related classes/symbols:
   ```bash
   codegraph context "<feature or concept, e.g., enemy spawning>"
   ```

3. **Locate gameplay entry points**: Survey MonoBehaviour lifecycle methods within C# files:
   ```bash
   codegraph query "Update"
   codegraph query "Awake"
   ```

4. **Deep-dive a class/method**: Inspect the immediate callers and callees of a specific MonoBehaviour or C# method:
   ```bash
   codegraph callers "<ClassName>.<Method>"
   codegraph callees "<ClassName>.<Method>"
   ```

5. **Trace end-to-end flow**: Trace transitive caller pathways from an entry method to a target:
   ```bash
   codegraph trace "<StartClass>.<StartMethod>" "<TargetClass>.<TargetMethod>"
   ```
   *(Or call the MCP `codegraph_trace` directly)*

## Quick Reference

| Action | Command | Purpose |
| :--- | :--- | :--- |
| **Check Status** | `codegraph status` | Verify C# index status and size |
| **Survey Feature** | `codegraph context "<concept>"` | Find C# classes/methods related to feature |
| **Get Callers** | `codegraph callers "<Class>.<Method>"` | Find direct callers of a C# method |
| **Get Callees** | `codegraph callees "<Class>.<Method>"` | Find what a C# method invokes |
| **End-to-End Trace** | `codegraph trace "<Start>" "<End>"` | Trace full call path from source to destination |

## Common Mistakes
- **Expecting engine or package files**: CodeGraph Unity mode intentionally skips `UnityEngine` source, plugins, package folders, and editor code. Only first-party game scripts are indexed.
- **Neglecting to rebuild/sync after major refactoring**: If files were heavily added or modified, run `codegraph unity index` or `codegraph sync` to ensure graph accuracy.

## Example: "How does damage work?"

1. **Survey the concept**:
   ```bash
   codegraph context "player taking damage and health"
   ```
   *Result:* Identifies classes like `PlayerHealth`, `DamageDealer`, and `HealthBar`.

2. **Find callers of damage function**:
   ```bash
   codegraph callers "PlayerHealth.TakeDamage"
   ```
   *Result:* Shows it is called by `DamageDealer.OnTriggerEnter`, `Enemy.Attack`, and `Trap.OnStep`.

3. **Find what the damage function invokes**:
   ```bash
   codegraph callees "PlayerHealth.TakeDamage"
   ```
   *Result:* Shows it calls `HealthBar.Refresh` and raises `GameEvents.RaisePlayerHurt`.
