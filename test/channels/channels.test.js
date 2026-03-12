'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createChannelManager } = require('../../control-plane/lib/channels');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-channels-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Auto-creation of general channel', () => {
  let tmpDir;
  after(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should auto-create a general broadcast channel on first init', () => {
    tmpDir = makeTmpDir();
    const mgr = createChannelManager({ dataDir: tmpDir });
    const general = mgr.getChannel('general');
    assert.ok(general);
    assert.equal(general.name, 'General');
    assert.equal(general.type, 'broadcast');
    assert.equal(general.pinned, true);
    assert.equal(general.archived, false);
    assert.equal(general.createdBy, 'system');
  });

  it('should not re-create general channel on subsequent init', () => {
    tmpDir = makeTmpDir();
    const mgr1 = createChannelManager({ dataDir: tmpDir });
    mgr1.updateChannel('general', { description: 'Updated' });
    const mgr2 = createChannelManager({ dataDir: tmpDir });
    const general = mgr2.getChannel('general');
    assert.equal(general.description, 'Updated');
  });
});

describe('Channel CRUD', () => {
  let mgr;
  beforeEach(() => { mgr = createChannelManager(); });

  it('should create a channel with correct fields', () => {
    const ch = mgr.createChannel({ name: 'Test', type: 'group', description: 'A test channel', createdBy: 'alice' });
    assert.ok(ch.id);
    assert.equal(ch.name, 'Test');
    assert.equal(ch.type, 'group');
    assert.equal(ch.description, 'A test channel');
    assert.equal(ch.createdBy, 'alice');
    assert.equal(ch.archived, false);
    assert.ok(ch.createdAt);
  });

  it('should get a channel by ID', () => {
    const ch = mgr.createChannel({ name: 'Lookup' });
    const found = mgr.getChannel(ch.id);
    assert.equal(found.name, 'Lookup');
  });

  it('should return null for non-existent channel', () => {
    assert.equal(mgr.getChannel('does-not-exist'), null);
  });

  it('should list channels', () => {
    mgr.createChannel({ name: 'A', type: 'broadcast' });
    mgr.createChannel({ name: 'B', type: 'direct' });
    // general + A + B = 3
    const all = mgr.listChannels();
    assert.ok(all.length >= 3);
  });

  it('should filter channels by type', () => {
    mgr.createChannel({ name: 'Direct1', type: 'direct' });
    const directs = mgr.listChannels({ type: 'direct' });
    assert.ok(directs.length >= 1);
    assert.ok(directs.every(c => c.type === 'direct'));
  });

  it('should update channel name and description', () => {
    const ch = mgr.createChannel({ name: 'Old', description: 'Old desc' });
    const updated = mgr.updateChannel(ch.id, { name: 'New', description: 'New desc' });
    assert.equal(updated.name, 'New');
    assert.equal(updated.description, 'New desc');
  });

  it('should return null when updating non-existent channel', () => {
    assert.equal(mgr.updateChannel('nope', { name: 'X' }), null);
  });

  it('should archive a channel', () => {
    const ch = mgr.createChannel({ name: 'ToArchive' });
    const archived = mgr.archiveChannel(ch.id);
    assert.equal(archived.archived, true);
  });

  it('should delete a channel and its messages', () => {
    const ch = mgr.createChannel({ name: 'ToDelete' });
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'hello' });
    const deleted = mgr.deleteChannel(ch.id);
    assert.equal(deleted, true);
    assert.equal(mgr.getChannel(ch.id), null);
    assert.deepEqual(mgr.getMessages(ch.id), []);
  });

  it('should return false when deleting non-existent channel', () => {
    assert.equal(mgr.deleteChannel('nope'), false);
  });
});

describe('Channel membership', () => {
  let mgr, ch;
  beforeEach(() => {
    mgr = createChannelManager();
    ch = mgr.createChannel({ name: 'Team' });
  });

  it('should add a member to a channel', () => {
    const updated = mgr.joinChannel(ch.id, { id: 'alice', type: 'user' });
    assert.equal(updated.members.length, 1);
    assert.equal(updated.members[0].id, 'alice');
    assert.equal(updated.members[0].type, 'user');
    assert.ok(updated.members[0].joinedAt);
  });

  it('should not duplicate member on repeated join', () => {
    mgr.joinChannel(ch.id, { id: 'bob', type: 'user' });
    mgr.joinChannel(ch.id, { id: 'bob', type: 'user' });
    const found = mgr.getChannel(ch.id);
    const bobs = found.members.filter(m => m.id === 'bob');
    assert.equal(bobs.length, 1);
  });

  it('should remove a member from a channel', () => {
    mgr.joinChannel(ch.id, { id: 'charlie', type: 'agent' });
    const updated = mgr.leaveChannel(ch.id, 'charlie');
    assert.equal(updated.members.length, 0);
  });

  it('should return null when joining non-existent channel', () => {
    assert.equal(mgr.joinChannel('nope', { id: 'x' }), null);
  });
});

describe('Message sending and retrieval', () => {
  let mgr, ch;
  beforeEach(() => {
    mgr = createChannelManager();
    ch = mgr.createChannel({ name: 'MsgTest' });
  });

  it('should send a message and return it with all fields', () => {
    const msg = mgr.sendMessage(ch.id, {
      senderId: 'alice',
      senderType: 'user',
      senderName: 'Alice',
      content: 'Hello world'
    });
    assert.ok(msg.id);
    assert.equal(msg.channelId, ch.id);
    assert.equal(msg.senderId, 'alice');
    assert.equal(msg.senderType, 'user');
    assert.equal(msg.content, 'Hello world');
    assert.ok(msg.timestamp);
    assert.equal(msg.replyTo, null);
  });

  it('should return null when sending to non-existent channel', () => {
    assert.equal(mgr.sendMessage('nope', { content: 'x' }), null);
  });

  it('should retrieve messages for a channel', () => {
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'msg1' });
    mgr.sendMessage(ch.id, { senderId: 'u2', content: 'msg2' });
    const msgs = mgr.getMessages(ch.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].content, 'msg1');
    assert.equal(msgs[1].content, 'msg2');
  });

  it('should get a single message by ID', () => {
    const sent = mgr.sendMessage(ch.id, { senderId: 'u1', content: 'find me' });
    const found = mgr.getMessage(ch.id, sent.id);
    assert.equal(found.content, 'find me');
  });

  it('should return null for non-existent message', () => {
    assert.equal(mgr.getMessage(ch.id, 'no-such-id'), null);
  });
});

describe('Message pagination', () => {
  let mgr, ch;
  beforeEach(() => {
    mgr = createChannelManager();
    ch = mgr.createChannel({ name: 'Pagination' });
    for (let i = 0; i < 10; i++) {
      mgr.sendMessage(ch.id, { senderId: 'u1', content: 'msg-' + i, timestamp: 1000 + i });
    }
  });

  it('should limit messages', () => {
    const msgs = mgr.getMessages(ch.id, { limit: 3 });
    assert.equal(msgs.length, 3);
  });

  it('should filter messages after a timestamp', () => {
    const msgs = mgr.getMessages(ch.id, { after: 1005 });
    assert.ok(msgs.length > 0);
    assert.ok(msgs.every(m => m.timestamp > 1005));
  });

  it('should filter messages before a timestamp', () => {
    const msgs = mgr.getMessages(ch.id, { before: 1003 });
    assert.ok(msgs.length > 0);
    assert.ok(msgs.every(m => m.timestamp < 1003));
  });
});

describe('SSE subscription and notification', () => {
  let mgr, ch;
  beforeEach(() => {
    mgr = createChannelManager();
    ch = mgr.createChannel({ name: 'SSE' });
  });

  it('should notify subscribers when a message is sent', () => {
    const received = [];
    mgr.subscribe(ch.id, (msg) => received.push(msg));
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'live' });
    assert.equal(received.length, 1);
    assert.equal(received[0].content, 'live');
  });

  it('should support unsubscribe', () => {
    const received = [];
    const cb = (msg) => received.push(msg);
    mgr.subscribe(ch.id, cb);
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'a' });
    mgr.unsubscribe(ch.id, cb);
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'b' });
    assert.equal(received.length, 1);
  });

  it('should support multiple subscribers on same channel', () => {
    const a = [], b = [];
    mgr.subscribe(ch.id, (msg) => a.push(msg));
    mgr.subscribe(ch.id, (msg) => b.push(msg));
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'multi' });
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });
});

describe('Message threading (replyTo)', () => {
  it('should store replyTo reference', () => {
    const mgr = createChannelManager();
    const ch = mgr.createChannel({ name: 'Thread' });
    const parent = mgr.sendMessage(ch.id, { senderId: 'u1', content: 'parent' });
    const reply = mgr.sendMessage(ch.id, { senderId: 'u2', content: 'reply', replyTo: parent.id });
    assert.equal(reply.replyTo, parent.id);
    const found = mgr.getMessage(ch.id, reply.id);
    assert.equal(found.replyTo, parent.id);
  });
});

describe('Message search', () => {
  it('should search messages by content', () => {
    const mgr = createChannelManager();
    const ch1 = mgr.createChannel({ name: 'Search1' });
    const ch2 = mgr.createChannel({ name: 'Search2' });
    mgr.sendMessage(ch1.id, { senderId: 'u1', content: 'deploy to production' });
    mgr.sendMessage(ch1.id, { senderId: 'u2', content: 'rollback staging' });
    mgr.sendMessage(ch2.id, { senderId: 'u3', content: 'deploy canary' });

    const results = mgr.searchMessages('deploy');
    assert.equal(results.length, 2);
    assert.ok(results.every(m => m.content.includes('deploy')));
  });

  it('should search case-insensitively', () => {
    const mgr = createChannelManager();
    const ch = mgr.createChannel({ name: 'CaseTest' });
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'URGENT alert' });
    const results = mgr.searchMessages('urgent');
    assert.equal(results.length, 1);
  });

  it('should return empty for no match', () => {
    const mgr = createChannelManager();
    const results = mgr.searchMessages('zzzzzznotfound');
    assert.equal(results.length, 0);
  });
});

describe('Unread count', () => {
  it('should count messages after a given timestamp', () => {
    const mgr = createChannelManager();
    const ch = mgr.createChannel({ name: 'Unread' });
    mgr.sendMessage(ch.id, { senderId: 'u1', content: 'old', timestamp: 1000 });
    mgr.sendMessage(ch.id, { senderId: 'u2', content: 'new1', timestamp: 2000 });
    mgr.sendMessage(ch.id, { senderId: 'u3', content: 'new2', timestamp: 3000 });
    const count = mgr.getUnreadCount(ch.id, 'u1', 1500);
    assert.equal(count, 2);
  });
});

describe('Persistence', () => {
  let tmpDir;
  after(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should persist channels and messages to disk and reload', () => {
    tmpDir = makeTmpDir();
    const mgr1 = createChannelManager({ dataDir: tmpDir });
    const ch = mgr1.createChannel({ name: 'Persist', type: 'group', createdBy: 'alice' });
    mgr1.sendMessage(ch.id, { senderId: 'alice', content: 'hello from disk' });

    // Create a new manager that loads from disk
    const mgr2 = createChannelManager({ dataDir: tmpDir });
    const loaded = mgr2.getChannel(ch.id);
    assert.ok(loaded);
    assert.equal(loaded.name, 'Persist');

    const msgs = mgr2.getMessages(ch.id);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].content, 'hello from disk');
  });
});
