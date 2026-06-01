---
name: codegraph-unity-refactoring
description: Use when renaming, moving, or restructuring C# classes, methods, or serialized fields within a Unity project using CodeGraph.
---

# CodeGraph Unity Refactoring

## Overview

Manual refactoring of Unity C# scripts poses risks of breaking scene bindings and transitive code paths. This skill provides procedures to rename, relocate, and update C# symbols safely using CodeGraph.

## When to Use
- When performing manual renaming of classes, methods, or properties without IDE-assisted global refactoring.
- When reorganizing first-party scripts across directories.
- When renaming serializable fields decorated with `[SerializeField]` or public properties bound inside scenes/prefabs.

### When NOT to Use
- When renaming local private variables that have no dependencies outside their containing function.

## How to Use

### 1. Renaming a Class or Method
Since CodeGraph tracks the static structure but doesn't auto-apply edits, follow this checklist:
1. **Locate all references**:
   ```bash
   codegraph callers "<ClassName>.<Method>"
   codegraph impact "<ClassName>"
   ```
2. **Apply edits**: Change the symbol name and update each matching code block in the codebase.
3. **Verify resolution**: Re-query CodeGraph for callers of the new name and confirm old callers return zero results.
   ```bash
   codegraph callers "<NewName>.<Method>"
   ```

### 2. Renaming a Serialized Field
Unity links `.prefab` and `.unity` references using the field's variable name.
1. **Find readers/writers**:
   ```bash
   codegraph context "<ClassName> <fieldName>"
   ```
2. **Update C# references**: Update occurrences across classes.
3. **Preserve Editor serialized data**: Add `[FormerlySerializedAs("oldName")]` from `UnityEngine.Serialization` to prevent data loss in the editor.
   ```csharp
   using UnityEngine.Serialization;

   // BEFORE:
   // [SerializeField] private float speed;

   // AFTER:
   [FormerlySerializedAs("speed")]
   [SerializeField] private float movementSpeed;
   ```

### 3. Moving or Re-indexing a Script
1. **Find dependencies and dependents**:
   ```bash
   codegraph impact "<ClassName>"
   codegraph callees "<ClassName>"
   ```
2. **Move files**: Move the C# script file to the target folder.
3. **Update assembly / namespace**: Match namespace changes if moving into a folder with a separate `.asmdef` boundary.
4. **Re-index**: Rebuild CodeGraph data to reflect file movement:
   ```bash
   codegraph unity index
   ```

## Safety Checklist

- [ ] Rebuilt/re-indexed the graph with `codegraph unity index` after changing locations.
- [ ] Confirmed direct callers of the old symbol name return 0 results.
- [ ] Added `[FormerlySerializedAs("oldName")]` for all serialized field changes.
- [ ] Ran the project C# unit tests and successfully compiled in the Unity Editor.

## Common Mistakes

- **Neglecting scene and prefab bindings**: Renaming public/serialized C# fields without `[FormerlySerializedAs]` will break Unity's scene/prefab serialization and lead to lost data.
- **Forgetting to re-index after renaming**: CodeGraph does not auto-sync files by default; always run `codegraph unity index` after renaming symbols to update the graph.
- **Refactoring editor scripts incorrectly**: Expecting editor-only classes (inside `Editor/` folders) to be indexed; they are bypassed to optimize query latency.
