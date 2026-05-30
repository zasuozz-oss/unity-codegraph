// Graph model — inlined from GitNexus's gitnexus-shared (web no longer depends on it).
export type NodeLabel =
  | 'Project' | 'Package' | 'Module' | 'Folder' | 'File'
  | 'Class' | 'Function' | 'Method' | 'Variable' | 'Interface'
  | 'Enum' | 'Decorator' | 'Import' | 'Type' | 'CodeElement'
  | 'Community' | 'Process' | 'Struct' | 'Macro' | 'Typedef'
  | 'Union' | 'Namespace' | 'Trait' | 'Impl' | 'TypeAlias'
  | 'Const' | 'Static' | 'Property' | 'Record' | 'Delegate'
  | 'Annotation' | 'Constructor' | 'Template' | 'Section' | 'Route' | 'Tool';

export interface NodeProperties {
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface GraphNode {
  id: string;
  label: NodeLabel;
  properties: NodeProperties;
}

export interface GraphRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  confidence: number;
  reason: string;
}

// In-memory graph container consumed by the graph adapter.
export interface KnowledgeGraph {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  nodeCount: number;
  relationshipCount: number;
}

export interface NodeDetail {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  docstring: string | null;
  source: string | null;
}
