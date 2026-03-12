'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');

const { createWebhookManager } = require('../../control-plane/lib/webhooks');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-webhooks-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeWebhookData(overrides = {}) {
  return {
    name: 'Test Webhook',
    url: 'http://localhost:19876/hook',
    events: ['session.start', 'session.end'],
    ...overrides
  };
}

// Helper: start a simple HTTP server that records requests
function startTestServer(port) {
  const received = [];
  let responseStatus = 200;
  let responseBody = '{"ok":true}';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      });
      res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
      res.end(responseBody);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        received,
        setResponse(status, body) { responseStatus = status; responseBody = body; },
        close() { return new Promise(r => server.close(r)); }
      });
    });
  });
}

describe('Webhook CRUD', () => {
  let tmpDir, manager;
  before(() => {
    tmpDir = makeTmpDir();
    manager = createWebhookManager({ dataDir: tmpDir });
  });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should create a webhook with generated secret', () => {
    const wh = manager.createWebhook(makeWebhookData());
    assert.ok(wh.id);
    assert.ok(wh.secret);
    assert.equal(wh.name, 'Test Webhook');
    assert.equal(wh.enabled, true);
    assert.equal(wh.circuitBreaker.state, 'closed');
    assert.equal(wh.stats.totalDeliveries, 0);
  });

  it('should create a webhook with custom secret', () => {
    const wh = manager.createWebhook(makeWebhookData({ secret: 'my-custom-secret' }));
    assert.equal(wh.secret, 'my-custom-secret');
  });

  it('should get a webhook by id', () => {
    const wh = manager.createWebhook(makeWebhookData({ name: 'Get Test' }));
    const found = manager.getWebhook(wh.id);
    assert.equal(found.name, 'Get Test');
  });

  it('should return null for unknown id', () => {
    assert.equal(manager.getWebhook('nonexistent'), null);
  });

  it('should list all webhooks', () => {
    const list = manager.listWebhooks();
    assert.ok(list.length >= 3); // created 3 above
  });

  it('should update a webhook', () => {
    const wh = manager.createWebhook(makeWebhookData({ name: 'Before Update' }));
    const updated = manager.updateWebhook(wh.id, { name: 'After Update' });
    assert.equal(updated.name, 'After Update');
    assert.ok(updated.updatedAt >= wh.createdAt);
  });

  it('should delete a webhook', () => {
    const wh = manager.createWebhook(makeWebhookData({ name: 'To Delete' }));
    manager.deleteWebhook(wh.id);
    assert.equal(manager.getWebhook(wh.id), null);
  });

  it('should throw on delete of nonexistent webhook', () => {
    assert.throws(() => manager.deleteWebhook('nope'), /not found/i);
  });
});

describe('Webhook validation', () => {
  let manager;
  before(() => { manager = createWebhookManager(); });

  it('should reject webhook without name', () => {
    assert.throws(() => manager.createWebhook({ url: 'http://localhost/hook', events: ['*'] }), /name is required/i);
  });

  it('should reject webhook without url', () => {
    assert.throws(() => manager.createWebhook({ name: 'No URL', events: ['*'] }), /URL is required/i);
  });

  it('should reject webhook with invalid url', () => {
    assert.throws(() => manager.createWebhook({ name: 'Bad', url: 'not-a-url', events: ['*'] }), /Invalid URL/i);
  });

  it('should reject webhook with ftp url', () => {
    assert.throws(() => manager.createWebhook({ name: 'FTP', url: 'ftp://host/path', events: ['*'] }), /http or https/i);
  });

  it('should reject webhook without events', () => {
    assert.throws(() => manager.createWebhook({ name: 'No Events', url: 'http://localhost/hook' }), /event type is required/i);
  });
});

describe('Enable / Disable', () => {
  let manager;
  before(() => { manager = createWebhookManager(); });

  it('should disable a webhook', () => {
    const wh = manager.createWebhook(makeWebhookData());
    manager.disableWebhook(wh.id);
    assert.equal(manager.getWebhook(wh.id).enabled, false);
  });

  it('should enable a disabled webhook', () => {
    const wh = manager.createWebhook(makeWebhookData({ enabled: false }));
    manager.enableWebhook(wh.id);
    assert.equal(manager.getWebhook(wh.id).enabled, true);
  });
});

describe('Event matching and dispatch', () => {
  let manager;
  before(() => { manager = createWebhookManager(); });

  it('should match webhooks by event type', () => {
    manager.createWebhook(makeWebhookData({ name: 'session-hook', events: ['session.start'] }));
    // dispatch returns matched deliveries (delivery will fail since no server, but that's ok)
    const deliveries = manager.dispatch('session.start', { test: true });
    assert.ok(deliveries.length >= 1);
    assert.equal(deliveries[0].event, 'session.start');
  });

  it('should match wildcard webhooks', () => {
    manager.createWebhook(makeWebhookData({ name: 'wildcard-hook', events: ['*'] }));
    const deliveries = manager.dispatch('any.event.type', { data: 1 });
    assert.ok(deliveries.some(d => d.event === 'any.event.type'));
  });

  it('should not dispatch to disabled webhooks', () => {
    const wh = manager.createWebhook(makeWebhookData({ name: 'disabled-hook', events: ['disabled.test'] }));
    manager.disableWebhook(wh.id);
    const deliveries = manager.dispatch('disabled.test', {});
    const fromDisabled = deliveries.filter(d => d.webhookId === wh.id);
    assert.equal(fromDisabled.length, 0);
  });
});

describe('Delivery with HTTP test server', () => {
  let manager, testSrv, tmpDir;
  const PORT = 19876;

  before(async () => {
    tmpDir = makeTmpDir();
    manager = createWebhookManager({ dataDir: tmpDir });
    testSrv = await startTestServer(PORT);
  });
  after(async () => {
    await testSrv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should deliver payload to target server', async () => {
    const beforeCount = testSrv.received.length;
    const wh = manager.createWebhook(makeWebhookData({
      name: 'delivery-test',
      url: 'http://127.0.0.1:' + PORT + '/hook',
      events: ['test.deliver']
    }));
    const deliveries = manager.dispatch('test.deliver', { foo: 'bar' });
    // Wait for async delivery
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.ok(testSrv.received.length > beforeCount);
    // Find the request with our event type
    const matching = testSrv.received.filter(r => r.headers['x-fcc-event'] === 'test.deliver');
    assert.ok(matching.length >= 1);
    const last = matching[matching.length - 1];
    assert.equal(last.method, 'POST');
    assert.equal(last.headers['content-type'], 'application/json');
    assert.ok(last.headers['x-fcc-delivery']);
    assert.ok(last.headers['x-fcc-signature']);
    const parsed = JSON.parse(last.body);
    assert.equal(parsed.foo, 'bar');
  });

  it('should verify HMAC signature', async () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'sig-test',
      url: 'http://127.0.0.1:' + PORT + '/hook',
      events: ['test.sig'],
      secret: 'test-secret-123'
    }));
    manager.dispatch('test.sig', { verify: true });
    await new Promise(resolve => setTimeout(resolve, 500));
    const last = testSrv.received[testSrv.received.length - 1];
    const sigHeader = last.headers['x-fcc-signature'];
    assert.ok(sigHeader.startsWith('sha256='));
    const expectedSig = crypto.createHmac('sha256', 'test-secret-123').update(last.body).digest('hex');
    assert.equal(sigHeader, 'sha256=' + expectedSig);
  });

  it('should record successful delivery stats', async () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'stats-test',
      url: 'http://127.0.0.1:' + PORT + '/hook',
      events: ['test.stats']
    }));
    manager.dispatch('test.stats', { count: 1 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const updated = manager.getWebhook(wh.id);
    assert.ok(updated.stats.successCount >= 1);
    assert.ok(updated.stats.lastDeliveryAt > 0);
    assert.equal(updated.stats.consecutiveFailures, 0);
  });
});

describe('Delivery failure and retry', () => {
  let manager, testSrv, tmpDir;
  const PORT = 19877;

  before(async () => {
    tmpDir = makeTmpDir();
    manager = createWebhookManager({ dataDir: tmpDir });
    testSrv = await startTestServer(PORT);
    testSrv.setResponse(500, '{"error":"fail"}');
  });
  after(async () => {
    await testSrv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record failure on non-2xx response', async () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'fail-test',
      url: 'http://127.0.0.1:' + PORT + '/hook',
      events: ['test.fail'],
      retryPolicy: { maxRetries: 0, backoffMs: 10 }
    }));
    manager.dispatch('test.fail', { data: 1 });
    await new Promise(resolve => setTimeout(resolve, 300));
    const updated = manager.getWebhook(wh.id);
    assert.ok(updated.stats.failureCount >= 1);
    assert.ok(updated.stats.consecutiveFailures >= 1);
  });
});

describe('Circuit breaker', () => {
  let manager;
  before(() => { manager = createWebhookManager(); });

  it('should transition from closed to open after threshold failures', () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'cb-test',
      circuitBreaker: { failureThreshold: 3, resetTimeMs: 100 }
    }));
    // Simulate failures
    for (let i = 0; i < 3; i++) {
      manager._updateCircuitBreaker(wh, false);
    }
    assert.equal(wh.circuitBreaker.state, 'open');
  });

  it('should block delivery when circuit is open', () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'cb-open',
      circuitBreaker: { failureThreshold: 2, resetTimeMs: 60000 }
    }));
    manager._updateCircuitBreaker(wh, false);
    manager._updateCircuitBreaker(wh, false);
    assert.equal(wh.circuitBreaker.state, 'open');
    assert.equal(manager._checkCircuitBreaker(wh), false);
  });

  it('should transition from open to half-open after reset time', async () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'cb-halfopen',
      circuitBreaker: { failureThreshold: 1, resetTimeMs: 50 }
    }));
    manager._updateCircuitBreaker(wh, false);
    assert.equal(wh.circuitBreaker.state, 'open');
    await new Promise(resolve => setTimeout(resolve, 60));
    const allowed = manager._checkCircuitBreaker(wh);
    assert.equal(allowed, true);
    assert.equal(wh.circuitBreaker.state, 'half-open');
  });

  it('should transition from half-open to closed on success', () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'cb-recover',
      circuitBreaker: { failureThreshold: 1, resetTimeMs: 10 }
    }));
    manager._updateCircuitBreaker(wh, false);
    wh.circuitBreaker.state = 'half-open';
    manager._updateCircuitBreaker(wh, true);
    assert.equal(wh.circuitBreaker.state, 'closed');
    assert.equal(wh.stats.consecutiveFailures, 0);
  });

  it('should transition from half-open to open on failure', () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'cb-reopen',
      circuitBreaker: { failureThreshold: 1, resetTimeMs: 10 }
    }));
    wh.circuitBreaker.state = 'half-open';
    manager._updateCircuitBreaker(wh, false);
    assert.equal(wh.circuitBreaker.state, 'open');
  });
});

describe('Delivery history', () => {
  let manager, tmpDir;
  before(() => {
    tmpDir = makeTmpDir();
    manager = createWebhookManager({ dataDir: tmpDir });
  });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should return delivery history for a webhook', () => {
    const wh = manager.createWebhook(makeWebhookData({ name: 'history-test', events: ['hist.test'] }));
    // Dispatch creates deliveries (they will fail since no server)
    manager.dispatch('hist.test', { a: 1 });
    manager.dispatch('hist.test', { a: 2 });
    const result = manager.getDeliveries(wh.id);
    assert.ok(result.deliveries.length >= 2);
    assert.ok(result.total >= 2);
  });

  it('should support pagination', () => {
    const wh = manager.createWebhook(makeWebhookData({ name: 'page-test', events: ['page.test'] }));
    for (let i = 0; i < 5; i++) {
      manager.dispatch('page.test', { i });
    }
    const page1 = manager.getDeliveries(wh.id, { limit: 2, offset: 0 });
    assert.equal(page1.deliveries.length, 2);
    const page2 = manager.getDeliveries(wh.id, { limit: 2, offset: 2 });
    assert.equal(page2.deliveries.length, 2);
  });
});

describe('Test ping', () => {
  let manager, testSrv;
  const PORT = 19878;
  before(async () => {
    manager = createWebhookManager();
    testSrv = await startTestServer(PORT);
  });
  after(async () => { await testSrv.close(); });

  it('should send a test ping event', async () => {
    const wh = manager.createWebhook(makeWebhookData({
      name: 'ping-test',
      url: 'http://127.0.0.1:' + PORT + '/hook',
      events: ['*']
    }));
    const delivery = await manager.testWebhook(wh.id);
    assert.equal(delivery.event, 'webhook.test');
    assert.equal(delivery.status, 'success');
    const last = testSrv.received[testSrv.received.length - 1];
    const parsed = JSON.parse(last.body);
    assert.equal(parsed.event, 'webhook.test');
    assert.ok(parsed.message.includes('test ping'));
  });

  it('should throw for nonexistent webhook', () => {
    assert.throws(() => manager.testWebhook('no-such-id'), /not found/i);
  });
});

describe('Persistence', () => {
  let tmpDir;
  before(() => { tmpDir = makeTmpDir(); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should persist and reload webhooks', () => {
    const m1 = createWebhookManager({ dataDir: tmpDir });
    const wh = m1.createWebhook(makeWebhookData({ name: 'Persist Test' }));
    // Create new manager instance (simulates restart)
    const m2 = createWebhookManager({ dataDir: tmpDir });
    const loaded = m2.getWebhook(wh.id);
    assert.ok(loaded);
    assert.equal(loaded.name, 'Persist Test');
  });
});

describe('HMAC signing', () => {
  it('should produce valid sha256 HMAC', () => {
    const manager = createWebhookManager();
    const body = '{"hello":"world"}';
    const secret = 'test-secret';
    const sig = manager._signPayload(body, secret);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    assert.equal(sig, expected);
  });
});
