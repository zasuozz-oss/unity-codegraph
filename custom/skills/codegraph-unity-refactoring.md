---
name: codegraph-unity-refactoring
description: Safely rename or restructure Unity C# scripts, classes, methods, and fields by enumerating every call site in CodeGraph before changing them.
---

# CodeGraph Unity Refactoring

Use this skill when renaming or moving Unity C# scripts, classes, methods, or
fields. CodeGraph has **no automated rename** — enumerate every dependent in the
graph, then update them yourself.

## Rename a Class or Method

1. Find every call site before touching anything:

```text
codegraph callers "<ClassName>.<Method>"
codegraph impact "<ClassName>"
```

2. Rename the symbol and update each caller the graph listed.
3. Verify nothing dangles:

```text
codegraph callers "<NewName>.<Method>"
```

## Rename a Field

1. Find readers/writers of the owning class:

```text
codegraph context "<ClassName> <fieldName>"
codegraph callers "<ClassName>"
```

2. Update each C# reference.
3. For a `[SerializeField]` field whose value is set in the Unity Editor, add
   `[FormerlySerializedAs("oldName")]` so saved data still binds after the rename.

## Move a Script

1. List the symbol's dependents and dependencies:

```text
codegraph impact "<ClassName>"
codegraph callees "<ClassName>.<Method>"
```

2. Move the code, then re-run `codegraph callers` to confirm no orphaned
   references remain.

## Safety Checks

- Re-index after moving files: `codegraph unity index`.
- Run the project's test suite and build.
- Re-run `codegraph callers` on the renamed symbol → expect 0 references to the
  old name.
