import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { GraphCanvas } from './components/GraphCanvas';
import { ProjectLanding } from './components/ProjectLanding';
import { fetchProjects, fetchGraph, fetchNode, deleteProject, type Project } from './lib/api';
import {
  DEFAULT_VISIBLE_LABELS, DEFAULT_VISIBLE_EDGES, ALL_EDGE_TYPES,
  NODE_COLORS, EDGE_INFO, type EdgeType,
} from './lib/constants';
import type { KnowledgeGraph, GraphNode, NodeLabel, NodeDetail } from './types';

export default function App() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [current, setCurrent] = useState<Project | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<EdgeType[]>(DEFAULT_VISIBLE_EDGES);
  const [visibleLabels, setVisibleLabels] = useState<NodeLabel[]>(DEFAULT_VISIBLE_LABELS);

  const loadProjects = useCallback(() => {
    fetchProjects().then(setProjects).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const openProject = useCallback((p: Project) => {
    setCurrent(p);
    setGraph(null);
    setSelected(null);
    setError(null);
    setLoadingGraph(true);
    fetchGraph(p.path)
      .then(setGraph)
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingGraph(false));
  }, []);

  const backToProjects = useCallback(() => {
    setCurrent(null);
    setGraph(null);
    setSelected(null);
    loadProjects();
  }, [loadProjects]);

  const handleDelete = useCallback(
    (p: Project) => {
      deleteProject(p.path)
        .then(() => { if (current?.path === p.path) backToProjects(); else loadProjects(); })
        .catch((e) => setError(String(e)));
    },
    [current, backToProjects, loadProjects],
  );

  useEffect(() => {
    if (!selected || !current) { setDetail(null); return; }
    setDetail(null);
    fetchNode(current.path, selected.id).then(setDetail).catch(() => setDetail(null));
  }, [selected, current]);

  const labelCounts = useMemo(() => {
    const m = new Map<string, number>();
    graph?.nodes.forEach((n) => m.set(n.label, (m.get(n.label) ?? 0) + 1));
    return m;
  }, [graph]);

  const toggleEdge = (t: EdgeType) =>
    setVisibleEdgeTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );

  const toggleLabel = (label: NodeLabel) =>
    setVisibleLabels((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );

  // --- Landing view ---
  if (!current) {
    if (error) return <div className="fullscreen err">Error: {error}<br />Server chạy chưa? (npm run server)</div>;
    if (!projects) return <div className="fullscreen">Loading projects…</div>;
    return (
      <ProjectLanding
        projects={projects}
        onOpen={openProject}
        onDelete={handleDelete}
        onRefresh={loadProjects}
      />
    );
  }

  // --- Graph view ---
  return (
    <div className="app">
      <header className="topbar">
        <button className="back-btn" onClick={backToProjects} title="Back to projects">
          <ChevronLeft size={16} /> Projects
        </button>
        <select
          className="project-select"
          value={current.path}
          title={current.path}
          onChange={(e) => {
            const next = (projects ?? []).find((p) => p.path === e.target.value);
            if (next && next.path !== current.path) openProject(next);
          }}
        >
          {(projects ?? [current]).map((p) => (
            <option key={p.path} value={p.path}>
              {p.name} ({p.nodes.toLocaleString()} nodes)
            </option>
          ))}
        </select>
        {graph && (
          <span className="muted">{graph.nodeCount.toLocaleString()} nodes · {graph.relationshipCount.toLocaleString()} edges</span>
        )}
        <div className="legend">
          {[...labelCounts.entries()]
            .filter(([l]) => visibleLabels.includes(l as NodeLabel))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([label, n]) => (
              <span key={label} className="legend-item">
                <span className="swatch" style={{ background: NODE_COLORS[label as NodeLabel] }} />
                {label} <span className="muted">{n}</span>
              </span>
            ))}
        </div>
      </header>

      <div className="edge-bar">
        {[...labelCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, n]) => (
            <button
              key={label}
              className={`node-toggle ${visibleLabels.includes(label as NodeLabel) ? 'on' : ''}`}
              style={{ borderColor: NODE_COLORS[label as NodeLabel] ?? NODE_COLORS.CodeElement }}
              onClick={() => toggleLabel(label as NodeLabel)}
            >
              <span className="swatch" style={{ background: NODE_COLORS[label as NodeLabel] ?? NODE_COLORS.CodeElement }} />
              {label} <span className="muted">{n}</span>
            </button>
          ))}
      </div>

      <div className="edge-bar">
        {ALL_EDGE_TYPES.map((t) => (
          <button
            key={t}
            className={`edge-toggle ${visibleEdgeTypes.includes(t) ? 'on' : ''}`}
            style={{ borderColor: EDGE_INFO[t].color }}
            onClick={() => toggleEdge(t)}
          >
            <span className="swatch" style={{ background: EDGE_INFO[t].color }} />
            {EDGE_INFO[t].label}
          </button>
        ))}
      </div>

      <main className="stage">
        {error && <div className="fullscreen err">Error: {error}</div>}
        {!error && loadingGraph && <div className="fullscreen">Loading graph…</div>}
        {!error && graph && (
          <GraphCanvas
            graph={graph}
            visibleLabels={visibleLabels}
            visibleEdgeTypes={visibleEdgeTypes}
            depthFilter={null}
            onSelect={setSelected}
            selectedNode={selected}
          />
        )}

        {selected && (
          <aside className="detail-panel">
            <div className="detail-head">
              <span className="swatch" style={{ background: NODE_COLORS[selected.label] }} />
              <strong>{selected.properties.name}</strong>
              <button className="close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="detail-meta">
              <div><span className="muted">label</span> {selected.label}</div>
              <div><span className="muted">kind</span> {String(selected.properties.kind)}</div>
              <div><span className="muted">lang</span> {String(selected.properties.language)}</div>
              <div className="path"><span className="muted">file</span> {selected.properties.filePath}:{selected.properties.startLine}</div>
            </div>
            {detail?.signature && <pre className="sig">{detail.signature}</pre>}
            {detail?.source
              ? <pre className="source">{detail.source}</pre>
              : <div className="muted small">No source preview.</div>}
          </aside>
        )}
      </main>
    </div>
  );
}
