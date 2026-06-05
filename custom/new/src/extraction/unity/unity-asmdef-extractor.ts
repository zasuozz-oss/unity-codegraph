import { ExtractionResult, Node } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';
import { RawUnityEdge } from '../../resolution/unity/unity-reference-resolver';

export interface UnityAsmdefExtractionResult extends ExtractionResult {
  unityRawEdges: RawUnityEdge[];
}

export class UnityAsmdefExtractor {
  constructor(private filePath: string, private source: string) {}

  extract(): UnityAsmdefExtractionResult {
    const start = Date.now();
    const nodes: Node[] = [];
    const unityRawEdges: RawUnityEdge[] = [];

    let parsed: { name?: string; references?: unknown };
    try {
      parsed = JSON.parse(this.source);
    } catch {
      return { nodes, edges: [], unityRawEdges, unresolvedReferences: [], errors: [], durationMs: Date.now() - start };
    }

    const name = typeof parsed.name === 'string' && parsed.name.length > 0
      ? parsed.name
      : this.filePath.split(/[/\\]/).pop()?.replace(/\.asmdef$/i, '') ?? this.filePath;
    const moduleNode = mkModuleNode(this.filePath, name);
    nodes.push(moduleNode);

    const references = Array.isArray(parsed.references) ? parsed.references : [];
    for (const reference of references) {
      if (typeof reference !== 'string' || reference.length === 0) continue;
      if (reference.startsWith('GUID:')) {
        const guid = reference.slice('GUID:'.length);
        if (guid) {
          unityRawEdges.push(rawUnityEdge(this.filePath, moduleNode.id, {
            guid,
            reference,
          }));
        }
      } else {
        unityRawEdges.push(rawUnityEdge(this.filePath, moduleNode.id, {
          asmdefName: reference,
          reference,
        }));
      }
    }

    return { nodes, edges: [], unityRawEdges, unresolvedReferences: [], errors: [], durationMs: Date.now() - start };
  }
}

function mkModuleNode(filePath: string, name: string): Node {
  return {
    id: generateNodeId(filePath, 'module', name, 1),
    kind: 'module',
    name,
    qualifiedName: `${filePath}::${name}`,
    filePath,
    language: 'unity_asmdef',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

function rawUnityEdge(
  filePath: string,
  source: string,
  extra: Record<string, unknown>
): RawUnityEdge {
  return {
    filePath,
    source,
    kind: 'references',
    provenance: 'unity',
    metadata: { unityRelation: 'asmdef_references_asmdef', ...extra },
  };
}
