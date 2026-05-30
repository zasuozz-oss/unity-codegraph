---
name: codegraph-unity-exploring
description: Explore a CodeGraph-indexed Unity project — survey MonoBehaviours, ScriptableObjects, managers, and gameplay entry points, and trace how features flow through the C# code.
---

# CodeGraph Unity Exploring

Use this skill to explore an unfamiliar Unity codebase with CodeGraph. The graph
is the project's game C# — use it before grep/read.

## Workflow

1. Check index size / freshness:

```text
codegraph status
```

2. Survey the area you care about (returns the relevant symbols + their flow):

```text
codegraph context "<feature or concept, e.g. enemy spawning>"
```

3. Find gameplay entry points — MonoBehaviour lifecycle methods:

```text
codegraph query "Update"
codegraph query "Awake"
```

4. Deep-dive one class: see its callers and callees:

```text
codegraph callers "<ClassName>.<Method>"
codegraph callees "<ClassName>.<Method>"
```

5. Trace a flow end-to-end (MCP): `codegraph_trace` from the entry method to the
   target — one call returns the whole call path.

## Notes

- Engine / SDK / plugin / editor code is not indexed, so results are first-party
  game scripts only.
- For surveying several related symbols' source at once, use `codegraph_explore`
  (MCP) with a bag of symbol names.

## Example: "How does damage work?"

```text
1. codegraph context "player taking damage and health"
   → PlayerHealth, DamageDealer, HealthBar
2. codegraph callers "PlayerHealth.TakeDamage"
   → DamageDealer.OnTriggerEnter, Enemy.Attack
3. codegraph callees "PlayerHealth.TakeDamage"
   → HealthBar.Refresh, GameEvents.RaisePlayerHurt
```
