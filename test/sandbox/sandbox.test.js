'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const { createSandbox } = require('../../node-agent/lib/sandbox');

describe('Command allowlist', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox({
      allowedCommands: ['ls', 'cat', 'echo'],
      allowedPaths: ['/tmp'],
      protectedPaths: ['/etc']
    });
  });

  it('should allow whitelisted command', () => {
    const result = sandbox.validateCommand('ls');
    assert.ok(result.allowed);
  });

  it('should reject non-whitelisted command', () => {
    const result = sandbox.validateCommand('rm');
    assert.ok(!result.allowed);
    assert.ok(result.reason.includes('not allowed'));
  });

  it('should reject sudo', () => {
    const result = sandbox.validateCommand('sudo');
    assert.ok(!result.allowed);
  });
});

describe('Argument constraints', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox({
      allowedCommands: ['grep', 'find'],
      allowedPaths: ['/tmp'],
      protectedPaths: [],
      argumentConstraints: {
        grep: {
          disallowed: ['--include=*.pem', '/etc/shadow']
        },
        find: {
          allowed: ['/tmp', '-name', '-type']
        }
      }
    });
  });

  it('should allow valid arguments', () => {
    const result = sandbox.validateCommand('find', ['/tmp', '-name', '-type']);
    assert.ok(result.allowed);
  });

  it('should reject disallowed arguments', () => {
    const result = sandbox.validateCommand('grep', ['pattern', '--include=*.pem']);
    assert.ok(!result.allowed);
    assert.ok(result.reason.includes('not allowed'));
  });
});

describe('Path allowlist', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox({
      allowedCommands: ['cat'],
      allowedPaths: ['/tmp'],
      protectedPaths: ['/etc']
    });
  });

  it('should allow path within allowlist', () => {
    const result = sandbox.isPathAllowed('/tmp/myfile.txt');
    assert.ok(result.allowed);
  });

  it('should reject path outside allowlist', () => {
    const result = sandbox.isPathAllowed('/home/user/secrets');
    assert.ok(!result.allowed);
  });
});

describe('Path traversal protection', () => {
  let sandbox;
  let tmpDir;

  before(() => {
    tmpDir = path.join(os.tmpdir(), 'clawcc-sandbox-test-' + crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sandbox = createSandbox({
      allowedCommands: ['cat'],
      allowedPaths: [tmpDir],
      protectedPaths: ['/etc']
    });
  });

  it('should reject ../../../etc/passwd', () => {
    const malicious = path.join(tmpDir, '../../../etc/passwd');
    const result = sandbox.validateCommand('cat', [malicious]);
    assert.ok(!result.allowed);
  });

  it('should reject relative traversal', () => {
    const result = sandbox.isPathAllowed(path.join(tmpDir, '../../etc/shadow'));
    assert.ok(!result.allowed);
  });
});

describe('Symlink escape prevention', () => {
  let tmpDir;
  let sandbox;

  before(() => {
    tmpDir = path.join(os.tmpdir(), 'clawcc-symlink-test-' + crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(tmpDir, { recursive: true });
    // Create a symlink pointing outside allowed path
    const symlinkPath = path.join(tmpDir, 'escape');
    try {
      fs.symlinkSync('/usr', symlinkPath);
    } catch {
      // May fail on some systems
    }
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sandbox = createSandbox({
      allowedCommands: ['cat'],
      allowedPaths: [tmpDir],
      protectedPaths: []
    });
  });

  it('should prevent symlink escape', () => {
    const symlinkPath = path.join(tmpDir, 'escape');
    if (fs.existsSync(symlinkPath)) {
      const result = sandbox.checkSymlink(symlinkPath);
      assert.ok(!result.safe, 'symlink should be detected as unsafe');
    } else {
      // If symlink creation failed, just verify the check works with a non-existent file
      const result = sandbox.checkSymlink(path.join(tmpDir, 'nonexistent'));
      assert.ok(result.safe, 'non-existent file should be safe');
    }
  });
});

describe('Output truncation', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox({ maxOutputSize: 100 });
  });

  it('should truncate output exceeding size limit', () => {
    const longOutput = 'A'.repeat(200);
    const result = sandbox.truncateOutput(longOutput);
    assert.ok(result.length < 200);
    assert.ok(result.includes('[truncated]'));
  });

  it('should not truncate short output', () => {
    const shortOutput = 'hello';
    const result = sandbox.truncateOutput(shortOutput);
    assert.equal(result, 'hello');
  });

  it('should truncate buffer output', () => {
    const bigBuffer = Buffer.alloc(200, 0x41);
    const result = sandbox.truncateOutput(bigBuffer);
    assert.ok(result.length < 200);
  });
});

describe('Protected path requires approval', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox({
      allowedCommands: ['cat'],
      allowedPaths: ['/tmp', '/etc'],
      protectedPaths: ['/etc']
    });
  });

  it('should reject protected path without approval', () => {
    const result = sandbox.validateCommand('cat', ['/etc/config']);
    assert.ok(!result.allowed);
    assert.ok(result.reason.includes('approval'));
  });

  it('should allow protected path with approval flag', () => {
    const result = sandbox.validateCommand('cat', ['/etc/config'], { approveProtected: true });
    assert.ok(result.allowed);
  });
});

describe('File operations respect allowlist', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox({
      allowedPaths: ['/tmp'],
      protectedPaths: ['/etc']
    });
  });

  it('should allow file operation in allowed path', () => {
    const result = sandbox.validateFileOperation('read', '/tmp/file.txt');
    assert.ok(result.allowed);
  });

  it('should reject file operation outside allowed path', () => {
    const result = sandbox.validateFileOperation('read', '/home/user/file');
    assert.ok(!result.allowed);
  });

  it('should reject file operation on protected path without approval', () => {
    const result = sandbox.validateFileOperation('read', '/etc/passwd');
    assert.ok(!result.allowed);
  });
});
