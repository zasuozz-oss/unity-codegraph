---
name: codegraph-unity-impact
description: Use when modifying first-party C# scripts, MonoBehaviours, or ScriptableObjects in a Unity project to identify potential compile or execution breakages across dependents.
---

# CodeGraph Unity Impact

## Overview

Modifying shared C# components can cause untracked failures across game subsystems. This skill provides a systematic process to evaluate the blast radius of changes to Unity MonoBehaviours, ScriptableObjects, and classes.

## When to Use
- When planning to modify, delete, or refactor core gameplay managers, custom events, or shared interfaces.
- When wanting to trace structural dependencies of Unity-specific types (e.g. ScriptableObjects) and MonoBehaviours.
- When needing to identify all methods and classes affected transitively at different levels of call depths.

### When NOT to Use
- When debugging local, non-exposed methods whose signatures will not change.

## How to Use

1. **Find Direct Call Sites**: Check immediate callers and semantic context:
   ```bash
   codegraph context "<ClassName>"
   codegraph callers "<ClassName>.<Method>"
   ```

2. **Evaluate Full Transitive Blast Radius**: Trace the transitive dependencies up the call chain:
   ```bash
   codegraph impact "<ClassName>"
   ```

3. **Check MonoBehaviour Lifecycle Hooks**: Check if the MonoBehaviour couples closely with Update loop triggers or other lifecycle nodes:
   ```bash
   codegraph callees "<ClassName>.Update"
   ```

## Impact Depth Levels

| Depth | Level | Impact & Meaning | Required Actions |
| :--- | :--- | :--- | :--- |
| **d=1** | Direct Dependents | Direct callers, instantiations, and inheritance | **MUST update** and match signature updates immediately. |
| **d=2** | Indirect Dependents | Classes calling d=1 methods; transitive layer | **Should review and verify** with compilation or automated tests. |
| **d=3** | Distant Transitive | Deep dependency chain | **Targeted smoke testing** if on a critical path. |

## Quick Reference

| Action | Command | Purpose |
| :--- | :--- | :--- |
| **Get Immediate Callers** | `codegraph callers "<Class>.<Method>"` | Find direct C# dependants |
| **Get Transitive Impact** | `codegraph impact "<ClassName>"` | Enumerate full blast radius up to three depths |
| **Get Callees** | `codegraph callees "<Class>.<Method>"` | Find the dependencies called by target |

## Common Mistakes
- **Forgetting that the editor and scene configurations are not in C#**: Changes to fields decorated with `[SerializeField]` can break bindings in `.prefab` or `.unity` files. CodeGraph only traces C# compilation dependencies; always check serializable field bindings manually in Unity or use serialization preservation attributes (see `codegraph-unity-refactoring` skill).

## Example: "Is it safe to rename PlayerHealth.TakeDamage?"

1. **Find direct callers**:
   ```bash
   codegraph callers "PlayerHealth.TakeDamage"
   ```
   *Result:* `DamageDealer.OnTriggerEnter`, `Enemy.Attack`, `Trap.OnStep`

2. **Evaluate blast radius**:
   ```bash
   codegraph impact "PlayerHealth"
   ```
   *Result:* 3 direct callers (d=1), 7 transitive dependents (d=2, d=3).

3. **Verdict & Action Plan**:
   Safe to proceed if all 3 direct callers are updated in the same changeset, and direct testing is run on the 7 indirect dependents.
