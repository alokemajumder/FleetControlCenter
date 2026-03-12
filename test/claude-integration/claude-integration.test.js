'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createClaudeIntegration } = require('../../control-plane/lib/claude-integration');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-claude-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Build a mock ~/.claude directory structure
function buildMockClaudeDir(baseDir) {
  // settings.json
  fs.writeFileSync(path.join(baseDir, 'settings.json'), JSON.stringify({
    version: '1.2.3',
    theme: 'dark',
    apiKey: 'sk-secret-key-123',
    token: 'tok-secret-456'
  }));

  // projects directory with two projects
  const projDir = path.join(baseDir, 'projects');
  fs.mkdirSync(projDir, { recursive: true });

  // Project A
  const projA = path.join(projDir, 'proj-abc123');
  fs.mkdirSync(projA, { recursive: true });
  fs.writeFileSync(path.join(projA, 'CLAUDE.md'), '# Project A\nInstructions here.');
  fs.mkdirSync(path.join(projA, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(projA, 'memory', 'MEMORY.md'), '# Memory\nSome memory content.');

  // Session JSONL files for project A
  const session1Lines = [
    JSON.stringify({ type: 'message', model: 'claude-3', timestamp: '2026-03-01T10:00:00Z', content: 'hello' }),
    JSON.stringify({ type: 'tool_use', model: 'claude-3', timestamp: '2026-03-01T10:01:00Z', tool: 'Read' }),
    JSON.stringify({ type: 'message', model: 'claude-3-5', timestamp: '2026-03-01T10:02:00Z', content: 'done' })
  ];
  fs.writeFileSync(path.join(projA, 'session-001.jsonl'), session1Lines.join('\n') + '\n');
  fs.writeFileSync(path.join(projA, 'session-002.jsonl'), JSON.stringify({ type: 'message', timestamp: '2026-03-02T08:00:00Z' }) + '\n');

  // Project B (no CLAUDE.md, no memory)
  const projB = path.join(projDir, 'proj-def456');
  fs.mkdirSync(projB, { recursive: true });
  fs.writeFileSync(path.join(projB, 'session-003.jsonl'), JSON.stringify({ type: 'message', timestamp: '2026-03-03T12:00:00Z' }) + '\n');

  return baseDir;
}

describe('Claude Integration - discover', () => {
  it('should report installed when claude dir exists', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const info = ci.discover();
      assert.equal(info.installed, true);
      assert.equal(info.version, '1.2.3');
      assert.equal(info.projectCount, 2);
      assert.equal(info.configPath, tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should report not installed when dir does not exist', () => {
    const ci = createClaudeIntegration({ claudeDir: '/tmp/nonexistent-claude-' + Date.now() });
    const info = ci.discover();
    assert.equal(info.installed, false);
    assert.equal(info.version, null);
    assert.equal(info.projectCount, 0);
  });
});

describe('Claude Integration - getSettings', () => {
  it('should read and redact sensitive fields', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const settings = ci.getSettings();
      assert.equal(settings.theme, 'dark');
      assert.equal(settings.apiKey, '***REDACTED***');
      assert.equal(settings.token, '***REDACTED***');
      assert.equal(settings.version, '1.2.3');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return null when settings missing', () => {
    const tmpDir = makeTmpDir();
    try {
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const settings = ci.getSettings();
      assert.equal(settings, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - getProjects', () => {
  it('should list all projects with metadata', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const projects = ci.getProjects();
      assert.equal(projects.length, 2);

      const projA = projects.find(p => p.id === 'proj-abc123');
      assert.ok(projA);
      assert.equal(projA.hasClaudeMd, true);
      assert.equal(projA.hasMemory, true);
      assert.equal(projA.sessionCount, 2);
      assert.ok(projA.lastActivity);

      const projB = projects.find(p => p.id === 'proj-def456');
      assert.ok(projB);
      assert.equal(projB.hasClaudeMd, false);
      assert.equal(projB.hasMemory, false);
      assert.equal(projB.sessionCount, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return empty array when no projects dir', () => {
    const tmpDir = makeTmpDir();
    try {
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const projects = ci.getProjects();
      assert.deepEqual(projects, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - getProjectDetail', () => {
  it('should return project detail with CLAUDE.md content', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const detail = ci.getProjectDetail('proj-abc123');
      assert.ok(detail);
      assert.equal(detail.id, 'proj-abc123');
      assert.ok(detail.claudeMd.includes('Project A'));
      assert.ok(detail.memory.includes('Some memory content'));
      assert.equal(detail.sessionCount, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return null for nonexistent project', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const detail = ci.getProjectDetail('nonexistent');
      assert.equal(detail, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - getProjectMemory', () => {
  it('should return MEMORY.md content', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const memory = ci.getProjectMemory('proj-abc123');
      assert.ok(memory.includes('Some memory content'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return null for project without memory', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const memory = ci.getProjectMemory('proj-def456');
      assert.equal(memory, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - getSessions', () => {
  it('should list sessions for a project', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const sessions = ci.getSessions('proj-abc123');
      assert.equal(sessions.length, 2);
      assert.ok(sessions[0].id);
      assert.ok(sessions[0].filename.endsWith('.jsonl'));
      assert.ok(sessions[0].sizeBytes > 0);
      assert.ok(sessions[0].lastModified);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return empty array for invalid project id', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const sessions = ci.getSessions('../etc');
      assert.deepEqual(sessions, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - getSessionSummary', () => {
  it('should parse session JSONL and extract summary', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const summary = ci.getSessionSummary('proj-abc123', 'session-001');
      assert.equal(summary.messageCount, 3);
      assert.equal(summary.toolUseCount, 1);
      assert.ok(summary.models.includes('claude-3'));
      assert.ok(summary.models.includes('claude-3-5'));
      assert.equal(summary.startTime, '2026-03-01T10:00:00Z');
      assert.equal(summary.endTime, '2026-03-01T10:02:00Z');
      assert.equal(summary.duration, 120000); // 2 minutes
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return null for nonexistent session', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const summary = ci.getSessionSummary('proj-abc123', 'nonexistent');
      assert.equal(summary, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - getRecentActivity', () => {
  it('should return recent sessions across all projects sorted by date', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const recent = ci.getRecentActivity(10);
      assert.ok(recent.length >= 3);
      // All sessions should have projectId
      for (const s of recent) {
        assert.ok(s.projectId);
        assert.ok(s.lastModified);
      }
      // Should be sorted descending by lastModified
      for (let i = 1; i < recent.length; i++) {
        assert.ok(new Date(recent[i - 1].lastModified) >= new Date(recent[i].lastModified));
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - getStats', () => {
  it('should aggregate stats across all projects', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const stats = ci.getStats();
      assert.equal(stats.totalProjects, 2);
      assert.equal(stats.totalSessions, 3);
      assert.ok(stats.totalSizeBytes > 0);
      assert.ok(stats.oldestSession);
      assert.ok(stats.newestSession);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - path traversal rejection', () => {
  it('should reject project ids with path traversal', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      assert.equal(ci.getProjectDetail('../etc'), null);
      assert.equal(ci.getProjectDetail('foo/bar'), null);
      assert.equal(ci.getProjectDetail('foo\\bar'), null);
      assert.equal(ci.getProjectDetail('..'), null);
      assert.deepEqual(ci.getSessions('../../etc', {}), []);
      assert.equal(ci.getSessionSummary('../x', 'y'), null);
      assert.equal(ci.getSessionSummary('proj', '../../../etc/passwd'), null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - graceful handling of corrupt files', () => {
  it('should handle corrupt settings.json gracefully', () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, 'settings.json'), 'NOT VALID JSON{{{');
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const settings = ci.getSettings();
      assert.equal(settings, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should handle corrupt JSONL sessions gracefully', () => {
    const tmpDir = makeTmpDir();
    try {
      const projDir = path.join(tmpDir, 'projects', 'proj-corrupt');
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, 'bad-session.jsonl'), 'not json\n{also bad\n');
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      const summary = ci.getSessionSummary('proj-corrupt', 'bad-session');
      assert.ok(summary);
      assert.equal(summary.messageCount, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Claude Integration - watch setup and teardown', () => {
  it('should set up and stop watcher without errors', () => {
    const tmpDir = makeTmpDir();
    try {
      buildMockClaudeDir(tmpDir);
      const ci = createClaudeIntegration({ claudeDir: tmpDir });
      let callbackCalled = false;
      ci.watchForChanges(() => { callbackCalled = true; });
      // Calling again should be a no-op (already watching)
      ci.watchForChanges(() => {});
      ci.stopWatching();
      // Stopping again should be safe
      ci.stopWatching();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should handle watch on nonexistent directory gracefully', () => {
    const ci = createClaudeIntegration({ claudeDir: '/tmp/nonexistent-' + Date.now() });
    ci.watchForChanges(() => {});
    ci.stopWatching();
  });
});
