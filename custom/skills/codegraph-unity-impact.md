---
name: codegraph-unity-impact
description: Analyze the blast radius of changing a Unity MonoBehaviour, ScriptableObject, method, or field — find every C# dependent before editing.
---

# CodeGraph Unity Impact

Use this skill before changing any Unity C# symbol (class, method, field). The
graph covers the project's game C#; assess the blast radius there first.

## Workflow

1. See the symbol's immediate callers and callees:

```text
codegraph context "<ClassName>"
codegraph callers "<ClassName>.<Method>"
```

2. Full transitive blast radius:

```text
codegraph impact "<ClassName>"
```

3. Check lifecycle coupling for MonoBehaviours:

```text
codegraph query "<ClassName>"
codegraph callees "<ClassName>.Update"
```

## Impact Depth Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect dependents | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if on a critical path |

## Report Format

List:

- Direct C# callers and type references (d=1) — must be updated.
- Indirect dependents (d=2/d=3) — test.
- Whether any public method, event, or test depends on the target.

## Example: "Is it safe to rename PlayerHealth.TakeDamage?"

```text
1. codegraph callers "PlayerHealth.TakeDamage"
   → DamageDealer.OnTriggerEnter, Enemy.Attack, Trap.OnStep
2. codegraph impact "PlayerHealth"
   → 3 direct callers, 7 indirect dependents
3. Verdict: safe if all 3 callers are updated.
```
