# CodeGraph Unity - Project Instructions

This Unity project is indexed by **CodeGraph** as **{{projectName}}** ({{nodes}} symbols, {{edges}} relationships across {{files}} files).

Use CodeGraph before scanning files manually. Unity mode indexes first-party C# scripts and skips Unity engine, package, plugin, editor, and asset-only directories.

> If a CodeGraph tool reports the index is stale, run `codegraph unity index`.

## Always Do

- Assess impact before editing a function, class, method, or serialized field. Use `codegraph_impact` or `codegraph impact "<Symbol>"`.
- For "where is X", "what calls Y", or "how does this flow work", use CodeGraph search/context/call tools before grep/read.
- Use `codegraph_context` or `codegraph context "<task>"` for a full view of one feature area or symbol.
- Use `codegraph_callers` / `codegraph callers "<Symbol>"` before changing public methods, shared managers, events, interfaces, or base classes.
- Re-run `codegraph unity index` after large moves, renames, or generated file changes.

## Never Do

- NEVER rename symbols with broad find-and-replace before enumerating callers and dependents.
- NEVER assume prefab or scene bindings are safe after renaming `[SerializeField]` or public fields.
- NEVER expect Unity assets, engine source, packages, plugins, or editor-only scripts to appear in the graph.

## Local Unity Skills

`codegraph unity init` installs these project-local skills under both `.agents/skills/` and `.claude/skills/`:

| Task | Use this local skill |
|------|----------------------|
| Initialize, sync, or troubleshoot Unity CodeGraph | `codegraph-unity-guide` |
| Explore Unity gameplay systems and call paths | `codegraph-unity-exploring` |
| Assess blast radius before changing C# symbols | `codegraph-unity-impact` |
| Rename, move, or restructure Unity C# safely | `codegraph-unity-refactoring` |

## CLI Quick Reference

| Action | Command |
|--------|---------|
| Check index status | `codegraph status` |
| Rebuild Unity C# index | `codegraph unity index` |
| Search symbols | `codegraph query "<name>"` |
| Build context | `codegraph context "<task>"` |
| Find callers | `codegraph callers "<Symbol>"` |
| Find callees | `codegraph callees "<Symbol>"` |
| Analyze impact | `codegraph impact "<Symbol>"` |

## Self-Check Before Finishing

1. Impact was checked for every modified shared symbol.
2. Direct callers/dependents were updated when signatures changed.
3. Serialized field renames preserve Unity data, for example with `[FormerlySerializedAs("oldName")]`.
4. The graph was refreshed after broad structural changes.
