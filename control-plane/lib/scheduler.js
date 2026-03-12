'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY_NAMES = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MAX_HISTORY = 50;
const MAX_JOBS = 5000;
const SCAN_LIMIT_DAYS = 366;

/**
 * Parse a single cron field against a value.
 * Supports: * (wildcard), exact number, list (1,3,5), range (1-5), step ( * /5, 1-10/2)
 */
function matchCronField(field, value, min, max) {
  if (field === '*') return true;
  // Step on wildcard: */n
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return value % step === 0;
  }
  // List: 1,3,5
  if (field.includes(',')) {
    return field.split(',').some(part => matchCronField(part.trim(), value, min, max));
  }
  // Range with optional step: 1-5 or 1-5/2
  if (field.includes('-')) {
    const [rangePart, stepPart] = field.split('/');
    const [startStr, endStr] = rangePart.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return false;
    if (value < start || value > end) return false;
    if (stepPart) {
      const step = parseInt(stepPart, 10);
      if (isNaN(step) || step <= 0) return false;
      return (value - start) % step === 0;
    }
    return true;
  }
  // Exact value
  return parseInt(field, 10) === value;
}

/**
 * Check if a Date matches a 5-field cron expression.
 * Fields: minute hour dayOfMonth month dayOfWeek
 */
function matchesCron(cronExpr, date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minF, hourF, domF, monF, dowF] = parts;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dayOfWeek = date.getDay(); // 0=Sun

  if (!matchCronField(minF, minute, 0, 59)) return false;
  if (!matchCronField(hourF, hour, 0, 23)) return false;
  if (!matchCronField(monF, month, 1, 12)) return false;
  // DOM and DOW: both must match (unless one is wildcard)
  const domWild = domF === '*';
  const dowWild = dowF === '*';
  if (domWild && dowWild) return true;
  if (!domWild && !dowWild) {
    // Both specified: match if either matches (standard cron behavior)
    return matchCronField(domF, dayOfMonth, 1, 31) || matchCronField(dowF, dayOfWeek, 0, 6);
  }
  if (!domWild && !matchCronField(domF, dayOfMonth, 1, 31)) return false;
  if (!dowWild && !matchCronField(dowF, dayOfWeek, 0, 6)) return false;
  return true;
}

/**
 * Find the next Date (minute-resolution) that matches a cron expression.
 * Scans forward from `fromDate` up to SCAN_LIMIT_DAYS days.
 */
function nextCronMatch(cronExpr, fromDate) {
  const d = new Date(fromDate.getTime());
  // Start from the next minute
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = d.getTime() + SCAN_LIMIT_DAYS * 86400000;
  while (d.getTime() < limit) {
    if (matchesCron(cronExpr, d)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/**
 * Parse a time string like "9am", "09:00", "3pm", "15:00" into { hour, minute }.
 */
function parseTime(str) {
  str = str.trim().toLowerCase();
  // 12-hour: 9am, 3pm, 12pm, 12am
  const ampmMatch = str.match(/^(\d{1,2})(:\d{2})?\s*(am|pm)$/);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2] ? parseInt(ampmMatch[2].slice(1), 10) : 0;
    if (ampmMatch[3] === 'pm' && hour !== 12) hour += 12;
    if (ampmMatch[3] === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }
  // 24-hour: 09:00, 15:30
  const h24Match = str.match(/^(\d{1,2}):(\d{2})$/);
  if (h24Match) {
    return { hour: parseInt(h24Match[1], 10), minute: parseInt(h24Match[2], 10) };
  }
  return null;
}

/**
 * Parse a natural language schedule expression into { cronExpression, intervalMs, description }.
 */
function parseSchedule(expression) {
  if (!expression || typeof expression !== 'string') {
    throw new Error('Schedule expression is required');
  }
  const expr = expression.trim().toLowerCase();

  // "twice a day"
  if (expr === 'twice a day' || expr === 'twice daily') {
    return { cronExpression: '0 0,12 * * *', intervalMs: null, description: 'Twice a day (midnight and noon)' };
  }

  // "weekdays at Xam/pm"
  const weekdaysMatch = expr.match(/^weekdays?\s+at\s+(.+)$/);
  if (weekdaysMatch) {
    const time = parseTime(weekdaysMatch[1]);
    if (!time) throw new Error('Unrecognized time format: ' + weekdaysMatch[1]);
    return { cronExpression: time.minute + ' ' + time.hour + ' * * 1-5', intervalMs: null, description: 'Weekdays at ' + time.hour + ':' + String(time.minute).padStart(2, '0') };
  }

  // "every <dayname>" or "every <dayname> at <time>"
  const dayNameMatch = expr.match(/^every\s+(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)(\s+at\s+(.+))?$/);
  if (dayNameMatch) {
    const dow = DAY_NAMES[dayNameMatch[1]];
    if (dayNameMatch[3]) {
      const time = parseTime(dayNameMatch[3]);
      if (!time) throw new Error('Unrecognized time format: ' + dayNameMatch[3]);
      return { cronExpression: time.minute + ' ' + time.hour + ' * * ' + dow, intervalMs: null, description: 'Every ' + dayNameMatch[1] + ' at ' + time.hour + ':' + String(time.minute).padStart(2, '0') };
    }
    return { cronExpression: '0 0 * * ' + dow, intervalMs: null, description: 'Every ' + dayNameMatch[1] };
  }

  // "daily at <time>" or "every day at <time>"
  const dailyAtMatch = expr.match(/^(?:daily|every\s+day)\s+at\s+(.+)$/);
  if (dailyAtMatch) {
    const time = parseTime(dailyAtMatch[1]);
    if (!time) throw new Error('Unrecognized time format: ' + dailyAtMatch[1]);
    return { cronExpression: time.minute + ' ' + time.hour + ' * * *', intervalMs: null, description: 'Daily at ' + time.hour + ':' + String(time.minute).padStart(2, '0') };
  }

  // "daily" / "every day"
  if (expr === 'daily' || expr === 'every day') {
    return { cronExpression: '0 0 * * *', intervalMs: 86400000, description: 'Every day at midnight' };
  }

  // "weekly" / "every week"
  if (expr === 'weekly' || expr === 'every week') {
    return { cronExpression: '0 0 * * 0', intervalMs: null, description: 'Every week on Sunday at midnight' };
  }

  // "monthly" / "every month"
  if (expr === 'monthly' || expr === 'every month') {
    return { cronExpression: '0 0 1 * *', intervalMs: null, description: 'Every month on the 1st at midnight' };
  }

  // "every <N> minutes" / "every minute"
  const minuteMatch = expr.match(/^every\s+(\d+\s+)?minutes?$/);
  if (minuteMatch) {
    const n = minuteMatch[1] ? parseInt(minuteMatch[1].trim(), 10) : 1;
    if (n < 1 || n > 59) throw new Error('Minute interval must be 1-59');
    const cronMin = n === 1 ? '*' : '*/' + n;
    return { cronExpression: cronMin + ' * * * *', intervalMs: n * 60000, description: 'Every ' + n + ' minute' + (n > 1 ? 's' : '') };
  }

  // "every hour" / "every <N> hours" / "every 1 hour" / "hourly"
  if (expr === 'hourly') {
    return { cronExpression: '0 * * * *', intervalMs: 3600000, description: 'Every hour' };
  }
  const hourMatch = expr.match(/^every\s+(\d+\s+)?hours?$/);
  if (hourMatch) {
    const n = hourMatch[1] ? parseInt(hourMatch[1].trim(), 10) : 1;
    if (n < 1 || n > 23) throw new Error('Hour interval must be 1-23');
    if (n === 1) {
      return { cronExpression: '0 * * * *', intervalMs: 3600000, description: 'Every hour' };
    }
    return { cronExpression: '0 */' + n + ' * * *', intervalMs: n * 3600000, description: 'Every ' + n + ' hours' };
  }

  throw new Error('Unrecognized schedule expression: ' + expression);
}

function createScheduler(opts = {}) {
  const dataDir = opts.dataDir || null;
  const schedulerDir = dataDir ? path.join(dataDir, 'scheduler') : null;
  const jobsFile = schedulerDir ? path.join(schedulerDir, 'jobs.json') : null;
  const taskManager = opts.taskManager || null;
  const webhookManager = opts.webhookManager || null;

  let jobs = new Map();
  let tickInterval = null;

  // Load from disk on init
  if (jobsFile) {
    try {
      const raw = fs.readFileSync(jobsFile, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const j of arr) {
          jobs.set(j.id, j);
        }
      }
    } catch { /* no file yet */ }
  }

  function persist() {
    if (!jobsFile) return;
    try {
      fs.mkdirSync(schedulerDir, { recursive: true });
      const tmpPath = jobsFile + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(Array.from(jobs.values()), null, 2));
      fs.renameSync(tmpPath, jobsFile);
    } catch { /* ignore write errors */ }
  }

  function computeNextRun(cronExpression, from) {
    const fromDate = from ? new Date(from) : new Date();
    return nextCronMatch(cronExpression, fromDate);
  }

  function formatDateLabel(date) {
    const d = new Date(date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  function executeJob(job) {
    const startTime = Date.now();
    let status = 'success';
    let output = '';

    try {
      if (job.action.type === 'task' && taskManager) {
        const dateLabel = formatDateLabel(new Date());
        const task = taskManager.createTask({
          title: job.name + ' - ' + dateLabel,
          description: job.description || 'Auto-created by scheduler job ' + job.id,
          createdBy: 'scheduler',
          tags: ['scheduled', 'job-' + job.id]
        });
        output = 'Created task: ' + task.id;
      } else if (job.action.type === 'webhook' && webhookManager) {
        try {
          webhookManager.dispatch('scheduler.job.run', {
            jobId: job.id,
            jobName: job.name,
            runAt: new Date().toISOString(),
            config: job.action.config || {}
          });
          output = 'Webhook dispatched';
        } catch (err) {
          output = 'Webhook error: ' + (err.message || String(err));
          status = 'error';
        }
      } else if (job.action.type === 'command') {
        output = 'Command logged (not executed for safety): ' + JSON.stringify(job.action.config || {});
      } else if (job.action.type === 'evaluation') {
        output = 'Evaluation triggered for job: ' + job.name;
      } else {
        output = 'No handler for action type: ' + job.action.type;
      }
    } catch (err) {
      status = 'error';
      output = err.message || String(err);
    }

    const duration = Date.now() - startTime;
    const historyEntry = {
      runAt: startTime,
      status,
      duration,
      output
    };

    // Keep last MAX_HISTORY runs
    if (!job.history) job.history = [];
    job.history.push(historyEntry);
    if (job.history.length > MAX_HISTORY) {
      job.history = job.history.slice(-MAX_HISTORY);
    }

    job.lastRunAt = startTime;
    job.runCount = (job.runCount || 0) + 1;

    // Update nextRunAt
    const next = computeNextRun(job.cronExpression, new Date(startTime));
    job.nextRunAt = next ? next.getTime() : null;

    if (status === 'error') {
      job.status = 'error';
    }

    persist();
    return historyEntry;
  }

  function createJob(data) {
    if (!data || !data.name || typeof data.name !== 'string' || data.name.trim().length < 1) {
      throw new Error('Job name is required');
    }
    if (!data.schedule || typeof data.schedule !== 'string') {
      throw new Error('Schedule expression is required');
    }
    if (!data.action || !data.action.type) {
      throw new Error('Action with type is required');
    }
    const validTypes = ['task', 'webhook', 'command', 'evaluation'];
    if (!validTypes.includes(data.action.type)) {
      throw new Error('Invalid action type: ' + data.action.type);
    }

    if (jobs.size >= MAX_JOBS) {
      throw new Error('Maximum job limit reached');
    }

    const parsed = parseSchedule(data.schedule);
    const now = Date.now();
    const next = computeNextRun(parsed.cronExpression, new Date(now));

    const job = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      description: data.description || '',
      schedule: data.schedule,
      cronExpression: parsed.cronExpression,
      intervalMs: parsed.intervalMs || null,
      action: {
        type: data.action.type,
        config: data.action.config || {}
      },
      enabled: true,
      lastRunAt: null,
      nextRunAt: next ? next.getTime() : null,
      runCount: 0,
      status: 'active',
      createdBy: data.createdBy || 'unknown',
      createdAt: now,
      history: []
    };

    jobs.set(job.id, job);
    persist();
    return job;
  }

  function getJob(id) {
    return jobs.get(id) || null;
  }

  function listJobs(filters = {}) {
    let result = Array.from(jobs.values());
    if (filters.status) {
      result = result.filter(j => j.status === filters.status);
    }
    if (filters.enabled !== undefined) {
      const enabled = filters.enabled === true || filters.enabled === 'true';
      result = result.filter(j => j.enabled === enabled);
    }
    return result;
  }

  function updateJob(id, updates) {
    const job = jobs.get(id);
    if (!job) throw new Error('Job not found: ' + id);

    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || updates.name.trim().length < 1) {
        throw new Error('Job name is required');
      }
      job.name = updates.name.trim();
    }
    if (updates.description !== undefined) {
      job.description = updates.description;
    }
    if (updates.schedule !== undefined) {
      const parsed = parseSchedule(updates.schedule);
      job.schedule = updates.schedule;
      job.cronExpression = parsed.cronExpression;
      job.intervalMs = parsed.intervalMs || null;
      const next = computeNextRun(parsed.cronExpression, new Date());
      job.nextRunAt = next ? next.getTime() : null;
    }
    if (updates.action !== undefined) {
      if (!updates.action.type) throw new Error('Action type is required');
      job.action = { type: updates.action.type, config: updates.action.config || {} };
    }

    persist();
    return job;
  }

  function deleteJob(id) {
    const job = jobs.get(id);
    if (!job) throw new Error('Job not found: ' + id);
    jobs.delete(id);
    persist();
    return job;
  }

  function pauseJob(id) {
    const job = jobs.get(id);
    if (!job) throw new Error('Job not found: ' + id);
    job.enabled = false;
    job.status = 'paused';
    persist();
    return job;
  }

  function resumeJob(id) {
    const job = jobs.get(id);
    if (!job) throw new Error('Job not found: ' + id);
    job.enabled = true;
    job.status = 'active';
    // Recompute next run from now
    const next = computeNextRun(job.cronExpression, new Date());
    job.nextRunAt = next ? next.getTime() : null;
    persist();
    return job;
  }

  function runJob(id) {
    const job = jobs.get(id);
    if (!job) throw new Error('Job not found: ' + id);
    return executeJob(job);
  }

  function getHistory(jobId) {
    const job = jobs.get(jobId);
    if (!job) throw new Error('Job not found: ' + jobId);
    return job.history || [];
  }

  function tick() {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (!job.enabled) continue;
      if (job.status === 'paused') continue;
      if (job.nextRunAt && job.nextRunAt <= now) {
        try {
          executeJob(job);
        } catch { /* ignore individual job errors */ }
      }
    }
  }

  function start() {
    if (tickInterval) return;
    tickInterval = setInterval(tick, 60000);
  }

  function stop() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  return {
    parseSchedule,
    matchesCron,
    nextCronMatch,
    computeNextRun,
    createJob,
    getJob,
    listJobs,
    updateJob,
    deleteJob,
    pauseJob,
    resumeJob,
    runJob,
    getHistory,
    tick,
    start,
    stop
  };
}

module.exports = { createScheduler, parseSchedule, matchesCron, nextCronMatch };
