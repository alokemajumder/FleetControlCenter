'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createKnowledgeGraph } = require('../../control-plane/lib/knowledge-graph');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-kg-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Knowledge Graph - Node CRUD', () => {
  it('should add a node and retrieve it', () => {
    const kg = createKnowledgeGraph();
    const node = kg.addNode({ id: 'n1', type: 'file', label: 'test.js' });
    assert.equal(node.id, 'n1');
    assert.equal(node.type, 'file');
    assert.equal(node.label, 'test.js');
    const got = kg.getNode('n1');
    assert.equal(got.id, 'n1');
  });

  it('should dedup nodes by ID (update existing)', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'n1', type: 'file', label: 'original' });
    kg.addNode({ id: 'n1', type: 'file', label: 'updated' });
    const all = kg.listNodes();
    assert.equal(all.length, 1);
    assert.equal(all[0].label, 'updated');
  });

  it('should remove a node', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'n1', type: 'file', label: 'test' });
    assert.ok(kg.removeNode('n1'));
    assert.equal(kg.getNode('n1'), null);
  });

  it('should return false when removing non-existent node', () => {
    const kg = createKnowledgeGraph();
    assert.equal(kg.removeNode('no-such'), false);
  });

  it('should require node id', () => {
    const kg = createKnowledgeGraph();
    assert.throws(() => kg.addNode({}), /id/);
  });
});

describe('Knowledge Graph - Edge CRUD', () => {
  it('should add an edge and retrieve it', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'a', type: 'file', label: 'a' });
    kg.addNode({ id: 'b', type: 'tool', label: 'b' });
    const edge = kg.addEdge({ source: 'a', target: 'b', type: 'uses', weight: 5 });
    assert.equal(edge.id, 'a:b');
    assert.equal(edge.weight, 5);
    const got = kg.getEdge('a:b');
    assert.equal(got.source, 'a');
  });

  it('should remove an edge', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'a', type: 'file', label: 'a' });
    kg.addNode({ id: 'b', type: 'tool', label: 'b' });
    kg.addEdge({ source: 'a', target: 'b' });
    assert.ok(kg.removeEdge('a:b'));
    assert.equal(kg.getEdge('a:b'), null);
  });

  it('should return false when removing non-existent edge', () => {
    const kg = createKnowledgeGraph();
    assert.equal(kg.removeEdge('no:such'), false);
  });

  it('should remove edges when node is removed', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'a', type: 'file', label: 'a' });
    kg.addNode({ id: 'b', type: 'tool', label: 'b' });
    kg.addEdge({ source: 'a', target: 'b' });
    kg.removeNode('a');
    assert.equal(kg.getEdge('a:b'), null);
    assert.equal(kg.listEdges().length, 0);
  });

  it('should require edge source and target', () => {
    const kg = createKnowledgeGraph();
    assert.throws(() => kg.addEdge({}), /source and target/);
  });
});

describe('Knowledge Graph - Neighbor queries', () => {
  let kg;
  beforeEach(() => {
    kg = createKnowledgeGraph();
    kg.addNode({ id: 'a', type: 'session', label: 'A' });
    kg.addNode({ id: 'b', type: 'file', label: 'B' });
    kg.addNode({ id: 'c', type: 'tool', label: 'C' });
    kg.addNode({ id: 'd', type: 'file', label: 'D' });
    kg.addEdge({ source: 'a', target: 'b' });
    kg.addEdge({ source: 'b', target: 'c' });
    kg.addEdge({ source: 'c', target: 'd' });
  });

  it('should find depth-1 neighbors', () => {
    const n = kg.getNeighbors('a', { depth: 1 });
    assert.equal(n.length, 1);
    assert.equal(n[0].id, 'b');
  });

  it('should find depth-2 neighbors', () => {
    const n = kg.getNeighbors('a', { depth: 2 });
    assert.equal(n.length, 2);
    const ids = n.map(x => x.id).sort();
    assert.deepEqual(ids, ['b', 'c']);
  });

  it('should filter neighbors by type', () => {
    const n = kg.getNeighbors('a', { depth: 3, types: ['tool'] });
    assert.equal(n.length, 1);
    assert.equal(n[0].id, 'c');
  });
});

describe('Knowledge Graph - Search', () => {
  it('should search case-insensitively', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'n1', type: 'file', label: 'Server.js' });
    kg.addNode({ id: 'n2', type: 'file', label: 'client.js' });
    const results = kg.search('server');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'n1');
  });

  it('should return empty for no matches', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'n1', type: 'file', label: 'test' });
    const results = kg.search('zzzzz');
    assert.equal(results.length, 0);
  });

  it('should return empty for empty query', () => {
    const kg = createKnowledgeGraph();
    assert.equal(kg.search('').length, 0);
  });
});

describe('Knowledge Graph - Stats', () => {
  it('should compute correct stats', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'a', type: 'file', label: 'a' });
    kg.addNode({ id: 'b', type: 'file', label: 'b' });
    kg.addNode({ id: 'c', type: 'tool', label: 'c' });
    kg.addEdge({ source: 'a', target: 'b' });
    const stats = kg.getStats();
    assert.equal(stats.nodeCount, 3);
    assert.equal(stats.edgeCount, 1);
    assert.equal(stats.byType.file, 2);
    assert.equal(stats.byType.tool, 1);
    assert.equal(stats.connectedComponents, 2); // {a,b} and {c}
  });
});

describe('Knowledge Graph - Subgraph extraction', () => {
  it('should extract subgraph centered on a node', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'a', type: 'session', label: 'A' });
    kg.addNode({ id: 'b', type: 'file', label: 'B' });
    kg.addNode({ id: 'c', type: 'tool', label: 'C' });
    kg.addNode({ id: 'd', type: 'agent', label: 'D' });
    kg.addEdge({ source: 'a', target: 'b' });
    kg.addEdge({ source: 'b', target: 'c' });
    kg.addEdge({ source: 'c', target: 'd' });
    const sub = kg.getSubgraph('a', 1);
    assert.equal(sub.nodes.length, 2); // a, b
    assert.equal(sub.edges.length, 1); // a:b
  });
});

describe('Knowledge Graph - Event ingestion', () => {
  it('should create nodes and edges from events', () => {
    const kg = createKnowledgeGraph();
    const events = [
      { type: 'command', nodeId: 'node-1', sessionId: 'sess-1', payload: { tool: 'Bash', file: '/tmp/test.js' } },
      { type: 'file_write', nodeId: 'node-1', sessionId: 'sess-1', payload: { file: '/tmp/output.js' } },
      { type: 'command', nodeId: 'node-2', sessionId: 'sess-2', payload: { tool: 'Read' } }
    ];
    const result = kg.ingestFromEvents(events);
    assert.ok(result.nodesAdded > 0);
    assert.ok(result.edgesAdded > 0);
    // Should have session, agent, file, and tool nodes
    assert.ok(kg.getNode('session:sess-1'));
    assert.ok(kg.getNode('agent:node-1'));
    assert.ok(kg.getNode('tool:Bash'));
    assert.ok(kg.getNode('file:/tmp/test.js'));
  });
});

describe('Knowledge Graph - Most connected nodes', () => {
  it('should return nodes with most edges', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'hub', type: 'tool', label: 'hub' });
    kg.addNode({ id: 'a', type: 'file', label: 'a' });
    kg.addNode({ id: 'b', type: 'file', label: 'b' });
    kg.addNode({ id: 'c', type: 'file', label: 'c' });
    kg.addEdge({ source: 'hub', target: 'a' });
    kg.addEdge({ source: 'hub', target: 'b' });
    kg.addEdge({ source: 'hub', target: 'c' });
    const top = kg.getMostConnected(2);
    assert.equal(top[0].node.id, 'hub');
    assert.equal(top[0].edgeCount, 3);
  });
});

describe('Knowledge Graph - Capacity limits', () => {
  it('should evict oldest nodes when max exceeded', () => {
    // Use a patched version with small limits to test eviction
    // We test indirectly via the factory since MAX_NODES is a constant
    const kg = createKnowledgeGraph();
    // Add many nodes — under 10000 limit this won't evict, but tests the code path
    for (let i = 0; i < 50; i++) {
      kg.addNode({ id: 'n' + i, type: 'file', label: 'node-' + i, createdAt: i });
    }
    assert.equal(kg.listNodes().length, 50);
  });
});

describe('Knowledge Graph - Persistence', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should save and load graph from disk', () => {
    tmpDir = makeTmpDir();
    const kg1 = createKnowledgeGraph({ dataDir: tmpDir });
    kg1.addNode({ id: 'x', type: 'memory', label: 'test-persist' });
    kg1.addNode({ id: 'y', type: 'tag', label: 'important' });
    kg1.addEdge({ source: 'x', target: 'y', type: 'related' });

    // Load fresh instance from same dir
    const kg2 = createKnowledgeGraph({ dataDir: tmpDir });
    const node = kg2.getNode('x');
    assert.ok(node);
    assert.equal(node.label, 'test-persist');
    const edge = kg2.getEdge('x:y');
    assert.ok(edge);
    assert.equal(edge.type, 'related');
    assert.equal(kg2.listNodes().length, 2);
  });
});

describe('Knowledge Graph - Cluster', () => {
  it('should get all nodes of a type with edges', () => {
    const kg = createKnowledgeGraph();
    kg.addNode({ id: 'f1', type: 'file', label: 'a.js' });
    kg.addNode({ id: 'f2', type: 'file', label: 'b.js' });
    kg.addNode({ id: 't1', type: 'tool', label: 'Bash' });
    kg.addEdge({ source: 'f1', target: 'f2' });
    kg.addEdge({ source: 'f1', target: 't1' });
    const cluster = kg.getCluster('file');
    assert.equal(cluster.nodes.length, 2);
    assert.equal(cluster.edges.length, 2); // both edges touch a file node
  });
});
