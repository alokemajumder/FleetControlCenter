'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STEPS = [
  { id: 'welcome' },
  { id: 'admin-account' },
  { id: 'security-config' },
  { id: 'data-directory' },
  { id: 'first-node' },
  { id: 'security-scan' },
  { id: 'complete' }
];

const NON_SKIPPABLE = new Set(['welcome', 'complete']);

function createOnboarding(opts = {}) {
  const dataDir = opts.dataDir || './data';
  const onboardingDir = path.join(path.resolve(dataDir), 'onboarding');
  const stateFile = path.join(onboardingDir, 'state.json');

  let state = null;

  function loadState() {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      state = null;
    }
    return state;
  }

  function persistState() {
    if (!state) return;
    try {
      fs.mkdirSync(onboardingDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch { /* ignore write errors */ }
  }

  // Load on init
  loadState();

  function makeInitialState() {
    return {
      completed: false,
      startedAt: Date.now(),
      completedAt: null,
      currentStep: 0,
      steps: STEPS.map(s => ({ id: s.id, status: 'pending', completedAt: null })),
      config: {}
    };
  }

  function getState() {
    if (!state) loadState();
    return state;
  }

  function isComplete() {
    if (!state) loadState();
    return !!(state && state.completed);
  }

  function startSetup() {
    if (state) return state; // idempotent
    state = makeInitialState();
    persistState();
    return state;
  }

  function findStepIndex(stepId) {
    if (!state) return -1;
    return state.steps.findIndex(s => s.id === stepId);
  }

  function validateAdminAccount(data) {
    if (!data || !data.username || !data.password) {
      return 'username and password are required';
    }
    if (typeof data.username !== 'string' || data.username.length < 3 || data.username.length > 32) {
      return 'username must be 3-32 characters';
    }
    if (!/^[a-zA-Z0-9]+$/.test(data.username)) {
      return 'username must be alphanumeric';
    }
    if (typeof data.password !== 'string' || data.password.length < 8) {
      return 'password must be at least 8 characters';
    }
    return null;
  }

  function validateSecurityConfig(data) {
    if (!data) return 'security configuration data is required';
    if (data.hmacSecret !== undefined && data.hmacSecret !== null) {
      if (typeof data.hmacSecret !== 'string' || data.hmacSecret.length < 16) {
        return 'hmacSecret must be at least 16 characters';
      }
    }
    return null;
  }

  function validateDataDirectory(data) {
    if (!data || !data.dataDir) {
      return 'dataDir is required';
    }
    if (!path.isAbsolute(data.dataDir)) {
      return 'dataDir must be an absolute path';
    }
    return null;
  }

  function validateFirstNode(data) {
    if (!data) {
      return 'nodeName and nodeSecret are required';
    }
    if (typeof data.nodeName !== 'string' || data.nodeName.length < 1 || data.nodeName.length > 64) {
      return 'nodeName must be 1-64 characters';
    }
    if (typeof data.nodeSecret !== 'string' || data.nodeSecret.length < 16) {
      return 'nodeSecret must be at least 16 characters';
    }
    return null;
  }

  function completeStep(stepId, data) {
    if (!state) throw new Error('Setup not started');

    const idx = findStepIndex(stepId);
    if (idx === -1) throw new Error('Unknown step: ' + stepId);

    const step = state.steps[idx];

    // Validate per step
    let validationError = null;
    switch (stepId) {
      case 'welcome':
        // No validation needed
        break;
      case 'admin-account':
        validationError = validateAdminAccount(data);
        break;
      case 'security-config':
        validationError = validateSecurityConfig(data);
        break;
      case 'data-directory':
        validationError = validateDataDirectory(data);
        break;
      case 'first-node':
        validationError = validateFirstNode(data);
        break;
      case 'security-scan':
        // Results are stored from data
        if (data && data.results) {
          step.results = data.results;
        }
        break;
      case 'complete':
        // Finalize
        break;
      default:
        throw new Error('Unknown step: ' + stepId);
    }

    if (validationError) {
      throw new Error(validationError);
    }

    // Store config data
    if (data && stepId !== 'welcome' && stepId !== 'complete' && stepId !== 'security-scan') {
      Object.assign(state.config, data);
    }

    step.status = 'completed';
    step.completedAt = Date.now();

    // Advance currentStep to next pending
    if (idx >= state.currentStep) {
      let next = state.currentStep;
      while (next < state.steps.length && state.steps[next].status !== 'pending') {
        next++;
      }
      state.currentStep = next;
    }

    // If completing the 'complete' step, mark the whole setup as done
    if (stepId === 'complete') {
      state.completed = true;
      state.completedAt = Date.now();
    }

    persistState();
    return step;
  }

  function skipStep(stepId) {
    if (!state) throw new Error('Setup not started');
    if (NON_SKIPPABLE.has(stepId)) {
      throw new Error('Step "' + stepId + '" cannot be skipped');
    }

    const idx = findStepIndex(stepId);
    if (idx === -1) throw new Error('Unknown step: ' + stepId);

    const step = state.steps[idx];
    step.status = 'skipped';
    step.completedAt = Date.now();

    // Advance currentStep
    if (idx >= state.currentStep) {
      let next = state.currentStep;
      while (next < state.steps.length && state.steps[next].status !== 'pending') {
        next++;
      }
      state.currentStep = next;
    }

    persistState();
    return step;
  }

  function resetSetup() {
    state = makeInitialState();
    persistState();
    return state;
  }

  function getProgress() {
    if (!state) {
      return { completedSteps: 0, totalSteps: STEPS.length, percentComplete: 0 };
    }
    const completedSteps = state.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    const totalSteps = state.steps.length;
    const percentComplete = Math.round((completedSteps / totalSteps) * 100);
    return { completedSteps, totalSteps, percentComplete };
  }

  function generateConfig() {
    if (!state) return {};
    const c = { ...state.config };
    const generated = {};

    if (c.username) generated.adminUsername = c.username;
    if (c.hmacSecret) generated.hmacSecret = c.hmacSecret;
    if (c.enableMfa !== undefined) generated.enableMfa = c.enableMfa;
    if (c.enableTls !== undefined) generated.enableTls = c.enableTls;
    if (c.dataDir) generated.dataDir = c.dataDir;
    if (c.nodeName) {
      generated.fleet = {
        nodeSecrets: {}
      };
      generated.fleet.nodeSecrets[c.nodeName] = c.nodeSecret || '';
    }

    return generated;
  }

  function runSecurityScan(doctor) {
    if (!doctor) throw new Error('Doctor module is required for security scan');

    const results = doctor.runAll();
    const categorized = { critical: [], warnings: [], passed: [], fixable: [] };

    for (const result of results) {
      if (result.status === 'fail') {
        categorized.critical.push(result);
      } else if (result.status === 'warn') {
        categorized.warnings.push(result);
      } else if (result.status === 'pass') {
        categorized.passed.push(result);
      }
      if (result.fixable) {
        categorized.fixable.push(result);
      }
    }

    return categorized;
  }

  return {
    getState,
    isComplete,
    startSetup,
    completeStep,
    skipStep,
    resetSetup,
    getProgress,
    generateConfig,
    runSecurityScan
  };
}

module.exports = { createOnboarding };
