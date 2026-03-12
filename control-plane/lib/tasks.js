'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_STATUSES = ['inbox', 'assigned', 'in_progress', 'review', 'done', 'archived'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_ASSIGNEE_TYPES = ['agent', 'user'];
const MAX_TASKS = 10000;

const STATUS_TRANSITIONS = {
  inbox: ['assigned', 'in_progress', 'archived'],
  assigned: ['in_progress', 'inbox', 'archived'],
  in_progress: ['review', 'assigned', 'archived'],
  review: ['done', 'in_progress', 'archived'],
  done: ['archived'],
  archived: ['inbox']
};

function createTaskManager(opts = {}) {
  const dataDir = opts.dataDir || null;
  const tasksDir = dataDir ? path.join(dataDir, 'tasks') : null;
  const tasksFile = tasksDir ? path.join(tasksDir, 'tasks.json') : null;
  let tasks = new Map();

  // Load from disk on init
  if (tasksFile) {
    try {
      const raw = fs.readFileSync(tasksFile, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const t of arr) {
          tasks.set(t.id, t);
        }
      }
    } catch { /* no file yet */ }
  }

  function persist() {
    if (!tasksFile) return;
    try {
      fs.mkdirSync(tasksDir, { recursive: true });
      const tmpPath = tasksFile + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(Array.from(tasks.values()), null, 2));
      fs.renameSync(tmpPath, tasksFile);
    } catch { /* ignore write errors */ }
  }

  function enforceCapacity() {
    if (tasks.size <= MAX_TASKS) return;
    // Archive oldest completed tasks first, then remove oldest archived
    const completed = Array.from(tasks.values())
      .filter(t => t.status === 'done')
      .sort((a, b) => a.completedAt - b.completedAt);
    for (const t of completed) {
      if (tasks.size <= MAX_TASKS) break;
      t.status = 'archived';
      t.updatedAt = Date.now();
    }
    if (tasks.size > MAX_TASKS) {
      const archived = Array.from(tasks.values())
        .filter(t => t.status === 'archived')
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const t of archived) {
        if (tasks.size <= MAX_TASKS) break;
        tasks.delete(t.id);
      }
    }
  }

  function createTask(data) {
    if (!data || !data.title || typeof data.title !== 'string' || data.title.trim().length < 1) {
      throw new Error('Title is required (min 1 character)');
    }
    if (data.priority && !VALID_PRIORITIES.includes(data.priority)) {
      throw new Error('Invalid priority: ' + data.priority);
    }
    if (data.status && !VALID_STATUSES.includes(data.status)) {
      throw new Error('Invalid status: ' + data.status);
    }
    if (data.assigneeType && !VALID_ASSIGNEE_TYPES.includes(data.assigneeType)) {
      throw new Error('Invalid assigneeType: ' + data.assigneeType);
    }

    const now = Date.now();
    const task = {
      id: crypto.randomUUID(),
      title: data.title.trim(),
      description: data.description || '',
      status: data.status || 'inbox',
      priority: data.priority || 'medium',
      assignee: data.assignee || null,
      assigneeType: data.assigneeType || null,
      createdBy: data.createdBy || 'unknown',
      sessionId: data.sessionId || null,
      nodeId: data.nodeId || null,
      tags: Array.isArray(data.tags) ? data.tags : [],
      comments: [],
      dueAt: data.dueAt || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };

    tasks.set(task.id, task);
    enforceCapacity();
    persist();
    return task;
  }

  function getTask(id) {
    return tasks.get(id) || null;
  }

  function listTasks(filters = {}) {
    let result = Array.from(tasks.values());
    if (filters.status) {
      result = result.filter(t => t.status === filters.status);
    }
    if (filters.priority) {
      result = result.filter(t => t.priority === filters.priority);
    }
    if (filters.assignee) {
      result = result.filter(t => t.assignee === filters.assignee);
    }
    if (filters.tag) {
      result = result.filter(t => t.tags.includes(filters.tag));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    }
    return result;
  }

  function updateTask(id, updates) {
    const task = tasks.get(id);
    if (!task) throw new Error('Task not found: ' + id);
    if (updates.title !== undefined) {
      if (typeof updates.title !== 'string' || updates.title.trim().length < 1) {
        throw new Error('Title is required (min 1 character)');
      }
      task.title = updates.title.trim();
    }
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(updates.priority)) {
        throw new Error('Invalid priority: ' + updates.priority);
      }
      task.priority = updates.priority;
    }
    if (updates.tags !== undefined) task.tags = Array.isArray(updates.tags) ? updates.tags : [];
    if (updates.dueAt !== undefined) task.dueAt = updates.dueAt;
    if (updates.sessionId !== undefined) task.sessionId = updates.sessionId;
    if (updates.nodeId !== undefined) task.nodeId = updates.nodeId;
    task.updatedAt = Date.now();
    persist();
    return task;
  }

  function moveTask(id, status) {
    const task = tasks.get(id);
    if (!task) throw new Error('Task not found: ' + id);
    if (!VALID_STATUSES.includes(status)) {
      throw new Error('Invalid status: ' + status);
    }
    const allowed = STATUS_TRANSITIONS[task.status];
    if (!allowed || !allowed.includes(status)) {
      throw new Error('Invalid transition from ' + task.status + ' to ' + status);
    }
    task.status = status;
    task.updatedAt = Date.now();
    if (status === 'done') {
      task.completedAt = Date.now();
    }
    persist();
    return task;
  }

  function assignTask(id, assignee, assigneeType) {
    const task = tasks.get(id);
    if (!task) throw new Error('Task not found: ' + id);
    if (assigneeType && !VALID_ASSIGNEE_TYPES.includes(assigneeType)) {
      throw new Error('Invalid assigneeType: ' + assigneeType);
    }
    task.assignee = assignee || null;
    task.assigneeType = assigneeType || null;
    task.updatedAt = Date.now();
    persist();
    return task;
  }

  function addComment(taskId, comment) {
    const task = tasks.get(taskId);
    if (!task) throw new Error('Task not found: ' + taskId);
    if (!comment || !comment.content || typeof comment.content !== 'string' || comment.content.trim().length < 1) {
      throw new Error('Comment content is required');
    }
    const entry = {
      id: crypto.randomUUID(),
      author: comment.author || 'unknown',
      content: comment.content.trim(),
      createdAt: Date.now()
    };
    task.comments.push(entry);
    task.updatedAt = Date.now();
    persist();
    return entry;
  }

  function getComments(taskId) {
    const task = tasks.get(taskId);
    if (!task) throw new Error('Task not found: ' + taskId);
    return task.comments;
  }

  function deleteTask(id) {
    const task = tasks.get(id);
    if (!task) throw new Error('Task not found: ' + id);
    task.status = 'archived';
    task.updatedAt = Date.now();
    persist();
    return task;
  }

  function getByStatus() {
    const grouped = {};
    for (const s of VALID_STATUSES) {
      grouped[s] = [];
    }
    for (const task of tasks.values()) {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      }
    }
    return grouped;
  }

  function getStats() {
    const byStatus = {};
    const byPriority = {};
    let overdue = 0;
    const now = Date.now();
    for (const s of VALID_STATUSES) byStatus[s] = 0;
    for (const p of VALID_PRIORITIES) byPriority[p] = 0;
    for (const task of tasks.values()) {
      if (byStatus[task.status] !== undefined) byStatus[task.status]++;
      if (byPriority[task.priority] !== undefined) byPriority[task.priority]++;
      if (task.dueAt && task.dueAt < now && task.status !== 'done' && task.status !== 'archived') {
        overdue++;
      }
    }
    return { total: tasks.size, byStatus, byPriority, overdue };
  }

  function searchTasks(query) {
    if (!query || typeof query !== 'string') return [];
    const q = query.toLowerCase();
    return Array.from(tasks.values()).filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  }

  function getTasksByAssignee(assigneeId) {
    return Array.from(tasks.values()).filter(t => t.assignee === assigneeId);
  }

  function getTasksBySession(sessionId) {
    return Array.from(tasks.values()).filter(t => t.sessionId === sessionId);
  }

  return {
    createTask,
    getTask,
    listTasks,
    updateTask,
    moveTask,
    assignTask,
    addComment,
    getComments,
    deleteTask,
    getByStatus,
    getStats,
    searchTasks,
    getTasksByAssignee,
    getTasksBySession
  };
}

module.exports = { createTaskManager, VALID_STATUSES, VALID_PRIORITIES, STATUS_TRANSITIONS };
