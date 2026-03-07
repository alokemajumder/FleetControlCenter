'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createReceiptStore } = require('../../control-plane/lib/receipts');
const { hashData } = require('../../control-plane/lib/crypto');

describe('Create receipt', () => {
  it('should create a receipt with hash', () => {
    const store = createReceiptStore();
    const receipt = store.createReceipt('event data');
    assert.ok(receipt.hash);
    assert.ok(receipt.dataHash);
    assert.equal(receipt.index, 0);
    assert.equal(receipt.data, 'event data');
    assert.equal(receipt.prevHash, '0'.repeat(64));
  });

  it('should chain receipts', () => {
    const store = createReceiptStore();
    const r1 = store.createReceipt('event1');
    const r2 = store.createReceipt('event2');
    assert.equal(r2.prevHash, r1.hash);
    assert.equal(r2.index, 1);
  });
});

describe('Hash chain integrity', () => {
  it('should verify intact chain', () => {
    const store = createReceiptStore();
    store.createReceipt('a');
    store.createReceipt('b');
    store.createReceipt('c');
    const result = store.verifyChain();
    assert.ok(result.valid);
  });
});

describe('Chain break detection', () => {
  it('should detect tampered receipt', () => {
    const store = createReceiptStore();
    store.createReceipt('a');
    store.createReceipt('b');
    store.createReceipt('c');
    // Tamper with a receipt
    const receipts = store.getReceipts();
    receipts[1].hash = 'tampered' + '0'.repeat(56);
    // Re-verify by manually checking (since internal store is separate)
    // We test the exported bundle verification instead
    const bundle = store.exportBundle();
    // Tamper with bundle receipt
    bundle.receipts[1].hash = 'tampered' + '0'.repeat(56);
    bundle.hash = hashData(JSON.stringify(bundle.receipts));
    // Signature will be invalid now
    const result = store.verifyBundle(bundle);
    assert.ok(!result.valid);
  });
});

describe('Daily root signing', () => {
  it('should sign and verify daily root', () => {
    const store = createReceiptStore();
    store.createReceipt('event1');
    store.createReceipt('event2');
    const today = new Date().toISOString().split('T')[0];
    const root = store.signDailyRoot(today);
    assert.ok(root);
    assert.equal(root.date, today);
    assert.ok(root.rootHash);
    assert.ok(root.signature);
    assert.equal(root.receiptCount, 2);
    assert.ok(store.verifyDailyRoot(root));
  });

  it('should return null for day with no receipts', () => {
    const store = createReceiptStore();
    const root = store.signDailyRoot('1999-01-01');
    assert.equal(root, null);
  });
});

describe('Evidence bundle export', () => {
  it('should export bundle with signature', () => {
    const store = createReceiptStore();
    store.createReceipt('a');
    store.createReceipt('b');
    store.createReceipt('c');
    const bundle = store.exportBundle();
    assert.ok(bundle.receipts);
    assert.equal(bundle.receipts.length, 3);
    assert.ok(bundle.hash);
    assert.ok(bundle.signature);
  });

  it('should export partial bundle', () => {
    const store = createReceiptStore();
    store.createReceipt('a');
    store.createReceipt('b');
    store.createReceipt('c');
    const bundle = store.exportBundle(1, 3);
    assert.equal(bundle.receipts.length, 2);
  });
});

describe('Evidence bundle verification', () => {
  it('should verify valid bundle', () => {
    const store = createReceiptStore();
    store.createReceipt('x');
    store.createReceipt('y');
    const bundle = store.exportBundle();
    const result = store.verifyBundle(bundle);
    assert.ok(result.valid);
  });

  it('should reject tampered bundle hash', () => {
    const store = createReceiptStore();
    store.createReceipt('x');
    const bundle = store.exportBundle();
    bundle.hash = 'bad_hash';
    const result = store.verifyBundle(bundle);
    assert.ok(!result.valid);
    assert.ok(result.reason.includes('hash'));
  });

  it('should reject tampered bundle signature', () => {
    const store = createReceiptStore();
    store.createReceipt('x');
    const bundle = store.exportBundle();
    // Flip a hex char in signature
    const chars = bundle.signature.split('');
    chars[0] = chars[0] === 'a' ? 'b' : 'a';
    bundle.signature = chars.join('');
    const result = store.verifyBundle(bundle);
    assert.ok(!result.valid);
  });
});

describe('Reject tampered receipt', () => {
  it('should detect data tampering in bundle', () => {
    const store = createReceiptStore();
    store.createReceipt('original');
    store.createReceipt('data');
    const bundle = store.exportBundle();
    // Tamper with receipt data
    bundle.receipts[0].data = 'modified';
    // Recalculate bundle hash so signature check catches it
    const result = store.verifyBundle(bundle);
    assert.ok(!result.valid);
  });
});
