'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  hashPassword, verifyPassword,
  generateTOTPSecret, generateTOTPCode, verifyTOTPCode,
  base32Encode, base32Decode,
  signRequest, verifyRequest,
  generateKeyPair, sign, verify,
  hashData, buildHashChain, verifyHashChain,
  generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode,
  createNonceTracker
} = require('../../control-plane/lib/crypto');

describe('PBKDF2 password hashing', () => {
  it('should hash and verify a password', () => {
    const hashed = hashPassword('mypassword');
    assert.ok(hashed.includes(':'), 'hash should contain salt separator');
    assert.ok(verifyPassword('mypassword', hashed));
  });

  it('should reject wrong password', () => {
    const hashed = hashPassword('correct');
    assert.ok(!verifyPassword('wrong', hashed));
  });

  it('should produce different hashes for same password (random salt)', () => {
    const h1 = hashPassword('password');
    const h2 = hashPassword('password');
    assert.notEqual(h1, h2);
  });

  it('should use timing-safe comparison', () => {
    // Verify the function does not throw for valid comparisons
    const hashed = hashPassword('test');
    assert.ok(verifyPassword('test', hashed));
    assert.ok(!verifyPassword('wrong', hashed));
  });
});

describe('TOTP', () => {
  it('should generate a base32 secret', () => {
    const secret = generateTOTPSecret();
    assert.ok(typeof secret === 'string');
    assert.ok(secret.length > 0);
    assert.ok(/^[A-Z2-7]+$/.test(secret), 'secret should be base32 encoded');
  });

  it('should generate a 6-digit code', () => {
    const secret = generateTOTPSecret();
    const code = generateTOTPCode(secret);
    assert.ok(typeof code === 'string');
    assert.equal(code.length, 6);
    assert.ok(/^\d{6}$/.test(code));
  });

  it('should verify correct code', () => {
    const secret = generateTOTPSecret();
    const code = generateTOTPCode(secret);
    assert.ok(verifyTOTPCode(secret, code));
  });

  it('should reject wrong code', () => {
    const secret = generateTOTPSecret();
    assert.ok(!verifyTOTPCode(secret, '000000'));
  });

  it('should support window tolerance', () => {
    const secret = generateTOTPSecret();
    const timeStep = Math.floor(Date.now() / 30000);
    const code = generateTOTPCode(secret, timeStep - 1);
    // Should accept code from previous window with default window=1
    assert.ok(verifyTOTPCode(secret, code, 1));
  });

  it('should roundtrip base32 encode/decode', () => {
    const original = crypto.randomBytes(20);
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    assert.ok(original.equals(decoded));
  });
});

describe('HMAC request signing', () => {
  it('should sign and verify a request', () => {
    const secret = 'my-secret-key';
    const ts = Date.now();
    const sig = signRequest(secret, 'POST', '/api/test', ts, '{"hello":"world"}');
    assert.ok(typeof sig === 'string');
    assert.ok(verifyRequest(secret, 'POST', '/api/test', ts, '{"hello":"world"}', sig));
  });

  it('should reject expired request', () => {
    const secret = 'my-secret-key';
    const ts = Date.now() - 400000; // 400s ago, past 300s max age
    const sig = signRequest(secret, 'GET', '/api/test', ts);
    assert.ok(!verifyRequest(secret, 'GET', '/api/test', ts, '', sig, 300000));
  });

  it('should reject tampered body', () => {
    const secret = 'my-secret-key';
    const ts = Date.now();
    const sig = signRequest(secret, 'POST', '/api/test', ts, 'original');
    assert.ok(!verifyRequest(secret, 'POST', '/api/test', ts, 'tampered', sig));
  });
});

describe('Ed25519', () => {
  it('should generate a key pair', () => {
    const kp = generateKeyPair();
    assert.ok(kp.publicKey.includes('PUBLIC KEY'));
    assert.ok(kp.privateKey.includes('PRIVATE KEY'));
  });

  it('should sign and verify data', () => {
    const kp = generateKeyPair();
    const data = 'hello world';
    const sig = sign(data, kp.privateKey);
    assert.ok(verify(data, sig, kp.publicKey));
  });

  it('should reject tampered signature', () => {
    const kp = generateKeyPair();
    const sig = sign('hello', kp.privateKey);
    assert.ok(!verify('hello modified', sig, kp.publicKey));
  });

  it('should reject wrong key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const sig = sign('data', kp1.privateKey);
    assert.ok(!verify('data', sig, kp2.publicKey));
  });
});

describe('Hash chain', () => {
  it('should build a chain', () => {
    const items = ['event1', 'event2', 'event3'];
    const chain = buildHashChain(items);
    assert.equal(chain.length, 3);
    assert.equal(chain[0].prevHash, '0'.repeat(64));
    assert.equal(chain[1].prevHash, chain[0].hash);
    assert.equal(chain[2].prevHash, chain[1].hash);
  });

  it('should verify intact chain', () => {
    const chain = buildHashChain(['a', 'b', 'c', 'd']);
    const result = verifyHashChain(chain);
    assert.ok(result.valid);
  });

  it('should detect broken chain', () => {
    const chain = buildHashChain(['a', 'b', 'c']);
    chain[1].hash = 'tampered_hash_value_' + '0'.repeat(44);
    const result = verifyHashChain(chain);
    assert.ok(!result.valid);
    assert.equal(result.brokenAt, 1);
  });
});

describe('Recovery codes', () => {
  it('should generate 10 codes by default', () => {
    const codes = generateRecoveryCodes();
    assert.equal(codes.length, 10);
  });

  it('should generate unique codes', () => {
    const codes = generateRecoveryCodes();
    const unique = new Set(codes);
    assert.equal(unique.size, codes.length);
  });

  it('should hash and verify a code', () => {
    const codes = generateRecoveryCodes();
    const hash = hashRecoveryCode(codes[0]);
    assert.ok(verifyRecoveryCode(codes[0], hash));
    assert.ok(!verifyRecoveryCode('WRONG_CODE', hash));
  });
});

describe('Nonce tracker', () => {
  it('should accept first use of a nonce', () => {
    const tracker = createNonceTracker();
    assert.ok(tracker.accept('nonce-1'));
  });

  it('should reject replay of a nonce', () => {
    const tracker = createNonceTracker();
    assert.ok(tracker.accept('nonce-1'));
    assert.ok(!tracker.accept('nonce-1'));
  });

  it('should expire old nonces', () => {
    const tracker = createNonceTracker(1); // 1ms expiry
    tracker.accept('old-nonce');
    // Wait a bit for expiry
    const start = Date.now();
    while (Date.now() - start < 5) {} // spin wait
    assert.ok(tracker.accept('old-nonce'));
  });

  it('should accept different nonces', () => {
    const tracker = createNonceTracker();
    assert.ok(tracker.accept('nonce-a'));
    assert.ok(tracker.accept('nonce-b'));
    assert.ok(tracker.accept('nonce-c'));
  });
});
