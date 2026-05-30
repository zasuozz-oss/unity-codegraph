import { useEffect, useMemo, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Focus, RotateCcw, Play, Pause } from 'lucide-react';
import Graph from 'graphology';
import { useSigma } from '../hooks/useSigma';
import {
  knowledgeGraphToGraphology,
  filterGraphByDepth,
  SigmaNodeAttributes,
  SigmaEdgeAttributes,
} from '../lib/graph-adapter';
import type { KnowledgeGraph, GraphNode, NodeLabel } from '../types';
import type { EdgeType } from '../lib/constants';

interface Props {
  graph: KnowledgeGraph;
  visibleLabels: NodeLabel[];
  visibleEdgeTypes: EdgeType[];
  depthFilter: number | null;
  onSelect: (node: GraphNode | null) => void;
  selectedNode: GraphNode | null;
}

export function GraphCanvas({
  graph, visibleLabels, visibleEdgeTypes, depthFilter, onSelect, selectedNode,
}: Props) {
  const [hoveredName, setHoveredName] = useState<string | null>(null);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const node = nodeById.get(nodeId);
      if (node) onSelect(node);
    },
    [nodeById, onSelect],
  );

  const handleNodeHover = useCallback(
    (nodeId: string | null) => {
      setHoveredName(nodeId ? nodeById.get(nodeId)?.properties.name ?? null : null);
    },
    [nodeById],
  );

  const {
    containerRef, sigmaRef, setGraph: setSigmaGraph,
    zoomIn, zoomOut, resetZoom, focusNode,
    isLayoutRunning, startLayout, stopLayout,
    selectedNode: sigmaSelectedNode, setSelectedNode: setSigmaSelectedNode,
  } = useSigma({
    onNodeClick: handleNodeClick,
    onNodeHover: handleNodeHover,
    onStageClick: () => onSelect(null),
    visibleEdgeTypes,
  });

  // Rebuild sigma graph when knowledge graph changes
  useEffect(() => {
    if (!graph.nodes.length) return;
    setSigmaGraph(knowledgeGraphToGraphology(graph));
  }, [graph, setSigmaGraph]);

  // Apply label/depth filters
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const g = sigma.getGraph() as Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
    if (g.order === 0) return;
    filterGraphByDepth(g, selectedNode?.id ?? null, depthFilter, visibleLabels);
    sigma.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLabels, depthFilter, selectedNode]);

  // Sync external selection into sigma
  useEffect(() => {
    setSigmaSelectedNode(selectedNode?.id ?? null);
  }, [selectedNode, setSigmaSelectedNode]);

  return (
    <div className="canvas-root">
      <div className="canvas-bg" />
      <div ref={containerRef} className="sigma-container" />

      {hoveredName && !sigmaSelectedNode && (
        <div className="hover-pill">{hoveredName}</div>
      )}

      {selectedNode && (
        <div className="select-pill">
          <span className="dot" />
          <span className="name">{selectedNode.properties.name}</span>
          <span className="muted">({selectedNode.label})</span>
          <button onClick={() => { onSelect(null); resetZoom(); }}>Clear</button>
        </div>
      )}

      <div className="controls">
        <button onClick={zoomIn} title="Zoom In"><ZoomIn size={16} /></button>
        <button onClick={zoomOut} title="Zoom Out"><ZoomOut size={16} /></button>
        <button onClick={resetZoom} title="Fit"><Maximize2 size={16} /></button>
        <div className="divider" />
        {selectedNode && (
          <button className="accent" onClick={() => focusNode(selectedNode.id)} title="Focus selected">
            <Focus size={16} />
          </button>
        )}
        {selectedNode && (
          <button onClick={() => { onSelect(null); resetZoom(); }} title="Clear">
            <RotateCcw size={16} />
          </button>
        )}
        <div className="divider" />
        <button
          className={isLayoutRunning ? 'running' : ''}
          onClick={isLayoutRunning ? stopLayout : startLayout}
          title={isLayoutRunning ? 'Stop layout' : 'Run layout'}
        >
          {isLayoutRunning ? <Pause size={16} /> : <Play size={16} />}
        </button>
      </div>

      {isLayoutRunning && <div className="layout-indicator">Layout optimizing…</div>}
    </div>
  );
}
