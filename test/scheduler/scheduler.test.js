'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createScheduler, parseSchedule, matchesCron, nextCronMatch } = require('../../control-plane/lib/scheduler');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-sched-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'scheduler'), { recursive: true });
  return dir;
}

// --- NL Parsing ---

describe('parseSchedule - interval patterns', () => {
  it('should parse "every 5 minutes"', () => {
    const result = parseSchedule('every 5 minutes');
    assert.equal(result.cronExpression, '*/5 * * * *');
    assert.equal(result.intervalMs, 300000);
  });

  it('should parse "every minute"', () => {
    const result = parseSchedule('every minute');
    assert.equal(result.cronExpression, '* * * * *');
    assert.equal(result.intervalMs, 60000);
  });

  it('should parse "every hour"', () => {
    const result = parseSchedule('every hour');
    assert.equal(result.cronExpression, '0 * * * *');
    assert.equal(result.intervalMs, 3600000);
  });

  it('should parse "every 1 hour"', () => {
    const result = parseSchedule('every 1 hour');
    assert.equal(result.cronExpression, '0 * * * *');
    assert.equal(result.intervalMs, 3600000);
  });

  it('should parse "every 2 hours"', () => {
    const result = parseSchedule('every 2 hours');
    assert.equal(result.cronExpression, '0 */2 * * *');
    assert.equal(result.intervalMs, 7200000);
  });

  it('should parse "daily"', () => {
    const result = parseSchedule('daily');
    assert.equal(result.cronExpression, '0 0 * * *');
    assert.equal(result.intervalMs, 86400000);
  });

  it('should parse "every day"', () => {
    const result = parseSchedule('every day');
    assert.equal(result.cronExpression, '0 0 * * *');
  });
});

describe('parseSchedule - time-of-day patterns', () => {
  it('should parse "every day at 9am"', () => {
    const result = parseSchedule('every day at 9am');
    assert.equal(result.cronExpression, '0 9 * * *');
  });

  it('should parse "daily at 09:00"', () => {
    const result = parseSchedule('daily at 09:00');
    assert.equal(result.cronExpression, '0 9 * * *');
  });

  it('should parse "daily at 3pm"', () => {
    const result = parseSchedule('daily at 3pm');
    assert.equal(result.cronExpression, '0 15 * * *');
  });

  it('should parse "weekdays at 8am"', () => {
    const result = parseSchedule('weekdays at 8am');
    assert.equal(result.cronExpression, '0 8 * * 1-5');
  });
});

describe('parseSchedule - weekly/monthly patterns', () => {
  it('should parse "weekly"', () => {
    const result = parseSchedule('weekly');
    assert.equal(result.cronExpression, '0 0 * * 0');
  });

  it('should parse "every monday"', () => {
    const result = parseSchedule('every monday');
    assert.equal(result.cronExpression, '0 0 * * 1');
  });

  it('should parse "every monday at 3pm"', () => {
    const result = parseSchedule('every monday at 3pm');
    assert.equal(result.cronExpression, '0 15 * * 1');
  });

  it('should parse "monthly"', () => {
    const result = parseSchedule('monthly');
    assert.equal(result.cronExpression, '0 0 1 * *');
  });

  it('should parse "twice a day"', () => {
    const result = parseSchedule('twice a day');
    assert.equal(result.cronExpression, '0 0,12 * * *');
  });
});

describe('parseSchedule - case insensitivity and errors', () => {
  it('should be case-insensitive', () => {
    const result = parseSchedule('Every 5 Minutes');
    assert.equal(result.cronExpression, '*/5 * * * *');
  });

  it('should throw on empty expression', () => {
    assert.throws(() => parseSchedule(''), /required/);
  });

  it('should throw on unrecognized expression', () => {
    assert.throws(() => parseSchedule('whenever I feel like it'), /Unrecognized/);
  });

  it('should throw on invalid time format', () => {
    assert.throws(() => parseSchedule('daily at nope'), /Unrecognized time/);
  });
});

// --- Cron Matching ---

describe('matchesCron', () => {
  it('should match wildcard', () => {
    // Every minute
    assert.ok(matchesCron('* * * * *', new Date('2026-03-11T10:30:00')));
  });

  it('should match exact minute and hour', () => {
    assert.ok(matchesCron('30 10 * * *', new Date('2026-03-11T10:30:00')));
    assert.ok(!matchesCron('30 10 * * *', new Date('2026-03-11T10:31:00')));
  });

  it('should match step values', () => {
    assert.ok(matchesCron('*/5 * * * *', new Date('2026-03-11T10:15:00')));
    assert.ok(!matchesCron('*/5 * * * *', new Date('2026-03-11T10:13:00')));
  });

  it('should match range values (day of week 1-5)', () => {
    // 2026-03-11 is a Wednesday (day 3)
    assert.ok(matchesCron('0 8 * * 1-5', new Date('2026-03-11T08:00:00')));
    // 2026-03-15 is a Sunday (day 0)
    assert.ok(!matchesCron('0 8 * * 1-5', new Date('2026-03-15T08:00:00')));
  });

  it('should match list values', () => {
    assert.ok(matchesCron('0 0,12 * * *', new Date('2026-03-11T12:00:00')));
    assert.ok(matchesCron('0 0,12 * * *', new Date('2026-03-11T00:00:00')));
    assert.ok(!matchesCron('0 0,12 * * *', new Date('2026-03-11T06:00:00')));
  });

  it('should match day of month', () => {
    assert.ok(matchesCron('0 0 1 * *', new Date('2026-03-01T00:00:00')));
    assert.ok(!matchesCron('0 0 1 * *', new Date('2026-03-02T00:00:00')));
  });
});

// --- Next Run Computation ---

describe('nextCronMatch', () => {
  it('should find next matching minute for */5', () => {
    const from = new Date('2026-03-11T10:12:00');
    const next = nextCronMatch('*/5 * * * *', from);
    assert.ok(next);
    assert.equal(next.getMinutes(), 15);
    assert.equal(next.getHours(), 10);
  });

  it('should find next day for daily cron', () => {
    const from = new Date('2026-03-11T00:01:00');
    const next = nextCronMatch('0 0 * * *', from);
    assert.ok(next);
    assert.equal(next.getDate(), 12);
    assert.equal(next.getHours(), 0);
    assert.equal(next.getMinutes(), 0);
  });

  it('should find next Monday', () => {
    // 2026-03-11 is Wednesday
    const from = new Date('2026-03-11T00:00:00');
    const next = nextCronMatch('0 0 * * 1', from);
    assert.ok(next);
    assert.equal(next.getDay(), 1); // Monday
    assert.equal(next.getDate(), 16);
  });
});

// --- Job CRUD ---

describe('Job CRUD', () => {
  let scheduler;
  beforeEach(() => {
    scheduler = createScheduler();
  });

  it('should create a job', () => {
    const job = scheduler.createJob({
      name: 'Test Job',
      schedule: 'every 5 minutes',
      action: { type: 'command', config: { cmd: 'echo hello' } }
    });
    assert.ok(job.id);
    assert.equal(job.name, 'Test Job');
    assert.equal(job.cronExpression, '*/5 * * * *');
    assert.equal(job.enabled, true);
    assert.equal(job.status, 'active');
    assert.ok(job.nextRunAt);
  });

  it('should get a job by id', () => {
    const job = scheduler.createJob({
      name: 'Get Me',
      schedule: 'daily',
      action: { type: 'command' }
    });
    const fetched = scheduler.getJob(job.id);
    assert.equal(fetched.name, 'Get Me');
  });

  it('should return null for unknown job id', () => {
    assert.equal(scheduler.getJob('nonexistent'), null);
  });

  it('should list all jobs', () => {
    scheduler.createJob({ name: 'Job A', schedule: 'daily', action: { type: 'command' } });
    scheduler.createJob({ name: 'Job B', schedule: 'weekly', action: { type: 'task' } });
    const jobs = scheduler.listJobs();
    assert.equal(jobs.length, 2);
  });

  it('should update a job', () => {
    const job = scheduler.createJob({ name: 'Old Name', schedule: 'daily', action: { type: 'command' } });
    const updated = scheduler.updateJob(job.id, { name: 'New Name' });
    assert.equal(updated.name, 'New Name');
  });

  it('should re-parse schedule on update', () => {
    const job = scheduler.createJob({ name: 'Re-parse', schedule: 'daily', action: { type: 'command' } });
    assert.equal(job.cronExpression, '0 0 * * *');
    const updated = scheduler.updateJob(job.id, { schedule: 'every 5 minutes' });
    assert.equal(updated.cronExpression, '*/5 * * * *');
  });

  it('should delete a job', () => {
    const job = scheduler.createJob({ name: 'Delete Me', schedule: 'daily', action: { type: 'command' } });
    scheduler.deleteJob(job.id);
    assert.equal(scheduler.getJob(job.id), null);
  });

  it('should throw on create with missing name', () => {
    assert.throws(() => scheduler.createJob({ schedule: 'daily', action: { type: 'command' } }), /name is required/);
  });

  it('should throw on create with invalid action type', () => {
    assert.throws(() => scheduler.createJob({ name: 'Bad', schedule: 'daily', action: { type: 'invalid' } }), /Invalid action type/);
  });

  it('should throw on delete unknown job', () => {
    assert.throws(() => scheduler.deleteJob('nope'), /not found/);
  });
});

// --- Pause/Resume ---

describe('Pause and resume', () => {
  let scheduler;
  beforeEach(() => {
    scheduler = createScheduler();
  });

  it('should pause a job', () => {
    const job = scheduler.createJob({ name: 'Pausable', schedule: 'daily', action: { type: 'command' } });
    const paused = scheduler.pauseJob(job.id);
    assert.equal(paused.enabled, false);
    assert.equal(paused.status, 'paused');
  });

  it('should resume a paused job', () => {
    const job = scheduler.createJob({ name: 'Resumable', schedule: 'daily', action: { type: 'command' } });
    scheduler.pauseJob(job.id);
    const resumed = scheduler.resumeJob(job.id);
    assert.equal(resumed.enabled, true);
    assert.equal(resumed.status, 'active');
    assert.ok(resumed.nextRunAt);
  });

  it('should filter by status', () => {
    scheduler.createJob({ name: 'Active', schedule: 'daily', action: { type: 'command' } });
    const job2 = scheduler.createJob({ name: 'Paused', schedule: 'daily', action: { type: 'command' } });
    scheduler.pauseJob(job2.id);
    const active = scheduler.listJobs({ status: 'active' });
    assert.equal(active.length, 1);
    assert.equal(active[0].name, 'Active');
    const paused = scheduler.listJobs({ status: 'paused' });
    assert.equal(paused.length, 1);
    assert.equal(paused[0].name, 'Paused');
  });
});

// --- Job Execution and History ---

describe('Job execution and history', () => {
  it('should execute a command job and record history', () => {
    const scheduler = createScheduler();
    const job = scheduler.createJob({ name: 'Exec Test', schedule: 'daily', action: { type: 'command', config: { cmd: 'ls' } } });
    const result = scheduler.runJob(job.id);
    assert.equal(result.status, 'success');
    assert.ok(result.output.includes('Command logged'));
    const history = scheduler.getHistory(job.id);
    assert.equal(history.length, 1);
    const updated = scheduler.getJob(job.id);
    assert.equal(updated.runCount, 1);
    assert.ok(updated.lastRunAt);
  });

  it('should execute a task job and create child task with dated name', () => {
    const createdTasks = [];
    const mockTaskManager = {
      createTask(data) {
        const task = { id: 'task-' + createdTasks.length, ...data };
        createdTasks.push(task);
        return task;
      }
    };
    const scheduler = createScheduler({ taskManager: mockTaskManager });
    const job = scheduler.createJob({ name: 'Daily Report', schedule: 'daily', action: { type: 'task' } });
    scheduler.runJob(job.id);
    assert.equal(createdTasks.length, 1);
    assert.ok(createdTasks[0].title.startsWith('Daily Report - '));
    // Title should contain a month abbreviation
    assert.ok(/- (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+/.test(createdTasks[0].title));
    assert.ok(createdTasks[0].tags.includes('scheduled'));
  });

  it('should keep only last 50 history entries', () => {
    const scheduler = createScheduler();
    const job = scheduler.createJob({ name: 'Many Runs', schedule: 'every minute', action: { type: 'command' } });
    for (let i = 0; i < 55; i++) {
      scheduler.runJob(job.id);
    }
    const history = scheduler.getHistory(job.id);
    assert.equal(history.length, 50);
  });

  it('should throw on manual trigger of unknown job', () => {
    const scheduler = createScheduler();
    assert.throws(() => scheduler.runJob('ghost'), /not found/);
  });
});

// --- Tick (scheduled execution) ---

describe('Tick - scheduled execution', () => {
  it('should execute jobs whose nextRunAt has passed', () => {
    const scheduler = createScheduler();
    const job = scheduler.createJob({ name: 'Tick Test', schedule: 'every minute', action: { type: 'command' } });
    // Force nextRunAt to the past
    const j = scheduler.getJob(job.id);
    j.nextRunAt = Date.now() - 1000;
    scheduler.tick();
    const updated = scheduler.getJob(job.id);
    assert.equal(updated.runCount, 1);
    assert.ok(updated.nextRunAt > Date.now() - 5000);
  });

  it('should not execute paused jobs on tick', () => {
    const scheduler = createScheduler();
    const job = scheduler.createJob({ name: 'Paused Tick', schedule: 'every minute', action: { type: 'command' } });
    scheduler.pauseJob(job.id);
    const j = scheduler.getJob(job.id);
    j.nextRunAt = Date.now() - 1000;
    scheduler.tick();
    assert.equal(j.runCount, 0);
  });
});

// --- Persistence ---

describe('Persistence', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should persist and reload jobs from disk', () => {
    tmpDir = makeTmpDir();
    const s1 = createScheduler({ dataDir: tmpDir });
    s1.createJob({ name: 'Persist Me', schedule: 'daily', action: { type: 'command' } });
    const jobs1 = s1.listJobs();
    assert.equal(jobs1.length, 1);

    // Create a new scheduler from the same dir to verify persistence
    const s2 = createScheduler({ dataDir: tmpDir });
    const jobs2 = s2.listJobs();
    assert.equal(jobs2.length, 1);
    assert.equal(jobs2[0].name, 'Persist Me');
  });
});
