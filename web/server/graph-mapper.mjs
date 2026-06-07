// --- codegraph kind -> dashboard NodeLabel ---
export const KIND_TO_LABEL = {
  file: 'File', module: 'Module', namespace: 'Namespace',
  class: 'Class', struct: 'Struct', interface: 'Interface', trait: 'Trait',
  protocol: 'Interface', enum: 'Enum', enum_member: 'CodeElement',
  function: 'Function', method: 'Method', property: 'Property', field: 'Property',
  variable: 'Variable', constant: 'Const', parameter: 'CodeElement',
  type_alias: 'TypeAlias', import: 'Import', export: 'CodeElement',
  route: 'Route', component: 'Class',
  unity_scene: 'UnityScene', unity_prefab: 'UnityPrefab', unity_asset: 'UnityAsset',
  unity_image: 'UnityImage', unity_json: 'UnityJson', unity_text: 'UnityText',
  unity_sprite: 'UnitySprite',
  unity_gameobject: 'UnityGameObject', unity_component: 'UnityComponent',
  unity_script: 'File',
};

export function isHiddenNodeRow(row) {
  return typeof row.file_path === 'string' && row.file_path.endsWith('.meta');
}

export function mapNodeRow(row) {
  return {
    id: row.id,
    label: KIND_TO_LABEL[row.kind] || 'CodeElement',
    properties: {
      name: row.name,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      language: row.language,
      kind: row.kind,
    },
  };
}
