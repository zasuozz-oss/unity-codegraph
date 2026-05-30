import type { KnowledgeGraph, GraphNode, GraphRelationship, NodeDetail } from '../types';

export interface Project {
  name: string;
  path: string;
  dbPath: string;
  nodes: number;
  edges: number;
  lastInitAt: number;
  error?: boolean;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`GET /api/projects -> ${res.status}`);
  const data = (await res.json()) as { projects: Project[] };
  return data.projects;
}

export async function deleteProject(projectPath: string): Promise<void> {
  const res = await fetch(`/api/projects?project=${encodeURIComponent(projectPath)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`DELETE /api/projects -> ${res.status}`);
}

export async function fetchGraph(
  projectPath: string,
  opts: { imports?: boolean } = {},
): Promise<KnowledgeGraph> {
  const params = new URLSearchParams({ project: projectPath });
  if (opts.imports) params.set('imports', '1');
  const res = await fetch(`/api/graph?${params}`);
  if (!res.ok) throw new Error(`GET /api/graph -> ${res.status}`);
  const data = (await res.json()) as { nodes: GraphNode[]; relationships: GraphRelationship[] };
  return {
    nodes: data.nodes,
    relationships: data.relationships,
    nodeCount: data.nodes.length,
    relationshipCount: data.relationships.length,
  };
}

export async function fetchNode(projectPath: string, id: string): Promise<NodeDetail> {
  const params = new URLSearchParams({ project: projectPath });
  const res = await fetch(`/api/node/${encodeURIComponent(id)}?${params}`);
  if (!res.ok) throw new Error(`GET /api/node -> ${res.status}`);
  return (await res.json()) as NodeDetail;
}
