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

const FILE_KIND: Record<string, Node['kind']> = {
  '.prefab': 'unity_prefab',
  '.unity': 'unity_scene',
  '.asset': 'unity_asset',
  '.png': 'unity_image',
  '.jpg': 'unity_image',
  '.jpeg': 'unity_image',
  '.tga': 'unity_image',
  '.psd': 'unity_image',
  '.webp': 'unity_image',
  '.bmp': 'unity_image',
  '.tif': 'unity_image',
  '.tiff': 'unity_image',
  '.spriteatlas': 'unity_sprite',
  '.spriteatlasv2': 'unity_sprite',
  '.json': 'unity_json',
  '.inputactions': 'unity_json',
  '.txt': 'unity_text',
  '.text': 'unity_text',
  '.bytes': 'unity_text',
  '.csv': 'unity_text',
};

type UnityFileId = string | number | bigint;

function unityFileIdKey(value: unknown): string | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return null;
}

function isRef(value: any): value is { fileID: UnityFileId; guid?: string; type?: number } {
  return value && typeof value === 'object' && unityFileIdKey(value.fileID) !== null;
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

function collectUnityObjectRefs(
  value: any,
  refs: Array<{ fieldPath: string; guid: string; fileID: string }> = [],
  fieldPath = ''
): Array<{ fieldPath: string; guid: string; fileID: string }> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnityObjectRefs(item, refs, `${fieldPath}[${index}]`));
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;

  const fileID = isRef(value) ? unityFileIdKey(value.fileID) : null;
  if (fileID && value.guid && fileID !== '0') {
    refs.push({ fieldPath, guid: value.guid, fileID });
    return refs;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = fieldPath ? `${fieldPath}.${key}` : key;
    collectUnityObjectRefs(child, refs, nextPath);
  }
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
    const fileNode = mkNode(this.filePath, fileKind, fileName, 1, '0');
    const goNodeByFileId = new Map<string, Node>();
    const componentNodeByFileId = new Map<string, Node>();

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

    for (const doc of docs.filter((d) => d.classId !== 1)) {
      const className = unityClassName(doc.body);
      const body = className ? doc.body[className] ?? {} : {};
      if (!isRef(body.m_GameObject)) continue;
      const ownerFileId = unityFileIdKey(body.m_GameObject.fileID);
      if (!ownerFileId) continue;
      const owner = goNodeByFileId.get(ownerFileId);
      const isStandaloneObject = doc.classId === 114 && ownerFileId === '0';
      const ownerName =
        owner?.name ??
        (typeof body.m_Name === 'string' && body.m_Name.length > 0
          ? body.m_Name
          : fileName);
      const componentType = unityComponentType(className, body);

      const component = mkNode(
        this.filePath,
        'unity_component',
        owner || isStandaloneObject
          ? `${ownerName} / ${componentType}`
          : `${componentType}_${doc.fileId}`,
        doc.line,
        doc.fileId
      );
      nodes.push(component);
      componentNodeByFileId.set(doc.fileId, component);

      if (owner) {
        edges.push(
          unityEdge(owner.id, component.id, 'contains', 'gameobject_has_component', {
            ownerFileId,
            componentClassId: doc.classId,
            componentType: className,
          })
        );
      } else if (isStandaloneObject) {
        edges.push(
          unityEdge(fileNode.id, component.id, 'contains', 'asset_contains_object', {
            childFileId: doc.fileId,
            componentClassId: doc.classId,
            componentType,
          })
        );
      }

      const correspondingSource = body.m_CorrespondingSourceObject;
      if (isRef(correspondingSource) && correspondingSource.guid) {
        const fileID = unityFileIdKey(correspondingSource.fileID);
        if (fileID && fileID !== '0') {
          unityRawEdges.push(
            rawUnityEdge(
              this.filePath,
              component.id,
              'references',
              'prefab_object_instance_of',
              { guid: correspondingSource.guid, fileID }
            )
          );
        }
      }

      for (const [fieldName, value] of Object.entries(body)) {
        if (fieldName === 'm_GameObject' || fieldName === 'm_Script') continue;
        for (const ref of collectUnityObjectRefs(value, [], fieldName)) {
          unityRawEdges.push(
            rawUnityEdge(this.filePath, component.id, 'references', 'component_references_asset', ref)
          );
        }
      }
    }

    const transformOwnerByFileId = new Map<string, string>();
    for (const doc of docs) {
      const className = unityClassName(doc.body);
      const body = className ? doc.body[className] ?? {} : {};
      const ownerFileId = isRef(body.m_GameObject)
        ? unityFileIdKey(body.m_GameObject.fileID)
        : null;
      if (ownerFileId && isRef(body.m_Father)) {
        transformOwnerByFileId.set(doc.fileId, ownerFileId);
      }
    }
    for (const doc of docs) {
      const className = unityClassName(doc.body);
      const body = className ? doc.body[className] ?? {} : {};
      if (!isRef(body.m_Father)) continue;
      const parentTransformFileId = unityFileIdKey(body.m_Father.fileID);
      const childGameObjectFileId = transformOwnerByFileId.get(doc.fileId);
      if (!parentTransformFileId || parentTransformFileId === '0' || !childGameObjectFileId) {
        continue;
      }
      const parentGameObjectFileId = transformOwnerByFileId.get(parentTransformFileId);
      const parent = parentGameObjectFileId
        ? goNodeByFileId.get(parentGameObjectFileId)
        : undefined;
      const child = goNodeByFileId.get(childGameObjectFileId);
      if (parent && child) {
        edges.push(
          unityEdge(parent.id, child.id, 'contains', 'transform_parent_of', {
            parentTransformFileId,
            childGameObjectFileId,
          })
        );
      }
    }

    for (const doc of docs.filter((d) => d.classId === 114)) {
      const monoBehaviour = doc.body.MonoBehaviour ?? {};
      const component = componentNodeByFileId.get(doc.fileId);
      if (!component) continue;

      if (isRef(monoBehaviour.m_Script) && monoBehaviour.m_Script.guid) {
        const fileID = unityFileIdKey(monoBehaviour.m_Script.fileID);
        if (!fileID) continue;
        unityRawEdges.push(
          rawUnityEdge(this.filePath, component.id, 'references', 'component_uses_script', {
            guid: monoBehaviour.m_Script.guid,
            fileID,
          })
        );
      }

      for (const [fieldName, value] of Object.entries(monoBehaviour)) {
        if (fieldName === 'm_Script' || fieldName === 'm_GameObject') continue;
        for (const call of getPersistentCalls(value)) {
          const target = call?.m_Target;
          const methodName = call?.m_MethodName;
          if (isRef(target) && typeof methodName === 'string' && methodName.length > 0) {
            const fileID = unityFileIdKey(target.fileID);
            if (!fileID || fileID === '0') continue;
            unityRawEdges.push(
              rawUnityEdge(this.filePath, component.id, 'references', 'unity_event_calls_method', {
                fieldName,
                guid: typeof target.guid === 'string' ? target.guid : undefined,
                fileID,
                methodName,
                mode: call?.m_Mode,
                targetAssemblyTypeName: call?.m_TargetAssemblyTypeName,
              })
            );
          }
        }
        if (isRef(value)) {
          const fileID = unityFileIdKey(value.fileID);
          if (!fileID || !value.guid || fileID === '0') continue;
          unityRawEdges.push(
            rawUnityEdge(
              this.filePath,
              component.id,
              'references',
              'serialized_field_references_asset',
              { fieldName, guid: value.guid, fileID }
            )
          );
        }
      }
    }

    for (const doc of docs.filter((d) => d.classId === 1001)) {
      const prefabInstance = doc.body.PrefabInstance ?? {};
      const sourcePrefab = prefabInstance.m_SourcePrefab;
      if (isRef(sourcePrefab) && sourcePrefab.guid) {
        unityRawEdges.push(
          rawUnityEdge(this.filePath, fileNode.id, 'references', 'prefab_instance_of', {
            guid: sourcePrefab.guid,
            fileID: unityFileIdKey(sourcePrefab.fileID) ?? undefined,
          })
        );
      }

      const overrides = new Map<
        string,
        {
          sourceComponentGuid: string;
          sourceComponentFileID: string;
          target?: { fileID: string; guid?: string };
          methodName?: string;
          mode?: number;
          propertyPath: string;
        }
      >();
      const modifications = prefabInstance.m_Modification?.m_Modifications;
      if (!Array.isArray(modifications)) continue;

      for (const modification of modifications) {
        const sourceComponent = modification?.target;
        const propertyPath = modification?.propertyPath;
        if (
          !isRef(sourceComponent) ||
          !sourceComponent.guid ||
          typeof propertyPath !== 'string'
        ) {
          continue;
        }
        const match =
          /m_Calls\.Array\.data\[(\d+)\]\.(m_Target|m_MethodName|m_Mode)$/.exec(
            propertyPath
          );
        if (!match) continue;

        const sourceComponentFileID = unityFileIdKey(sourceComponent.fileID);
        if (!sourceComponentFileID) continue;
        const key = `${sourceComponent.guid}:${sourceComponentFileID}:${match[1]}`;
        const override = overrides.get(key) ?? {
          sourceComponentGuid: sourceComponent.guid,
          sourceComponentFileID,
          propertyPath,
        };

        if (match[2] === 'm_Target' && isRef(modification.objectReference)) {
          const fileID = unityFileIdKey(modification.objectReference.fileID);
          if (fileID && fileID !== '0') {
            override.target = {
              fileID,
              guid:
                typeof modification.objectReference.guid === 'string'
                  ? modification.objectReference.guid
                  : undefined,
            };
          }
        } else if (match[2] === 'm_MethodName' && typeof modification.value === 'string') {
          override.methodName = modification.value;
        } else if (match[2] === 'm_Mode') {
          const mode = Number(modification.value);
          if (Number.isFinite(mode)) override.mode = mode;
        }
        overrides.set(key, override);
      }

      for (const override of overrides.values()) {
        if (!override.target || !override.methodName) continue;
        unityRawEdges.push(
          rawUnityEdge(
            this.filePath,
            fileNode.id,
            'references',
            'unity_event_calls_method',
            {
              guid: override.target.guid,
              fileID: override.target.fileID,
              methodName: override.methodName,
              mode: override.mode,
              sourceComponentGuid: override.sourceComponentGuid,
              sourceComponentFileID: override.sourceComponentFileID,
              propertyPath: override.propertyPath,
            }
          )
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
  fileId: string
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

function unityClassName(body: Record<string, any>): string | null {
  for (const [key, value] of Object.entries(body)) {
    if (value && typeof value === 'object') return key;
  }
  return null;
}

function unityComponentType(
  className: string | null,
  body: Record<string, any>
): string {
  const identifier = body.m_EditorClassIdentifier;
  if (className === 'MonoBehaviour' && typeof identifier === 'string' && identifier.length > 0) {
    const typeName = identifier.includes('::')
      ? identifier.slice(identifier.lastIndexOf('::') + 2)
      : identifier;
    return typeName.slice(typeName.lastIndexOf('.') + 1) || 'MonoBehaviour';
  }
  return className ?? 'Component';
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
