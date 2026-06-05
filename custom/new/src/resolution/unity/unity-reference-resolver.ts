import { Edge, Node } from '../../types';
import { generateNodeId } from '../../extraction/tree-sitter-helpers';

export interface RawUnityEdge extends Omit<Edge, 'source' | 'target'> {
  source?: string;
  target?: string;
  filePath: string;
}

export function resolveUnityEdges(
  raw: RawUnityEdge[],
  guidToNodeId: Map<string, string>,
  localAnchorsByFile: Map<string, Map<number, string>>,
  methodTargetsByGuid: Map<string, Map<string, string>> = new Map()
): { resolved: Edge[]; missing: Edge[]; placeholderNodes: Node[] } {
  const resolved: Edge[] = [];
  const missing: Edge[] = [];
  const placeholderNodes: Node[] = [];

  for (const edge of raw) {
    const metadata = (edge.metadata ?? {}) as Record<string, any>;
    const relation = metadata.unityRelation as string | undefined;

    if (metadata.guid) {
      if (relation === 'unity_event_calls_method') {
        const methodName = metadata.methodName;
        const target = typeof methodName === 'string'
          ? methodTargetsByGuid.get(metadata.guid)?.get(methodName)
          : undefined;
        if (target && edge.source) {
          resolved.push({ ...edge, source: edge.source, target });
        }
        continue;
      }

      const target = guidToNodeId.get(metadata.guid);
      if (target && edge.source) {
        resolved.push({ ...edge, source: edge.source, target });
        continue;
      }

      if (relation === 'component_uses_script' && edge.source) {
        const placeholder = missingScriptNode(metadata.guid, edge.filePath);
        placeholderNodes.push(placeholder);
        const missingEdge: Edge = {
          ...edge,
          source: edge.source,
          target: placeholder.id,
          metadata: { ...metadata, unityRelation: 'missing_script' },
        };
        resolved.push(missingEdge);
        missing.push(missingEdge);
      }
      continue;
    }

    if (relation === 'gameobject_has_component' && edge.filePath) {
      const anchors = localAnchorsByFile.get(edge.filePath);
      const ownerId = anchors?.get(metadata.ownerFileId);
      if (ownerId && edge.target) {
        resolved.push({ ...edge, source: ownerId, target: edge.target });
      }
      continue;
    }

    if (edge.source && edge.target) {
      resolved.push({ ...edge, source: edge.source, target: edge.target });
    }
  }

  return { resolved, missing, placeholderNodes };
}

function missingScriptNode(guid: string, filePath: string): Node {
  return {
    id: generateNodeId(filePath, 'unity_script', guid, 1),
    kind: 'unity_script',
    name: `Missing script ${guid.slice(0, 8)}`,
    qualifiedName: `unity-script::${guid}`,
    filePath,
    language: 'unity_asset',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}
