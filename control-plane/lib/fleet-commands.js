'use strict';

/**
 * Shared pending-commands queue for fleet nodes.
 * Used by fleet-routes (heartbeat drains commands) and kill-switch (queues kill commands).
 */

const PENDING_COMMANDS_MAX = 500; // max total entries across all nodes
const PER_NODE_MAX = 50;

const pendingCommands = new Map(); // nodeId -> commands[]

function queueCommand(nodeId, command) {
  const cmds = pendingCommands.get(nodeId) || [];
  if (cmds.length >= PER_NODE_MAX) {
    return { queued: false, reason: 'Too many pending commands for this node' };
  }
  cmds.push(command);
  pendingCommands.set(nodeId, cmds);
  // Evict empty entries if map is too large
  if (pendingCommands.size > PENDING_COMMANDS_MAX) {
    for (const [nid, ncmds] of pendingCommands) {
      if (ncmds.length === 0) pendingCommands.delete(nid);
    }
  }
  return { queued: true };
}

function drainCommands(nodeId) {
  const cmds = pendingCommands.get(nodeId) || [];
  pendingCommands.set(nodeId, []);
  return cmds;
}

function getQueuedCount(nodeId) {
  return (pendingCommands.get(nodeId) || []).length;
}

module.exports = { queueCommand, drainCommands, getQueuedCount, PER_NODE_MAX, PENDING_COMMANDS_MAX };
