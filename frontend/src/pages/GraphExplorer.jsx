import { useState, useEffect, useCallback } from 'react';
import { SigmaContainer, useLoadGraph, useSigma } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import Graph from 'graphology';
import { getGraphData, getSubgraph, searchGraph } from '../services/api';
import Icon from '../components/Icon';

function LoadGraphComponent({ graphData }) {
  const loadGraph = useLoadGraph();

  useEffect(() => {
    if (!graphData || !graphData.nodes) return;

    const graph = new Graph();

    graphData.nodes.forEach(node => {
      try {
        graph.addNode(node.id, {
          x: node.x || Math.random() * 1000,
          y: node.y || Math.random() * 1000,
          size: node.size || 5,
          label: node.label || node.id,
          color: node.color || '#5fd4d0',
          node_type: node.node_type,
          risk_tier: node.risk_tier,
          anomaly_score: node.anomaly_score,
        });
      } catch (e) { /* duplicate node */ }
    });

    graphData.edges.forEach(edge => {
      try {
        if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
          graph.addEdge(edge.source, edge.target, {
            color: edge.color || '#262c36',
            size: Math.max(0.5, (edge.weight || 1) * 0.3),
            edge_type: edge.edge_type,
          });
        }
      } catch (e) { /* duplicate edge */ }
    });

    loadGraph(graph);
  }, [graphData, loadGraph]);

  return null;
}

function GraphEvents({ onNodeClick }) {
  const sigma = useSigma();

  useEffect(() => {
    const handler = (event) => {
      const node = event.node;
      const attrs = sigma.getGraph().getNodeAttributes(node);
      onNodeClick({ id: node, ...attrs });
    };
    sigma.on('clickNode', handler);
    return () => sigma.off('clickNode', handler);
  }, [sigma, onNodeClick]);

  return null;
}

export default function GraphExplorer() {
  const [graphData, setGraphData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getGraphData({ layout: 'spring', max_nodes: 1500 })
      .then(res => setGraphData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = useCallback(async (q) => {
    setSearchQuery(q);
    if (q.length < 3) { setSearchResults([]); return; }
    try {
      const res = await searchGraph(q);
      setSearchResults(res.data || []);
    } catch (e) { setSearchResults([]); }
  }, []);

  const handleNodeFocus = useCallback(async (entityId) => {
    try {
      const res = await getSubgraph(entityId, 2);
      setGraphData(res.data);
      setSearchResults([]);
      setSearchQuery('');
    } catch (e) {}
  }, []);

  const handleReset = useCallback(() => {
    setLoading(true);
    setSelectedNode(null);
    getGraphData({ layout: 'spring', max_nodes: 1500 })
      .then(res => setGraphData(res.data))
      .finally(() => setLoading(false));
  }, []);

  const riskLegend = [
    { color: '#ef4444', label: 'Critical' },
    { color: '#f0883e', label: 'High' },
    { color: '#e0b23c', label: 'Elevated' },
    { color: '#5fd4d0', label: 'Wallet' },
    { color: '#b28ee0', label: 'IP' },
    { color: '#6b7280', label: 'Transaction' },
  ];

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  return (
    <div style={{ height: 'calc(100vh - var(--topbar-height) - var(--statusbar-height))', position: 'relative' }}>
      {/* Controls */}
      <div className="graph-controls">
        <div className="search-bar" style={{ width: 260, background: 'var(--bg-secondary)' }}>
          <Icon name="search" size={14} style={{ opacity: 0.5 }} />
          <input
            type="text" placeholder="Search node..."
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>

        {searchResults.length > 0 && (
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)', maxHeight: 200, overflow: 'auto'
          }}>
            {searchResults.map(r => (
              <div
                key={r.id}
                onClick={() => handleNodeFocus(r.id)}
                style={{
                  padding: '6px 12px', cursor: 'pointer', fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border-primary)',
                }}
                onMouseEnter={e => e.target.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.target.style.background = 'transparent'}
              >
                <span className={`badge ${r.risk_tier?.toLowerCase() || 'info'}`} style={{ marginRight: 8 }}>
                  {r.node_type}
                </span>
                {r.id.length > 24 ? `${r.id.slice(0, 12)}...${r.id.slice(-8)}` : r.id}
              </div>
            ))}
          </div>
        )}

        <button className="btn btn-outline" onClick={handleReset} style={{ fontSize: 'var(--text-xs)' }}>
          <Icon name="rotateCcw" size={13} /> Reset View
        </button>

        <div className="graph-legend">
          {riskLegend.map(l => (
            <div key={l.label} className="legend-item">
              <div className="legend-dot" style={{ background: l.color }} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sigma.js Canvas */}
      <SigmaContainer
        style={{
          height: '100%', width: '100%', background: 'var(--bg-primary)',
          backgroundImage: 'radial-gradient(circle, #171b21 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
        settings={{
          defaultNodeColor: '#5fd4d0',
          defaultEdgeColor: '#262c36',
          labelColor: { color: '#a9b0bb' },
          labelFont: 'IBM Plex Sans',
          labelSize: 10,
          renderEdgeLabels: false,
          enableEdgeEvents: false,
          zIndex: true,
        }}
      >
        <LoadGraphComponent graphData={graphData} />
        <GraphEvents onNodeClick={setSelectedNode} />
      </SigmaContainer>

      {/* Selected Node Panel */}
      {selectedNode && (
        <div className="graph-sidebar slide-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
            <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>Node Details</h3>
            <span
              style={{ cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
              onClick={() => setSelectedNode(null)}
            ><Icon name="close" size={16} /></span>
          </div>

          <div style={{ marginBottom: 'var(--space-md)' }}>
            <span className={`badge ${selectedNode.node_type === 'wallet' ? 'info' : selectedNode.node_type === 'ip' ? 'purple' : ''}`}>
              {selectedNode.node_type?.toUpperCase()}
            </span>
            {selectedNode.risk_tier && (
              <span className={`badge ${selectedNode.risk_tier.toLowerCase()}`} style={{ marginLeft: 6 }}>
                {selectedNode.risk_tier}
              </span>
            )}
          </div>

          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)', wordBreak: 'break-all',
            background: 'var(--bg-tertiary)', padding: 'var(--space-md)',
            borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)',
          }}>
            {selectedNode.id}
          </div>

          {selectedNode.anomaly_score > 0 && (
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>ANOMALY SCORE</span>
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: selectedNode.anomaly_score >= 90 ? 'var(--accent-critical)' : selectedNode.anomaly_score >= 70 ? 'var(--accent-high)' : 'var(--accent-elevated)'
              }}>
                {selectedNode.anomaly_score?.toFixed(1)}%
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => handleNodeFocus(selectedNode.id)}>
              Investigate
            </button>
          </div>
        </div>
      )}

      {/* Stats Badge */}
      <div style={{
        position: 'absolute', bottom: 'var(--space-lg)', left: 'var(--space-lg)',
        background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)', padding: '8px 12px',
        fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)',
      }}>
        {graphData?.stats?.total_nodes || 0} nodes · {graphData?.stats?.total_edges || 0} edges · {graphData?.stats?.cluster_count || 0} clusters
      </div>
    </div>
  );
}
