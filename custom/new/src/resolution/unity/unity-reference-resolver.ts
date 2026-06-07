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
  guidFileIdToNodeId: Map<string, string>,
  localAnchorsByFile: Map<string, Map<string, string>>,
  methodTargetsByGuid: Map<string, Map<string, Node[]>> = new Map(),
  componentScriptGuidByNode: Map<string, string> = new Map()
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
        const fileId = unityFileIdKey(metadata.fileID);
        const targetObjectId = fileId
          ? guidFileIdToNodeId.get(`${metadata.guid}:${fileId}`)
          : undefined;
        const scriptGuid = targetObjectId
          ? componentScriptGuidByNode.get(targetObjectId)
          : undefined;
        const candidates = typeof methodName === 'string'
          ? methodTargetsByGuid
              .get(scriptGuid ?? metadata.guid)
              ?.get(methodName) ?? []
          : [];
        const target = selectUnityEventMethod(candidates, metadata.mode);
        const source = resolveUnityEventSource(
          metadata,
          edge.source,
          guidFileIdToNodeId
        );
        if (target && source) {
          resolved.push({ ...edge, source, target: target.id });
        }
        continue;
      }

      const fileId = unityFileIdKey(metadata.fileID);
      const exactTarget = fileId
        ? guidFileIdToNodeId.get(`${metadata.guid}:${fileId}`)
        : undefined;
      const target =
        relation === 'prefab_object_instance_of'
          ? exactTarget
          : exactTarget ?? guidToNodeId.get(metadata.guid);
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
        continue;
      }

      if (edge.source) {
        const placeholder = missingAssetNode(metadata.guid, fileId, edge.filePath);
        placeholderNodes.push(placeholder);
        const missingRelation = fileId ? 'missing_object' : 'missing_asset';
        const missingEdge: Edge = {
          ...edge,
          source: edge.source,
          target: placeholder.id,
          metadata: { ...metadata, unityRelation: missingRelation },
        };
        resolved.push(missingEdge);
        missing.push(missingEdge);
      }
      continue;
    }

    if (relation === 'unity_event_calls_method') {
      const fileId = unityFileIdKey(metadata.fileID);
      const targetObjectId = fileId
        ? localAnchorsByFile.get(edge.filePath)?.get(fileId)
        : undefined;
      const scriptGuid = targetObjectId
        ? componentScriptGuidByNode.get(targetObjectId)
        : undefined;
      const methodName = metadata.methodName;
      const candidates =
        scriptGuid && typeof methodName === 'string'
          ? methodTargetsByGuid.get(scriptGuid)?.get(methodName) ?? []
          : [];
      const target = selectUnityEventMethod(candidates, metadata.mode);
      const source = resolveUnityEventSource(
        metadata,
        edge.source,
        guidFileIdToNodeId
      );
      if (target && source) {
        resolved.push({ ...edge, source, target: target.id });
      }
      continue;
    }

    if (relation === 'gameobject_has_component' && edge.filePath) {
      const anchors = localAnchorsByFile.get(edge.filePath);
      const ownerFileId = unityFileIdKey(metadata.ownerFileId);
      const ownerId = ownerFileId ? anchors?.get(ownerFileId) : undefined;
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

function resolveUnityEventSource(
  metadata: Record<string, any>,
  fallback: string | undefined,
  guidFileIdToNodeId: Map<string, string>
): string | undefined {
  const guid = metadata.sourceComponentGuid;
  const fileId = unityFileIdKey(metadata.sourceComponentFileID);
  if (typeof guid === 'string' && fileId) {
    return guidFileIdToNodeId.get(`${guid}:${fileId}`) ?? fallback;
  }
  return fallback;
}

function selectUnityEventMethod(candidates: Node[], mode: unknown): Node | null {
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) return null;

  const expectedType =
    mode === 1 ? 'void' :
    mode === 2 ? 'UnityEngine.Object' :
    mode === 3 ? 'int' :
    mode === 4 ? 'float' :
    mode === 5 ? 'string' :
    mode === 6 ? 'bool' :
    null;
  if (!expectedType) return null;

  const matches = candidates.filter((candidate) => {
    const parameters = signatureParameters(candidate.signature);
    if (expectedType === 'void') return parameters.length === 0;
    return parameters.length === 1 && parameters[0]!.includes(expectedType);
  });
  return matches.length === 1 ? matches[0]! : null;
}

function signatureParameters(signature: string | undefined): string[] {
  if (!signature) return [];
  const match = /\((.*)\)/.exec(signature);
  if (!match || match[1]!.trim() === '') return [];
  return match[1]!.split(',').map((value) => value.trim());
}

function unityFileIdKey(value: unknown): string | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return null;
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

function missingAssetNode(
  guid: string,
  fileId: string | null,
  filePath: string
): Node {
  const guidKey = String(guid);
  const localFileId = fileId ?? '0';
  return {
    id: generateNodeId(`unity-guid:${guidKey}`, 'unity_asset', localFileId, 1),
    kind: 'unity_asset',
    name: fileId
      ? `Missing object ${guidKey.slice(0, 8)}:${fileId}`
      : `Missing asset ${guidKey.slice(0, 8)}`,
    qualifiedName: `unity-missing::${guidKey}:${localFileId}`,
    filePath,
    language: 'unity_asset',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}
