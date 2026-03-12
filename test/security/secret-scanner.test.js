'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createSecretScanner } = require('../../control-plane/lib/secret-scanner');

describe('Secret Scanner - Pattern detection', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should detect AWS Access Key', () => {
    const findings = scanner.scan('My key is AKIAIOSFODNN7EXAMPLE');
    assert.ok(findings.length >= 1);
    assert.ok(findings.some(f => f.pattern === 'AWS Access Key'));
  });

  it('should detect GitHub Token', () => {
    const findings = scanner.scan('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm');
    assert.ok(findings.some(f => f.pattern === 'GitHub Token'));
  });

  it('should detect GitHub Fine-Grained Token', () => {
    const findings = scanner.scan('pat: github_pat_ABCDEFGHIJKLMNOPQRSTUV1234');
    assert.ok(findings.some(f => f.pattern === 'GitHub Fine-Grained'));
  });

  it('should detect Stripe Key', () => {
    const findings = scanner.scan('stripe: sk_' + 'live_ABCDEFGHIJKLMNOPQRSTUVWXyz');
    assert.ok(findings.some(f => f.pattern === 'Stripe Key'));
  });

  it('should detect JWT', () => {
    const findings = scanner.scan('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0');
    assert.ok(findings.some(f => f.pattern === 'JWT'));
  });

  it('should detect PEM Certificate', () => {
    const findings = scanner.scan('-----BEGIN RSA PRIVATE KEY-----');
    assert.ok(findings.some(f => f.pattern === 'PEM Certificate'));
  });

  it('should detect EC Private Key', () => {
    const findings = scanner.scan('-----BEGIN EC PRIVATE KEY-----');
    assert.ok(findings.some(f => f.pattern === 'PEM Certificate'));
  });

  it('should detect plain PRIVATE KEY', () => {
    const findings = scanner.scan('-----BEGIN PRIVATE KEY-----');
    assert.ok(findings.some(f => f.pattern === 'PEM Certificate'));
  });

  it('should detect Database URI (postgres)', () => {
    const findings = scanner.scan('postgres://user:pass@localhost:5432/mydb');
    assert.ok(findings.some(f => f.pattern === 'Database URI'));
  });

  it('should detect Database URI (mongodb)', () => {
    const findings = scanner.scan('mongodb://admin:secret@mongo.example.com/db');
    assert.ok(findings.some(f => f.pattern === 'Database URI'));
  });

  it('should detect Slack Token', () => {
    const findings = scanner.scan('slack: xoxb-1234567890123-abcdef');
    assert.ok(findings.some(f => f.pattern === 'Slack Token'));
  });

  it('should detect Anthropic Key', () => {
    const findings = scanner.scan('key: sk-ant-ABCDEFGHIJKLMNOPQRSTuvwxyz');
    assert.ok(findings.some(f => f.pattern === 'Anthropic Key'));
  });

  it('should detect OpenAI Key', () => {
    const findings = scanner.scan('key: sk-ABCDEFGHIJKLMNOPQRSTuvwxyz');
    assert.ok(findings.some(f => f.pattern === 'OpenAI Key'));
  });

  it('should detect Generic API Key pattern', () => {
    const findings = scanner.scan('my_api_key = "super_secret_value_12345"');
    assert.ok(findings.some(f => f.pattern === 'Generic API Key'));
  });

  it('should detect Bearer Token', () => {
    const findings = scanner.scan('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test');
    assert.ok(findings.some(f => f.pattern === 'Bearer Token'));
  });
});

describe('Secret Scanner - Multi-secret scanning', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should detect multiple secrets in one text', () => {
    const text = [
      'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
      'STRIPE=sk_' + 'live_ABCDEFGHIJKLMNOPQRSTUVWXyz',
      'DB=postgres://user:pass@localhost/db'
    ].join('\n');
    const findings = scanner.scan(text);
    assert.ok(findings.length >= 3);
    const patterns = findings.map(f => f.pattern);
    assert.ok(patterns.includes('AWS Access Key'));
    assert.ok(patterns.includes('Stripe Key'));
    assert.ok(patterns.includes('Database URI'));
  });

  it('should include line and column in findings', () => {
    const text = 'safe line\nAKIAIOSFODNN7EXAMPLE here';
    const findings = scanner.scan(text);
    const aws = findings.find(f => f.pattern === 'AWS Access Key');
    assert.ok(aws);
    assert.equal(aws.line, 2);
    assert.ok(aws.column >= 1);
  });

  it('should mask match to first 8 chars + ***', () => {
    const findings = scanner.scan('AKIAIOSFODNN7EXAMPLE');
    assert.ok(findings[0].match.endsWith('***'));
    assert.equal(findings[0].match.length, 11); // 8 + 3
  });
});

describe('Secret Scanner - Object scanning', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should scan nested objects', () => {
    const obj = {
      config: {
        aws: { key: 'AKIAIOSFODNN7EXAMPLE' },
        db: { url: 'postgres://user:pass@localhost/db' }
      }
    };
    const findings = scanner.scanObject(obj);
    assert.ok(findings.length >= 2);
    assert.ok(findings.some(f => f.path.includes('aws')));
    assert.ok(findings.some(f => f.path.includes('db')));
  });

  it('should scan arrays in objects', () => {
    const obj = { keys: ['AKIAIOSFODNN7EXAMPLE', 'safe-value'] };
    const findings = scanner.scanObject(obj);
    assert.ok(findings.length >= 1);
    assert.ok(findings[0].path.includes('[0]'));
  });

  it('should return empty for null/undefined', () => {
    assert.deepEqual(scanner.scanObject(null), []);
    assert.deepEqual(scanner.scanObject(undefined), []);
  });
});

describe('Secret Scanner - Masking', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should mask secrets in text', () => {
    const text = 'key: AKIAIOSFODNN7EXAMPLE';
    const masked = scanner.maskSecrets(text);
    assert.ok(!masked.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(masked.includes('***REDACTED***'));
  });

  it('should mask multiple secrets', () => {
    const text = 'aws: AKIAIOSFODNN7EXAMPLE\nstripe: sk_' + 'live_ABCDEFGHIJKLMNOPQRSTUVWXyz';
    const masked = scanner.maskSecrets(text);
    assert.ok(!masked.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(!masked.includes('sk_live_'));
  });

  it('should return non-string input unchanged', () => {
    assert.equal(scanner.maskSecrets(42), 42);
    assert.equal(scanner.maskSecrets(null), null);
  });
});

describe('Secret Scanner - Custom patterns', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should add a custom pattern', () => {
    scanner.addPattern({ name: 'Custom Secret', regex: /CUSTOM_[A-Z]{10}/, severity: 'high' });
    const patterns = scanner.getPatterns();
    assert.ok(patterns.some(p => p.name === 'Custom Secret'));
  });

  it('should detect with custom pattern', () => {
    scanner.addPattern({ name: 'Custom Secret', regex: /CUSTOM_[A-Z]{10}/, severity: 'high' });
    const findings = scanner.scan('value: CUSTOM_ABCDEFGHIJ');
    assert.ok(findings.some(f => f.pattern === 'Custom Secret'));
  });

  it('should reject duplicate pattern name', () => {
    assert.throws(() => scanner.addPattern({ name: 'AWS Access Key', regex: /test/ }), /already exists/);
  });

  it('should remove a custom pattern', () => {
    scanner.addPattern({ name: 'Removable', regex: /REMOVE_ME/, severity: 'low' });
    scanner.removePattern('Removable');
    const patterns = scanner.getPatterns();
    assert.ok(!patterns.some(p => p.name === 'Removable'));
  });

  it('should reject removing a built-in pattern', () => {
    assert.throws(() => scanner.removePattern('AWS Access Key'), /Cannot remove built-in/);
  });

  it('should reject removing non-existent pattern', () => {
    assert.throws(() => scanner.removePattern('Nonexistent'), /Pattern not found/);
  });
});

describe('Secret Scanner - No false positives', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should not flag normal text', () => {
    const findings = scanner.scan('Hello world, this is a normal log message with no secrets.');
    assert.equal(findings.length, 0);
  });

  it('should not flag short strings', () => {
    const findings = scanner.scan('key=abc');
    assert.equal(findings.length, 0);
  });

  it('should not flag URLs without credentials', () => {
    const findings = scanner.scan('https://example.com/api/data');
    assert.equal(findings.length, 0);
  });
});

describe('Secret Scanner - File scanning', () => {
  let scanner;
  let tmpFile;
  beforeEach(() => {
    scanner = createSecretScanner();
    tmpFile = path.join(os.tmpdir(), 'clawcc-test-scan-' + Date.now() + '.txt');
  });

  it('should scan a file with secrets', () => {
    fs.writeFileSync(tmpFile, 'line1\nAKIAIOSFODNN7EXAMPLE\nline3');
    try {
      const findings = scanner.scanFile(tmpFile);
      assert.ok(findings.some(f => f.pattern === 'AWS Access Key'));
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it('should throw for non-existent file', () => {
    assert.throws(() => scanner.scanFile('/tmp/nonexistent-file-12345.txt'), /File not found/);
  });

  it('should throw for files exceeding size limit', () => {
    // Create a file > 1MB
    const bigContent = 'x'.repeat(1048577);
    fs.writeFileSync(tmpFile, bigContent);
    try {
      assert.throws(() => scanner.scanFile(tmpFile), /exceeds size limit/);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});

describe('Secret Scanner - Stats', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should track scan stats', () => {
    scanner.scan('AKIAIOSFODNN7EXAMPLE');
    scanner.scan('safe text');
    const stats = scanner.getScanStats();
    assert.equal(stats.totalScans, 2);
    assert.ok(stats.secretsFound >= 1);
    assert.ok(stats.byPattern['AWS Access Key'] >= 1);
  });
});

describe('Secret Scanner - Severity levels', () => {
  let scanner;
  beforeEach(() => { scanner = createSecretScanner(); });

  it('should assign critical severity to AWS keys', () => {
    const findings = scanner.scan('AKIAIOSFODNN7EXAMPLE');
    const aws = findings.find(f => f.pattern === 'AWS Access Key');
    assert.equal(aws.severity, 'critical');
  });

  it('should assign high severity to GitHub tokens', () => {
    const findings = scanner.scan('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm');
    const gh = findings.find(f => f.pattern === 'GitHub Token');
    assert.equal(gh.severity, 'high');
  });

  it('should assign medium severity to JWT', () => {
    const findings = scanner.scan('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0');
    const jwt = findings.find(f => f.pattern === 'JWT');
    assert.equal(jwt.severity, 'medium');
  });
});
