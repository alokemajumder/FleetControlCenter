'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * createChannelManager - Factory for real-time communication channels.
 * Provides channel CRUD, messaging, SSE subscriptions, and persistence.
 */
function createChannelManager(opts = {}) {
  const dataDir = opts.dataDir || null;
  const channelsDir = dataDir ? path.join(dataDir, 'channels') : null;
  const channelsFile = channelsDir ? path.join(channelsDir, 'channels.json') : null;

  // In-memory state
  const channels = new Map();           // channelId -> channel object
  const messages = new Map();           // channelId -> message[]
  const subscribers = new Map();        // channelId -> Set<callback>

  const MAX_MESSAGES_IN_MEMORY = opts.maxMessagesPerChannel || 1000;

  // --- Persistence helpers ---

  function ensureDir() {
    if (channelsDir) {
      fs.mkdirSync(channelsDir, { recursive: true });
    }
  }

  function saveChannels() {
    if (!channelsFile) return;
    ensureDir();
    const data = {};
    for (const [id, ch] of channels) {
      data[id] = ch;
    }
    const tmp = channelsFile + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, channelsFile);
    } catch (err) {
      console.error('Channel save error:', err.message);
    }
  }

  function loadChannels() {
    if (!channelsFile) return;
    ensureDir();
    try {
      if (fs.existsSync(channelsFile)) {
        const data = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
        for (const [id, ch] of Object.entries(data)) {
          channels.set(id, ch);
        }
      }
    } catch (err) {
      console.error('Channel load error:', err.message);
    }
  }

  function appendMessage(channelId, msg) {
    if (!channelsDir) return;
    ensureDir();
    const filePath = path.join(channelsDir, channelId + '.jsonl');
    try {
      fs.appendFileSync(filePath, JSON.stringify(msg) + '\n');
    } catch (err) {
      console.error('Message write error:', err.message);
    }
  }

  function loadMessages(channelId) {
    if (!channelsDir) return [];
    const filePath = path.join(channelsDir, channelId + '.jsonl');
    try {
      if (!fs.existsSync(filePath)) return [];
      const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
      return lines.map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  function deleteMessageFile(channelId) {
    if (!channelsDir) return;
    const filePath = path.join(channelsDir, channelId + '.jsonl');
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }

  // --- Init ---

  loadChannels();

  // Load recent messages for existing channels
  for (const id of channels.keys()) {
    const msgs = loadMessages(id);
    // Keep only the latest N in memory
    const start = Math.max(0, msgs.length - MAX_MESSAGES_IN_MEMORY);
    messages.set(id, msgs.slice(start));
  }

  // Auto-create "general" broadcast channel on first init
  if (channels.size === 0) {
    const generalId = 'general';
    const general = {
      id: generalId,
      name: 'General',
      type: 'broadcast',
      description: 'Default broadcast channel for all agents and operators',
      createdBy: 'system',
      createdAt: Date.now(),
      members: [],
      pinned: true,
      archived: false
    };
    channels.set(generalId, general);
    messages.set(generalId, []);
    saveChannels();
  }

  // --- Channel operations ---

  function createChannel(data) {
    const id = data.id || crypto.randomUUID();
    const channel = {
      id,
      name: data.name || 'Unnamed Channel',
      type: data.type || 'group',
      description: data.description || '',
      createdBy: data.createdBy || 'system',
      createdAt: data.createdAt || Date.now(),
      members: data.members || [],
      pinned: data.pinned || false,
      archived: false
    };
    channels.set(id, channel);
    messages.set(id, []);
    saveChannels();
    return channel;
  }

  function getChannel(id) {
    return channels.get(id) || null;
  }

  function listChannels(filters = {}) {
    let result = [];
    for (const ch of channels.values()) {
      if (filters.type && ch.type !== filters.type) continue;
      if (filters.archived !== undefined && ch.archived !== filters.archived) continue;
      if (filters.member) {
        const hasMember = ch.members.some(m => m.id === filters.member);
        if (!hasMember && ch.type !== 'broadcast') continue;
      }
      result.push(ch);
    }
    return result;
  }

  function updateChannel(id, updates) {
    const ch = channels.get(id);
    if (!ch) return null;
    if (updates.name !== undefined) ch.name = updates.name;
    if (updates.description !== undefined) ch.description = updates.description;
    if (updates.pinned !== undefined) ch.pinned = updates.pinned;
    saveChannels();
    return ch;
  }

  function archiveChannel(id) {
    const ch = channels.get(id);
    if (!ch) return null;
    ch.archived = true;
    saveChannels();
    return ch;
  }

  function deleteChannel(id) {
    const ch = channels.get(id);
    if (!ch) return false;
    channels.delete(id);
    messages.delete(id);
    deleteMessageFile(id);
    // Clean up subscribers
    subscribers.delete(id);
    saveChannels();
    return true;
  }

  function joinChannel(channelId, member) {
    const ch = channels.get(channelId);
    if (!ch) return null;
    // Prevent duplicate join
    const existing = ch.members.find(m => m.id === member.id);
    if (existing) return ch;
    ch.members.push({
      id: member.id,
      type: member.type || 'user',
      joinedAt: member.joinedAt || Date.now()
    });
    saveChannels();
    return ch;
  }

  function leaveChannel(channelId, memberId) {
    const ch = channels.get(channelId);
    if (!ch) return null;
    ch.members = ch.members.filter(m => m.id !== memberId);
    saveChannels();
    return ch;
  }

  // --- Message operations ---

  function sendMessage(channelId, msgData) {
    const ch = channels.get(channelId);
    if (!ch) return null;

    const msg = {
      id: msgData.id || crypto.randomUUID(),
      channelId,
      senderId: msgData.senderId || 'unknown',
      senderType: msgData.senderType || 'user',
      senderName: msgData.senderName || 'Unknown',
      content: msgData.content || '',
      timestamp: msgData.timestamp || Date.now(),
      metadata: msgData.metadata || {},
      replyTo: msgData.replyTo || null
    };

    // Store in memory
    let channelMsgs = messages.get(channelId);
    if (!channelMsgs) {
      channelMsgs = [];
      messages.set(channelId, channelMsgs);
    }
    channelMsgs.push(msg);

    // Evict oldest if over cap
    while (channelMsgs.length > MAX_MESSAGES_IN_MEMORY) {
      channelMsgs.shift();
    }

    // Persist
    appendMessage(channelId, msg);

    // Notify SSE subscribers
    const subs = subscribers.get(channelId);
    if (subs) {
      for (const cb of subs) {
        try { cb(msg); } catch { /* ignore */ }
      }
    }

    return msg;
  }

  function getMessages(channelId, opts = {}) {
    const channelMsgs = messages.get(channelId);
    if (!channelMsgs) return [];

    let result = [...channelMsgs];

    if (opts.after) {
      result = result.filter(m => m.timestamp > opts.after);
    }
    if (opts.before) {
      result = result.filter(m => m.timestamp < opts.before);
    }

    // Sort by timestamp ascending
    result.sort((a, b) => a.timestamp - b.timestamp);

    const limit = opts.limit || 50;
    // Return last N messages (most recent)
    if (result.length > limit) {
      result = result.slice(result.length - limit);
    }

    return result;
  }

  function getMessage(channelId, messageId) {
    const channelMsgs = messages.get(channelId);
    if (!channelMsgs) return null;
    return channelMsgs.find(m => m.id === messageId) || null;
  }

  // --- SSE subscription ---

  function subscribe(channelId, callback) {
    let subs = subscribers.get(channelId);
    if (!subs) {
      subs = new Set();
      subscribers.set(channelId, subs);
    }
    subs.add(callback);
  }

  function unsubscribe(channelId, callback) {
    const subs = subscribers.get(channelId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) subscribers.delete(channelId);
    }
  }

  // --- Utility ---

  function getUnreadCount(channelId, userId, lastReadTs) {
    const channelMsgs = messages.get(channelId);
    if (!channelMsgs) return 0;
    return channelMsgs.filter(m => m.timestamp > lastReadTs).length;
  }

  function searchMessages(query, opts = {}) {
    if (!query) return [];
    const lowerQuery = query.toLowerCase();
    const results = [];
    const channelFilter = opts.channelId || null;
    const limit = opts.limit || 50;

    const channelsToSearch = channelFilter
      ? [channelFilter]
      : Array.from(channels.keys());

    for (const chId of channelsToSearch) {
      const channelMsgs = messages.get(chId);
      if (!channelMsgs) continue;
      for (const msg of channelMsgs) {
        if (msg.content && msg.content.toLowerCase().includes(lowerQuery)) {
          results.push(msg);
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  return {
    createChannel,
    getChannel,
    listChannels,
    updateChannel,
    archiveChannel,
    deleteChannel,
    joinChannel,
    leaveChannel,
    sendMessage,
    getMessages,
    getMessage,
    subscribe,
    unsubscribe,
    getUnreadCount,
    searchMessages
  };
}

module.exports = { createChannelManager };
