import { Edge, ExtractionResult, Node } from '../../types';
import { generateNodeId } from '../tree-sitter-helpers';
import { parseUnityYaml } from './unity-yaml-parser';

export interface RawUnityEdge extends Omit<Edge, 'source' | 'target'> {
  source?: string;
  target?: string;
  filePath: string;
}

export interface UnityAssetExtractionResult extends ExtractionResult {
  unityRawEdges: RawUnityEdge[];
}

const FILE_KIND: Record<string, 'unity_prefab' | 'unity_scene' | 'unity_asset'> = {
  '.prefab': 'unity_prefab',
  '.unity': 'unity_scene',
  '.asset': 'unity_asset',
};

function isRef(value: any): value is { fileID: number; guid?: string; type?: number } {
  return value && typeof value === 'object' && typeof value.fileID === 'number';
}

function getPersistentCalls(value: any): any[] {
  const calls = value?.m_PersistentCalls?.m_Calls;
  return Array.isArray(calls) ? calls : [];
}

function collectAddressableRefs(value: any, refs: Array<{ guid: string; address?: string }> = []): Array<{ guid: string; address?: string }> {
  if (Array.isArray(value)) {
    for (const item of value) collectAddressableRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;

  if (typeof value.m_GUID === 'string' && value.m_GUID.length > 0) {
    refs.push({
      guid: value.m_GUID,
      address: typeof value.m_Address === 'string' ? value.m_Address : undefined,
    });
  }
  for (const child of Object.values(value)) collectAddressableRefs(child, refs);
  return refs;
}

export class UnityAssetExtractor {
  constructor(private filePath: string, private source: string) {}

  extract(): UnityAssetExtractionResult {
    const start = Date.now();
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const unityRawEdges: RawUnityEdge[] = [];
    const docs = parseUnityYaml(this.source);
    const dot = this.filePath.lastIndexOf('.');
    const ext = dot >= 0 ? this.filePath.slice(dot).toLowerCase() : '';
    const fileKind = FILE_KIND[ext] ?? 'unity_asset';
    const fileName = this.filePath.split(/[/\\]/).pop() || this.filePath;
    const fileNode = mkNode(this.filePath, fileKind, fileName, 1, docs.length);
    const goNodeByFileId = new Map<number, Node>();

    nodes.push(fileNode);

    for (const doc of docs.filter((d) => d.classId === 1)) {
      const gameObject = doc.body.GameObject ?? {};
      const node = mkNode(
        this.filePath,
        'unity_gameobject',
        gameObject.m_Name ?? `GameObject_${doc.fileId}`,
        doc.line,
        doc.fileId
      );
      nodes.push(node);
      goNodeByFileId.set(doc.fileId, node);
      edges.push(
        unityEdge(
          fileNode.id,
          node.id,
          'contains',
          fileKind === 'unity_scene' ? 'scene_contains_gameobject' : 'prefab_contains_gameobject',
          { childFileId: doc.fileId }
        )
      );
    }

    for (const doc of docs.filter((d) => d.classId === 114)) {
      const monoBehaviour = doc.body.MonoBehaviour ?? {};
      const component = mkNode(
        this.filePath,
        'unity_component',
        `Component_${doc.fileId}`,
        doc.line,
        doc.fileId
      );
      nodes.push(component);

      if (isRef(monoBehaviour.m_GameObject)) {
        const owner = goNodeByFileId.get(monoBehaviour.m_GameObject.fileID);
        if (owner) {
          edges.push(
            unityEdge(owner.id, component.id, 'contains', 'gameobject_has_component', {
              ownerFileId: monoBehaviour.m_GameObject.fileID,
            })
          );
        }
      }

      if (isRef(monoBehaviour.m_Script) && monoBehaviour.m_Script.guid) {
        unityRawEdges.push(
          rawUnityEdge(this.filePath, component.id, 'references', 'component_uses_script', {
            guid: monoBehaviour.m_Script.guid,
            fileID: monoBehaviour.m_Script.fileID,
          })
        );
      }

      for (const [fieldName, value] of Object.entries(monoBehaviour)) {
        if (fieldName === 'm_Script' || fieldName === 'm_GameObject') continue;
        for (const call of getPersistentCalls(value)) {
          const target = call?.m_Target;
          const methodName = call?.m_MethodName;
          if (isRef(target) && target.guid && typeof methodName === 'string' && methodName.length > 0) {
            unityRawEdges.push(
              rawUnityEdge(this.filePath, component.id, 'references', 'unity_event_calls_method', {
                fieldName,
                guid: target.guid,
                fileID: target.fileID,
                methodName,
                mode: call?.m_Mode,
              })
            );
          }
        }
        if (isRef(value) && value.guid && value.fileID !== 0) {
          unityRawEdges.push(
            rawUnityEdge(
              this.filePath,
              component.id,
              'references',
              'serialized_field_references_asset',
              { fieldName, guid: value.guid, fileID: value.fileID }
            )
          );
        }
      }
    }

    for (const doc of docs.filter((d) => d.classId === 1001)) {
      const sourcePrefab = doc.body.PrefabInstance?.m_SourcePrefab;
      if (isRef(sourcePrefab) && sourcePrefab.guid) {
        unityRawEdges.push(
          rawUnityEdge(this.filePath, fileNode.id, 'references', 'scene_references_prefab', {
            guid: sourcePrefab.guid,
          })
        );
      }
    }

    const seenAddressables = new Set<string>();
    for (const doc of docs) {
      for (const ref of collectAddressableRefs(doc.body)) {
        const key = `${ref.guid}:${ref.address ?? ''}`;
        if (seenAddressables.has(key)) continue;
        seenAddressables.add(key);
        unityRawEdges.push(
          rawUnityEdge(this.filePath, fileNode.id, 'references', 'addressable_references_asset', {
            guid: ref.guid,
            address: ref.address,
          })
        );
      }
    }

    return {
      nodes,
      edges,
      unityRawEdges,
      unresolvedReferences: [],
      errors: [],
      durationMs: Date.now() - start,
    };
  }
}

function mkNode(
  filePath: string,
  kind: Node['kind'],
  name: string,
  line: number,
  fileId: number
): Node {
  return {
    id: generateNodeId(filePath, kind, name, line),
    kind,
    name,
    qualifiedName: `${filePath}::${fileId}`,
    filePath,
    language: 'unity_asset',
    startLine: line,
    endLine: line,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
  };
}

function unityEdge(
  source: string,
  target: string,
  kind: Edge['kind'],
  unityRelation: string,
  extra: Record<string, unknown>
): Edge {
  return { source, target, kind, provenance: 'unity', metadata: { unityRelation, ...extra } };
}

function rawUnityEdge(
  filePath: string,
  source: string,
  kind: Edge['kind'],
  unityRelation: string,
  extra: Record<string, unknown>
): RawUnityEdge {
  return { filePath, source, kind, provenance: 'unity', metadata: { unityRelation, ...extra } };
}
