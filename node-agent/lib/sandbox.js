'use strict';

const path = require('node:path');
const fs = require('node:fs');

function createSandbox(config = {}) {
  const allowedCommands = new Set(config.allowedCommands || ['ls', 'cat', 'echo', 'grep', 'find', 'head', 'tail', 'wc']);
  const allowedPaths = (config.allowedPaths || ['/tmp']).map(p => path.resolve(p));
  const protectedPaths = (config.protectedPaths || ['/etc', '/var']).map(p => path.resolve(p));
  const maxOutputSize = config.maxOutputSize || 65536; // 64KB
  const argumentConstraints = config.argumentConstraints || {};

  function isPathAllowed(targetPath) {
    const resolved = path.resolve(targetPath);
    // Check if the raw input contained traversal sequences
    if (targetPath.includes('..')) {
      // Even if resolved is valid, reject if original had traversal
      const inAllowed = allowedPaths.some(ap => resolved.startsWith(ap + path.sep) || resolved === ap);
      if (!inAllowed) return { allowed: false, reason: 'Path traversal detected' };
    }
    return allowedPaths.some(ap => resolved.startsWith(ap + path.sep) || resolved === ap)
      ? { allowed: true }
      : { allowed: false, reason: `Path not in allowlist: ${resolved}` };
  }

  function isPathProtected(targetPath) {
    const resolved = path.resolve(targetPath);
    return protectedPaths.some(pp => resolved.startsWith(pp));
  }

  function checkSymlink(targetPath) {
    try {
      const resolved = path.resolve(targetPath);
      const real = fs.realpathSync(resolved);
      if (real !== resolved) {
        // Resolve allowed paths to their real paths too for comparison
        const realAllowedPaths = allowedPaths.map(ap => {
          try { return fs.realpathSync(ap); } catch { return ap; }
        });
        const realAllowed = realAllowedPaths.some(ap => real.startsWith(ap + path.sep) || real === ap);
        if (!realAllowed) return { safe: false, reason: 'Symlink escapes allowed path' };
      }
      return { safe: true };
    } catch {
      return { safe: true }; // File doesn't exist yet, allow
    }
  }

  function validateCommand(command, args = [], options = {}) {
    if (!allowedCommands.has(command)) {
      return { allowed: false, reason: `Command not allowed: ${command}` };
    }
    // Check argument constraints
    if (argumentConstraints[command]) {
      const constraints = argumentConstraints[command];
      for (const arg of args) {
        if (constraints.disallowed && constraints.disallowed.some(d => arg.includes(d))) {
          return { allowed: false, reason: `Argument not allowed: ${arg}` };
        }
        if (constraints.allowed && !constraints.allowed.some(a => arg === a || arg.startsWith(a))) {
          return { allowed: false, reason: `Argument not in allowlist: ${arg}` };
        }
      }
    }
    // Check paths in args
    for (const arg of args) {
      if (arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../') || arg.includes('..')) {
        // It looks like a path
        const pathCheck = isPathAllowed(arg);
        if (!pathCheck.allowed) return { allowed: false, reason: pathCheck.reason || 'Path not allowed' };
        const resolved = path.resolve(arg);
        if (isPathProtected(resolved) && !options.approveProtected) {
          return { allowed: false, reason: `Protected path requires approval: ${resolved}` };
        }
        const symlinkCheck = checkSymlink(arg);
        if (!symlinkCheck.safe) return { allowed: false, reason: symlinkCheck.reason };
      }
    }
    return { allowed: true };
  }

  function truncateOutput(output) {
    if (typeof output === 'string' && Buffer.byteLength(output) > maxOutputSize) {
      return output.slice(0, maxOutputSize) + '\n... [truncated]';
    }
    if (Buffer.isBuffer(output) && output.length > maxOutputSize) {
      return Buffer.concat([output.slice(0, maxOutputSize), Buffer.from('\n... [truncated]')]);
    }
    return output;
  }

  function validateFileOperation(operation, targetPath, options = {}) {
    const pathCheck = isPathAllowed(targetPath);
    if (!pathCheck.allowed) return pathCheck;
    if (isPathProtected(targetPath) && !options.approveProtected) {
      return { allowed: false, reason: `Protected path requires approval: ${path.resolve(targetPath)}` };
    }
    const symlinkCheck = checkSymlink(targetPath);
    if (!symlinkCheck.safe) return { allowed: false, reason: symlinkCheck.reason };
    return { allowed: true };
  }

  return {
    validateCommand,
    isPathAllowed,
    isPathProtected,
    checkSymlink,
    truncateOutput,
    validateFileOperation,
    get config() {
      return { allowedCommands: [...allowedCommands], allowedPaths, protectedPaths, maxOutputSize };
    }
  };
}

function loadAllowlists(configDir) {
  const commands = new Map();
  const paths = new Set();

  try {
    const cmdData = JSON.parse(fs.readFileSync(path.join(configDir, 'commands.json'), 'utf8'));
    if (cmdData.commands) {
      for (const [name, cmd] of Object.entries(cmdData.commands)) {
        commands.set(name, cmd);
      }
    }
  } catch { /* no commands allowlist */ }

  try {
    const pathData = JSON.parse(fs.readFileSync(path.join(configDir, 'paths.json'), 'utf8'));
    if (pathData.allowed) {
      for (const p of pathData.allowed) {
        paths.add(p.replace(/^~/, require('os').homedir()));
      }
    }
  } catch { /* no paths allowlist */ }

  return { commands, paths };
}

function validateAction(action, allowlists) {
  const errors = [];

  if (action.type === 'command') {
    const cmdDef = allowlists.commands.get(action.name);
    if (!cmdDef) {
      errors.push('Command not in allowlist: ' + action.name);
    }
  } else if (action.type === 'file') {
    if (action.path) {
      const resolved = path.resolve(action.path);
      let inAllowed = false;
      for (const ap of allowlists.paths) {
        const resolvedAp = path.resolve(ap);
        if (resolved.startsWith(resolvedAp + path.sep) || resolved === resolvedAp) {
          inAllowed = true;
          break;
        }
      }
      if (!inAllowed) errors.push('Path not in allowlist: ' + action.path);
    }
  }

  return { valid: errors.length === 0, errors };
}

function executeAction(action, allowlists) {
  const { execFileSync } = require('child_process');

  if (action.type !== 'command') {
    return { success: false, error: 'Only command actions supported' };
  }

  const cmdDef = allowlists.commands.get(action.name);
  if (!cmdDef) return { success: false, error: 'Command not in allowlist' };

  try {
    const args = cmdDef.allowedArgs || [];
    const output = execFileSync(cmdDef.command, args, {
      timeout: cmdDef.timeout || 30000,
      encoding: 'utf8',
      maxBuffer: 65536
    });

    const truncated = output.length > 65536;
    return {
      success: true,
      output: truncated ? output.slice(0, 65536) + '\n[TRUNCATED]' : output,
      truncated
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { createSandbox, loadAllowlists, validateAction, executeAction };
