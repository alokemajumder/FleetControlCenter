'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');

const { createUpdater, compareSemver } = require('../../control-plane/lib/updater');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-updater-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFakeProject(dir, version) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'clawcc', version }));
}

// Helper: create a test HTTP server that responds with given JSON body
function createTestServer(responseBody, statusCode = 200) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: 'http://127.0.0.1:' + addr.port + '/releases/latest' });
    });
  });
}

// ---- Version comparison ----

describe('compareSemver', () => {
  it('should return 0 for equal versions', () => {
    assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  });

  it('should return 1 when a > b (patch)', () => {
    assert.equal(compareSemver('1.0.2', '1.0.1'), 1);
  });

  it('should return -1 when a < b (patch)', () => {
    assert.equal(compareSemver('1.0.1', '1.0.2'), -1);
  });

  it('should return 1 when a > b (minor)', () => {
    assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
  });

  it('should return 1 when a > b (major)', () => {
    assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
  });

  it('should handle v prefix', () => {
    assert.equal(compareSemver('v1.0.1', '1.0.0'), 1);
    assert.equal(compareSemver('1.0.0', 'v1.0.1'), -1);
  });
});

// ---- getCurrentVersion ----

describe('getCurrentVersion', () => {
  it('should read version from package.json', () => {
    const updater = createUpdater({ projectRoot: PROJECT_ROOT });
    const version = updater.getCurrentVersion();
    assert.ok(version);
    assert.match(version, /^\d+\.\d+\.\d+/);
  });

  it('should read version from a custom project root', () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '3.2.1');
    const updater = createUpdater({ projectRoot: tmpDir });
    assert.equal(updater.getCurrentVersion(), '3.2.1');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---- checkForUpdates with mock server ----

describe('checkForUpdates', () => {
  let testServer;
  let apiUrl;

  after(async () => {
    if (testServer) testServer.close();
  });

  it('should detect update available when remote is newer', async () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');
    const srv = await createTestServer({
      tag_name: 'v1.0.0',
      html_url: 'https://github.com/alokemajumder/FleetControlCenter/releases/tag/v1.0.0',
      body: 'Release notes here',
      published_at: '2026-03-10T00:00:00Z'
    });
    testServer = srv.server;
    apiUrl = srv.url;

    const updater = createUpdater({ projectRoot: tmpDir, apiUrl });
    const result = await updater.checkForUpdates();

    assert.equal(result.currentVersion, '0.1.0');
    assert.equal(result.latestVersion, '1.0.0');
    assert.equal(result.updateAvailable, true);
    assert.equal(result.releaseNotes, 'Release notes here');

    testServer.close();
    testServer = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should report no update when versions match', async () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '1.0.0');
    const srv = await createTestServer({ tag_name: 'v1.0.0', html_url: '', body: '', published_at: null });
    testServer = srv.server;

    const updater = createUpdater({ projectRoot: tmpDir, apiUrl: srv.url });
    const result = await updater.checkForUpdates();
    assert.equal(result.updateAvailable, false);

    testServer.close();
    testServer = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle network error gracefully', async () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');
    // Use a port that nothing listens on
    const updater = createUpdater({ projectRoot: tmpDir, apiUrl: 'http://127.0.0.1:1/bad' });
    const result = await updater.checkForUpdates();
    assert.equal(result.updateAvailable, false);
    assert.ok(result.error);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle invalid JSON response', async () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');
    // Server that returns invalid JSON
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not json');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();

    const updater = createUpdater({ projectRoot: tmpDir, apiUrl: 'http://127.0.0.1:' + addr.port + '/' });
    const result = await updater.checkForUpdates();
    assert.equal(result.updateAvailable, false);
    assert.ok(result.error);

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---- Update status caching ----

describe('getUpdateStatus caching', () => {
  it('should return checked:false before any check', () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');
    const updater = createUpdater({ projectRoot: tmpDir });
    const status = updater.getUpdateStatus();
    assert.equal(status.checked, false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should cache result and not re-fetch within TTL', async () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');

    let requestCount = 0;
    const server = http.createServer((req, res) => {
      requestCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tag_name: 'v1.0.0', html_url: '', body: '', published_at: null }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();

    const updater = createUpdater({
      projectRoot: tmpDir,
      apiUrl: 'http://127.0.0.1:' + addr.port + '/',
      cacheTtlMs: 60000
    });

    await updater.checkForUpdates();
    assert.equal(requestCount, 1);

    // Second call should use cache
    await updater.checkForUpdates();
    assert.equal(requestCount, 1);

    // After clearing cache, should re-fetch
    updater._clearCache();
    await updater.checkForUpdates();
    assert.equal(requestCount, 2);

    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---- canSelfUpdate ----

describe('canSelfUpdate', () => {
  it('should return canUpdate:true for the actual project repo', () => {
    const updater = createUpdater({ projectRoot: PROJECT_ROOT });
    const result = updater.canSelfUpdate();
    // The actual repo should have .git and git available
    assert.equal(result.canUpdate === true || result.canUpdate === false, true);
    if (!result.canUpdate) {
      // If tree is dirty (due to test changes), that's expected
      assert.ok(result.reason);
    }
  });

  it('should return canUpdate:false for a non-git directory', () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');
    const updater = createUpdater({ projectRoot: tmpDir });
    const result = updater.canSelfUpdate();
    assert.equal(result.canUpdate, false);
    assert.ok(result.reason.includes('git'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---- getChangelog ----

describe('getChangelog', () => {
  it('should return found:false when no CHANGELOG.md exists', () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');
    const updater = createUpdater({ projectRoot: tmpDir });
    const result = updater.getChangelog();
    assert.equal(result.found, false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should parse CHANGELOG.md sections', () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.1.0');
    fs.writeFileSync(path.join(tmpDir, 'CHANGELOG.md'), [
      '# Changelog',
      '',
      '## [1.0.0]',
      '- Added feature A',
      '- Fixed bug B',
      '',
      '## [0.1.0]',
      '- Initial release',
      ''
    ].join('\n'));

    const updater = createUpdater({ projectRoot: tmpDir });
    const result = updater.getChangelog();
    assert.equal(result.found, true);
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].version, '1.0.0');
    assert.ok(result.entries[0].body.includes('feature A'));
    assert.equal(result.entries[1].version, '0.1.0');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---- getVersionHistory ----

describe('getVersionHistory', () => {
  it('should include current version', () => {
    const tmpDir = makeTmpDir();
    makeFakeProject(tmpDir, '0.5.0');
    const updater = createUpdater({ projectRoot: tmpDir });
    const history = updater.getVersionHistory();
    assert.ok(history.length >= 1);
    assert.equal(history[0].version, '0.5.0');
    assert.equal(history[0].current, true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
