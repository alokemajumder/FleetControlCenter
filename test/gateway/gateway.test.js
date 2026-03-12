'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');

const { createGateway } = require('../../control-plane/lib/gateway');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-gateway-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeUpstream(overrides = {}) {
  return {
    id: 'upstream-' + crypto.randomBytes(3).toString('hex'),
    name: 'Test Upstream',
    url: 'http://localhost:19876',
    enabled: true,
    ...overrides
  };
}

// -- Upstream CRUD --

describe('Gateway: addUpstream', () => {
  it('should add a valid upstream', () => {
    const gw = createGateway();
    const cfg = makeUpstream();
    const result = gw.addUpstream(cfg);
    assert.equal(result.id, cfg.id);
    assert.equal(result.name, cfg.name);
    assert.equal(result.url, cfg.url);
    assert.equal(result.enabled, true);
  });

  it('should reject upstream without id', () => {
    const gw = createGateway();
    assert.throws(() => gw.addUpstream({ name: 'x', url: 'http://localhost:1234' }), /id is required/);
  });

  it('should reject upstream without url', () => {
    const gw = createGateway();
    assert.throws(() => gw.addUpstream({ id: 'a', name: 'x' }), /url is required/);
  });

  it('should reject upstream without name', () => {
    const gw = createGateway();
    assert.throws(() => gw.addUpstream({ id: 'a', url: 'http://localhost:1234' }), /name is required/);
  });

  it('should reject upstream with invalid URL', () => {
    const gw = createGateway();
    assert.throws(() => gw.addUpstream({ id: 'a', name: 'x', url: 'not-a-url' }), /not a valid URL/);
  });

  it('should reject upstream with non-http protocol', () => {
    const gw = createGateway();
    assert.throws(() => gw.addUpstream({ id: 'a', name: 'x', url: 'ftp://example.com' }), /http or https/);
  });

  it('should reject duplicate upstream id', () => {
    const gw = createGateway();
    const cfg = makeUpstream();
    gw.addUpstream(cfg);
    assert.throws(() => gw.addUpstream(cfg), /already exists/);
  });

  it('should strip trailing slashes from url', () => {
    const gw = createGateway();
    const cfg = makeUpstream({ url: 'http://localhost:1234///' });
    gw.addUpstream(cfg);
    const found = gw.getUpstream(cfg.id);
    assert.equal(found.url, 'http://localhost:1234');
  });
});

describe('Gateway: listUpstreams', () => {
  it('should return empty list initially', () => {
    const gw = createGateway();
    assert.deepEqual(gw.listUpstreams(), []);
  });

  it('should return all added upstreams', () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'a', name: 'A', url: 'http://a.local' }));
    gw.addUpstream(makeUpstream({ id: 'b', name: 'B', url: 'http://b.local' }));
    const list = gw.listUpstreams();
    assert.equal(list.length, 2);
    assert.ok(list.some(u => u.id === 'a'));
    assert.ok(list.some(u => u.id === 'b'));
  });
});

describe('Gateway: getUpstream', () => {
  it('should return null for unknown id', () => {
    const gw = createGateway();
    assert.equal(gw.getUpstream('nonexistent'), null);
  });

  it('should return upstream with health info', () => {
    const gw = createGateway();
    const cfg = makeUpstream();
    gw.addUpstream(cfg);
    const found = gw.getUpstream(cfg.id);
    assert.equal(found.id, cfg.id);
    assert.ok(found.health);
    assert.equal(found.health.status, 'unknown');
  });

  it('should mask hmacSecret', () => {
    const gw = createGateway();
    const cfg = makeUpstream({ hmacSecret: 'super-secret-key' });
    gw.addUpstream(cfg);
    const found = gw.getUpstream(cfg.id);
    assert.equal(found.hmacSecret, '***');
  });
});

describe('Gateway: updateUpstream', () => {
  it('should update name and url', () => {
    const gw = createGateway();
    const cfg = makeUpstream();
    gw.addUpstream(cfg);
    const updated = gw.updateUpstream(cfg.id, { name: 'New Name', url: 'http://new.local' });
    assert.equal(updated.name, 'New Name');
    assert.equal(updated.url, 'http://new.local');
  });

  it('should throw for unknown upstream', () => {
    const gw = createGateway();
    assert.throws(() => gw.updateUpstream('nonexistent', { name: 'x' }), /not found/);
  });

  it('should update enabled flag', () => {
    const gw = createGateway();
    const cfg = makeUpstream();
    gw.addUpstream(cfg);
    gw.updateUpstream(cfg.id, { enabled: false });
    const found = gw.getUpstream(cfg.id);
    assert.equal(found.enabled, false);
  });

  it('should reject invalid URL on update', () => {
    const gw = createGateway();
    const cfg = makeUpstream();
    gw.addUpstream(cfg);
    assert.throws(() => gw.updateUpstream(cfg.id, { url: 'bad-url' }), /not a valid URL/);
  });
});

describe('Gateway: removeUpstream', () => {
  it('should remove an existing upstream', () => {
    const gw = createGateway();
    const cfg = makeUpstream();
    gw.addUpstream(cfg);
    gw.removeUpstream(cfg.id);
    assert.equal(gw.getUpstream(cfg.id), null);
    assert.equal(gw.listUpstreams().length, 0);
  });

  it('should throw for unknown upstream', () => {
    const gw = createGateway();
    assert.throws(() => gw.removeUpstream('nonexistent'), /not found/);
  });
});

// -- Persistence --

describe('Gateway: persistence', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  after(() => {
    // Cleanup handled by OS for tmpdir
  });

  it('should persist upstreams to disk and reload', () => {
    const gw1 = createGateway({ dataDir: tmpDir });
    gw1.addUpstream(makeUpstream({ id: 'persist-1', name: 'P1', url: 'http://p1.local' }));
    gw1.addUpstream(makeUpstream({ id: 'persist-2', name: 'P2', url: 'http://p2.local' }));

    // Create a new gateway pointing to same dir - should reload
    const gw2 = createGateway({ dataDir: tmpDir });
    const list = gw2.listUpstreams();
    assert.equal(list.length, 2);
    assert.ok(list.some(u => u.id === 'persist-1'));
    assert.ok(list.some(u => u.id === 'persist-2'));
  });

  it('should handle missing persistence file gracefully', () => {
    const emptyDir = makeTmpDir();
    const gw = createGateway({ dataDir: emptyDir });
    assert.equal(gw.listUpstreams().length, 0);
  });
});

// -- Health checks --

describe('Gateway: health tracking', () => {
  it('should report initial health as unknown', () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'h1', name: 'H1', url: 'http://localhost:1' }));
    const health = gw.getHealth();
    assert.equal(health.total, 1);
    assert.equal(health.unknown, 1);
    assert.equal(health.healthy, 0);
    assert.equal(health.unhealthy, 0);
  });

  it('should mark upstream healthy after successful health check', async () => {
    // Start a simple health server
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const gw = createGateway();
      const cfg = makeUpstream({ id: 'healthy-1', url: 'http://127.0.0.1:' + port });
      gw.addUpstream(cfg);

      // Trigger health check manually
      const upstream = gw._upstreams.get('healthy-1');
      await gw._checkHealth(upstream);

      const health = gw.getHealth();
      assert.equal(health.healthy, 1);
      assert.equal(health.upstreams[0].health.status, 'healthy');
      assert.ok(health.upstreams[0].health.latencyMs >= 0);
      assert.ok(health.upstreams[0].health.lastSeen);
    } finally {
      server.close();
    }
  });

  it('should mark upstream unhealthy after 3 consecutive failures', async () => {
    const gw = createGateway();
    // Point to a port that is not listening
    const cfg = makeUpstream({ id: 'fail-1', url: 'http://127.0.0.1:1' });
    gw.addUpstream(cfg);

    const upstream = gw._upstreams.get('fail-1');
    // Simulate 3 failures
    await gw._checkHealth(upstream);
    assert.notEqual(upstream._health.status, 'unhealthy'); // only 1 failure
    await gw._checkHealth(upstream);
    assert.notEqual(upstream._health.status, 'unhealthy'); // only 2 failures
    await gw._checkHealth(upstream);
    assert.equal(upstream._health.status, 'unhealthy'); // 3 failures -> unhealthy
  });

  it('should start and stop health check interval', () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'int-1', url: 'http://127.0.0.1:1' }));
    gw.startHealthChecks(60000);
    // Just verify it doesn't throw
    gw.stopHealthChecks();
  });
});

// -- Proxy request --

describe('Gateway: proxyRequest', () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          echo: true,
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body ? JSON.parse(body) : null
        }));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(() => { server.close(); });

  it('should proxy GET request to upstream', async () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'proxy-1', url: 'http://127.0.0.1:' + port }));
    const result = await gw.proxyRequest('proxy-1', 'GET', '/api/fleet/nodes', null);
    assert.equal(result.status, 200);
    assert.equal(result.body.echo, true);
    assert.equal(result.body.method, 'GET');
    assert.equal(result.body.url, '/api/fleet/nodes');
  });

  it('should proxy POST request with body', async () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'proxy-2', url: 'http://127.0.0.1:' + port }));
    const result = await gw.proxyRequest('proxy-2', 'POST', '/api/test', { key: 'value' });
    assert.equal(result.status, 200);
    assert.equal(result.body.method, 'POST');
    assert.deepEqual(result.body.body, { key: 'value' });
  });

  it('should add HMAC signature when hmacSecret is set', async () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'proxy-hmac', url: 'http://127.0.0.1:' + port, hmacSecret: 'test-secret' }));
    const result = await gw.proxyRequest('proxy-hmac', 'GET', '/api/test', null);
    assert.equal(result.status, 200);
    assert.ok(result.body.headers['x-gateway-signature']);
    assert.ok(result.body.headers['x-gateway-timestamp']);
  });

  it('should return error for unknown upstream', async () => {
    const gw = createGateway();
    const result = await gw.proxyRequest('nonexistent', 'GET', '/test', null);
    assert.ok(result.error);
    assert.ok(result.error.includes('not found'));
  });
});

// -- Aggregate request --

describe('Gateway: aggregateRequest', () => {
  let server1, server2, port1, port2;

  before(async () => {
    server1 = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nodes: { 'n1': { hostname: 'host1' } } }));
    });
    server2 = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nodes: { 'n2': { hostname: 'host2' } } }));
    });
    await new Promise(resolve => server1.listen(0, '127.0.0.1', resolve));
    await new Promise(resolve => server2.listen(0, '127.0.0.1', resolve));
    port1 = server1.address().port;
    port2 = server2.address().port;
  });

  after(() => { server1.close(); server2.close(); });

  it('should fan out to all enabled upstreams', async () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'agg-1', url: 'http://127.0.0.1:' + port1 }));
    gw.addUpstream(makeUpstream({ id: 'agg-2', url: 'http://127.0.0.1:' + port2 }));
    const result = await gw.aggregateRequest('GET', '/api/fleet/nodes', null);
    assert.equal(result.total, 2);
    assert.equal(result.results.length, 2);
    assert.equal(result.errors.length, 0);
  });

  it('should skip disabled upstreams', async () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'agg-en', url: 'http://127.0.0.1:' + port1 }));
    gw.addUpstream(makeUpstream({ id: 'agg-dis', url: 'http://127.0.0.1:' + port2, enabled: false }));
    const result = await gw.aggregateRequest('GET', '/api/fleet/nodes', null);
    assert.equal(result.total, 1);
    assert.equal(result.results.length, 1);
  });

  it('should collect errors from failed upstreams', async () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'agg-ok', url: 'http://127.0.0.1:' + port1 }));
    gw.addUpstream(makeUpstream({ id: 'agg-fail', url: 'http://127.0.0.1:1' })); // unreachable
    const result = await gw.aggregateRequest('GET', '/api/fleet/nodes', null);
    assert.equal(result.total, 2);
    assert.ok(result.errors.length >= 1);
    assert.ok(result.results.length >= 1);
  });

  it('should return empty results when no upstreams configured', async () => {
    const gw = createGateway();
    const result = await gw.aggregateRequest('GET', '/api/fleet/nodes', null);
    assert.equal(result.total, 0);
    assert.equal(result.results.length, 0);
  });
});

// -- getHealth --

describe('Gateway: getHealth', () => {
  it('should return summary counts', () => {
    const gw = createGateway();
    gw.addUpstream(makeUpstream({ id: 'gh-1', name: 'GH1', url: 'http://a.local' }));
    gw.addUpstream(makeUpstream({ id: 'gh-2', name: 'GH2', url: 'http://b.local' }));
    const health = gw.getHealth();
    assert.equal(health.total, 2);
    assert.equal(health.unknown, 2);
    assert.equal(health.upstreams.length, 2);
  });
});

// -- Config upstreams --

describe('Gateway: opts.upstreams initialization', () => {
  it('should load upstreams from opts', () => {
    const gw = createGateway({
      upstreams: [
        { id: 'init-1', name: 'I1', url: 'http://i1.local' },
        { id: 'init-2', name: 'I2', url: 'http://i2.local' }
      ]
    });
    assert.equal(gw.listUpstreams().length, 2);
  });

  it('should skip invalid upstreams from opts', () => {
    const gw = createGateway({
      upstreams: [
        { id: 'valid', name: 'V', url: 'http://v.local' },
        { name: 'no-id' }, // missing id
        null
      ]
    });
    assert.equal(gw.listUpstreams().length, 1);
  });
});
