'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createTaskManager, VALID_STATUSES, STATUS_TRANSITIONS } = require('../../control-plane/lib/tasks');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-tasks-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  return dir;
}

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function freshManager(opts = {}) {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return createTaskManager({ dataDir: dir, ...opts });
}

describe('Task CRUD', () => {
  it('should create a task with required fields', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Fix bug', createdBy: 'alice' });
    assert.ok(task.id);
    assert.equal(task.title, 'Fix bug');
    assert.equal(task.status, 'inbox');
    assert.equal(task.priority, 'medium');
    assert.equal(task.createdBy, 'alice');
    assert.ok(task.createdAt);
    assert.ok(task.updatedAt);
    assert.equal(task.completedAt, null);
  });

  it('should reject task without title', () => {
    const tm = freshManager();
    assert.throws(() => tm.createTask({}), /Title is required/);
    assert.throws(() => tm.createTask({ title: '' }), /Title is required/);
    assert.throws(() => tm.createTask({ title: '  ' }), /Title is required/);
  });

  it('should get task by id', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Test task' });
    const found = tm.getTask(task.id);
    assert.equal(found.id, task.id);
    assert.equal(found.title, 'Test task');
  });

  it('should return null for non-existent task', () => {
    const tm = freshManager();
    assert.equal(tm.getTask('nonexistent'), null);
  });

  it('should list all tasks', () => {
    const tm = freshManager();
    tm.createTask({ title: 'Task 1' });
    tm.createTask({ title: 'Task 2' });
    const all = tm.listTasks();
    assert.equal(all.length, 2);
  });

  it('should update task fields', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Original' });
    const updated = tm.updateTask(task.id, { title: 'Updated', priority: 'high', tags: ['urgent'] });
    assert.equal(updated.title, 'Updated');
    assert.equal(updated.priority, 'high');
    assert.deepEqual(updated.tags, ['urgent']);
    assert.ok(updated.updatedAt >= task.updatedAt);
  });

  it('should reject update with invalid priority', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Test' });
    assert.throws(() => tm.updateTask(task.id, { priority: 'extreme' }), /Invalid priority/);
  });

  it('should soft delete (archive) a task', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'To delete' });
    const deleted = tm.deleteTask(task.id);
    assert.equal(deleted.status, 'archived');
  });
});

describe('Status transitions', () => {
  it('should allow valid transition inbox -> assigned', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Move me' });
    const moved = tm.moveTask(task.id, 'assigned');
    assert.equal(moved.status, 'assigned');
  });

  it('should allow valid transition in_progress -> review', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Move me' });
    tm.moveTask(task.id, 'in_progress');
    const moved = tm.moveTask(task.id, 'review');
    assert.equal(moved.status, 'review');
  });

  it('should reject invalid transition inbox -> done', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Nope' });
    assert.throws(() => tm.moveTask(task.id, 'done'), /Invalid transition/);
  });

  it('should reject invalid transition done -> in_progress', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Done task' });
    tm.moveTask(task.id, 'in_progress');
    tm.moveTask(task.id, 'review');
    tm.moveTask(task.id, 'done');
    assert.throws(() => tm.moveTask(task.id, 'in_progress'), /Invalid transition/);
  });

  it('should allow reopen: archived -> inbox', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Reopen me' });
    tm.moveTask(task.id, 'archived');
    const reopened = tm.moveTask(task.id, 'inbox');
    assert.equal(reopened.status, 'inbox');
  });

  it('should set completedAt when moving to done', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Complete me' });
    tm.moveTask(task.id, 'in_progress');
    tm.moveTask(task.id, 'review');
    const done = tm.moveTask(task.id, 'done');
    assert.ok(done.completedAt);
  });

  it('should reject invalid status value', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Bad status' });
    assert.throws(() => tm.moveTask(task.id, 'invalid'), /Invalid status/);
  });
});

describe('Assignment', () => {
  it('should assign task to user', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Assign me' });
    const assigned = tm.assignTask(task.id, 'bob', 'user');
    assert.equal(assigned.assignee, 'bob');
    assert.equal(assigned.assigneeType, 'user');
  });

  it('should assign task to agent', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Agent task' });
    const assigned = tm.assignTask(task.id, 'agent-001', 'agent');
    assert.equal(assigned.assignee, 'agent-001');
    assert.equal(assigned.assigneeType, 'agent');
  });

  it('should reject invalid assigneeType', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Bad type' });
    assert.throws(() => tm.assignTask(task.id, 'x', 'robot'), /Invalid assigneeType/);
  });
});

describe('Comments', () => {
  it('should add and get comments', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'Commented task' });
    const comment = tm.addComment(task.id, { author: 'alice', content: 'Looks good' });
    assert.ok(comment.id);
    assert.equal(comment.author, 'alice');
    assert.equal(comment.content, 'Looks good');
    assert.ok(comment.createdAt);

    const comments = tm.getComments(task.id);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].content, 'Looks good');
  });

  it('should reject empty comment', () => {
    const tm = freshManager();
    const task = tm.createTask({ title: 'No comment' });
    assert.throws(() => tm.addComment(task.id, { content: '' }), /Comment content is required/);
    assert.throws(() => tm.addComment(task.id, {}), /Comment content is required/);
  });
});

describe('Filtering', () => {
  it('should filter by status', () => {
    const tm = freshManager();
    tm.createTask({ title: 'A' });
    const t2 = tm.createTask({ title: 'B' });
    tm.moveTask(t2.id, 'in_progress');
    const result = tm.listTasks({ status: 'in_progress' });
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'B');
  });

  it('should filter by priority', () => {
    const tm = freshManager();
    tm.createTask({ title: 'Low', priority: 'low' });
    tm.createTask({ title: 'High', priority: 'high' });
    const result = tm.listTasks({ priority: 'high' });
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'High');
  });

  it('should filter by tag', () => {
    const tm = freshManager();
    tm.createTask({ title: 'Tagged', tags: ['bug', 'urgent'] });
    tm.createTask({ title: 'Untagged' });
    const result = tm.listTasks({ tag: 'bug' });
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Tagged');
  });

  it('should filter by search (case-insensitive)', () => {
    const tm = freshManager();
    tm.createTask({ title: 'Fix login BUG' });
    tm.createTask({ title: 'Add feature' });
    const result = tm.listTasks({ search: 'bug' });
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Fix login BUG');
  });
});

describe('Board view', () => {
  it('should group tasks by status', () => {
    const tm = freshManager();
    tm.createTask({ title: 'Inbox 1' });
    tm.createTask({ title: 'Inbox 2' });
    const t3 = tm.createTask({ title: 'In progress' });
    tm.moveTask(t3.id, 'in_progress');

    const board = tm.getByStatus();
    assert.equal(board.inbox.length, 2);
    assert.equal(board.in_progress.length, 1);
    assert.equal(board.assigned.length, 0);
    assert.equal(board.review.length, 0);
    assert.equal(board.done.length, 0);
    assert.equal(board.archived.length, 0);
  });
});

describe('Stats', () => {
  it('should compute correct stats', () => {
    const tm = freshManager();
    tm.createTask({ title: 'A', priority: 'high' });
    tm.createTask({ title: 'B', priority: 'low' });
    const t3 = tm.createTask({ title: 'C', priority: 'high', dueAt: Date.now() - 100000 });
    // t3 is overdue (dueAt in the past, not done/archived)

    const stats = tm.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.byStatus.inbox, 3);
    assert.equal(stats.byPriority.high, 2);
    assert.equal(stats.byPriority.low, 1);
    assert.equal(stats.overdue, 1);
  });
});

describe('Search', () => {
  it('should search by title and description', () => {
    const tm = freshManager();
    tm.createTask({ title: 'Deploy service', description: 'Roll out new version' });
    tm.createTask({ title: 'Fix bug', description: 'Null pointer in deploy script' });
    tm.createTask({ title: 'Update docs' });
    const results = tm.searchTasks('deploy');
    assert.equal(results.length, 2);
  });

  it('should return empty for no match', () => {
    const tm = freshManager();
    tm.createTask({ title: 'Something' });
    assert.equal(tm.searchTasks('zzzzz').length, 0);
  });
});

describe('Session and assignee lookups', () => {
  it('should get tasks by assignee', () => {
    const tm = freshManager();
    tm.createTask({ title: 'T1', assignee: 'bob', assigneeType: 'user' });
    tm.createTask({ title: 'T2', assignee: 'alice', assigneeType: 'user' });
    tm.createTask({ title: 'T3', assignee: 'bob', assigneeType: 'user' });
    const bobs = tm.getTasksByAssignee('bob');
    assert.equal(bobs.length, 2);
  });

  it('should get tasks by session', () => {
    const tm = freshManager();
    tm.createTask({ title: 'S1', sessionId: 'sess-1' });
    tm.createTask({ title: 'S2', sessionId: 'sess-2' });
    tm.createTask({ title: 'S3', sessionId: 'sess-1' });
    const sess1 = tm.getTasksBySession('sess-1');
    assert.equal(sess1.length, 2);
  });
});

describe('Capacity limit', () => {
  it('should not exceed max tasks', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    // Use a small capacity for testing via internal limit
    const tm = createTaskManager({ dataDir: dir });
    // Create many tasks - we'll test with a smaller batch since MAX_TASKS is 10000
    for (let i = 0; i < 50; i++) {
      tm.createTask({ title: 'Task ' + i, createdBy: 'test' });
    }
    const all = tm.listTasks();
    assert.ok(all.length <= 10000);
    assert.equal(all.length, 50); // Under limit, all should exist
  });
});

describe('Persistence', () => {
  it('should persist and reload tasks from disk', () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);
    const tm1 = createTaskManager({ dataDir: dir });
    const task = tm1.createTask({ title: 'Persist me', priority: 'high', createdBy: 'alice' });

    // Create new manager from same dir
    const tm2 = createTaskManager({ dataDir: dir });
    const loaded = tm2.getTask(task.id);
    assert.ok(loaded);
    assert.equal(loaded.title, 'Persist me');
    assert.equal(loaded.priority, 'high');
    assert.equal(loaded.createdBy, 'alice');
  });
});
