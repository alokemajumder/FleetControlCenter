'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CATEGORIES = ['coding', 'analysis', 'automation', 'security', 'ops', 'custom'];
const STATUSES = ['available', 'installed', 'active', 'disabled', 'quarantined'];
const SEVERITIES = { critical: 40, high: 20, medium: 10, low: 5 };

const INJECTION_PATTERNS = [
  'ignore previous',
  'override instructions',
  'system prompt',
  'disregard above',
  'forget your instructions',
  'new instructions'
];

const DANGEROUS_COMMANDS = ['rm ', 'rm -', 'curl ', 'wget ', 'eval(', 'eval ', 'exec(', 'exec ', 'child_process', 'execSync', 'spawnSync'];

const CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/i,
  /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{36,}/,
  /Bearer\s+[A-Za-z0-9._\-]{20,}/i
];

const EXFIL_PATTERNS = [
  /https?:\/\/[^\s'"]+/i,
  /fetch\s*\(/,
  /XMLHttpRequest/,
  /\.send\s*\(/,
  /net\.connect/,
  /http\.request/
];

const OBFUSCATION_PATTERNS = [
  /atob\s*\(/,
  /btoa\s*\(/,
  /Buffer\.from\s*\([^)]+,\s*['"]base64['"]\)/,
  /[A-Za-z0-9+/]{40,}={0,2}/,  // long base64 strings
  /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,}/  // hex-encoded sequences
];

function createSkillsHub(opts = {}) {
  const dataDir = opts.dataDir || './data';
  const hubDir = path.join(dataDir, 'skills-hub');
  const skillsFile = path.join(hubDir, 'skills.json');
  const registryPath = opts.registryPath || path.resolve('skills/registry.json');

  // Ensure directory exists
  fs.mkdirSync(hubDir, { recursive: true });

  // In-memory skill store
  let skills = new Map();

  // Load persisted skills or bootstrap from registry
  function load() {
    skills.clear();
    if (fs.existsSync(skillsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(skillsFile, 'utf8'));
        for (const s of data) {
          skills.set(s.id, s);
        }
        return;
      } catch { /* fall through to registry import */ }
    }
    // Bootstrap from existing registry
    importFromRegistry();
  }

  function importFromRegistry() {
    try {
      const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      for (const s of (reg.skills || [])) {
        const skill = makeSkill({
          id: s.id,
          name: s.name || s.id,
          version: s.version || '1.0.0',
          description: s.description || '',
          author: s.signedBy || 'unknown',
          category: s.category || 'custom',
          source: 'registry',
          status: s.status === 'draft' ? 'available' : (s.status || 'available'),
          signature: s.signature || null,
          verified: !!(s.signature && s.signature.length > 0),
          config: {},
          permissions: [],
          tags: s.tags || [],
          downloads: 0,
          rating: 0
        });
        skills.set(skill.id, skill);
      }
    } catch { /* no registry */ }
    persist();
  }

  function makeSkill(data) {
    return {
      id: data.id || crypto.randomUUID(),
      name: data.name || 'Untitled',
      version: data.version || '1.0.0',
      description: data.description || '',
      author: data.author || 'unknown',
      category: CATEGORIES.includes(data.category) ? data.category : 'custom',
      source: data.source === 'registry' ? 'registry' : 'local',
      status: STATUSES.includes(data.status) ? data.status : 'available',
      installDate: data.installDate || null,
      signature: data.signature || null,
      verified: !!data.verified,
      securityScan: data.securityScan || {
        scannedAt: null,
        score: 0,
        issues: [],
        passed: false
      },
      config: data.config || {},
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
      downloads: data.downloads || 0,
      rating: data.rating || 0
    };
  }

  function persist() {
    const arr = [...skills.values()];
    const tmp = skillsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
    fs.renameSync(tmp, skillsFile);
  }

  function listSkills(filters = {}) {
    let result = [...skills.values()];
    if (filters.category) {
      result = result.filter(s => s.category === filters.category);
    }
    if (filters.status) {
      result = result.filter(s => s.status === filters.status);
    }
    if (filters.source) {
      result = result.filter(s => s.source === filters.source);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return result;
  }

  function getSkill(id) {
    return skills.get(id) || null;
  }

  function installSkill(id) {
    const skill = skills.get(id);
    if (!skill) throw new Error('Skill not found: ' + id);
    if (skill.status === 'installed' || skill.status === 'active') {
      throw new Error('Skill already installed');
    }
    if (skill.status === 'quarantined') {
      throw new Error('Cannot install quarantined skill');
    }
    // Run security scan before install
    const scanResult = scanSkill(id);
    if (!scanResult.passed) {
      skill.status = 'quarantined';
      persist();
      throw new Error('Security scan failed — skill quarantined');
    }
    skill.status = 'installed';
    skill.installDate = Date.now();
    skill.downloads++;
    persist();
    return skill;
  }

  function uninstallSkill(id) {
    const skill = skills.get(id);
    if (!skill) throw new Error('Skill not found: ' + id);
    if (skill.status === 'available') {
      throw new Error('Skill is not installed');
    }
    skill.status = 'available';
    skill.installDate = null;
    persist();
    return skill;
  }

  function enableSkill(id) {
    const skill = skills.get(id);
    if (!skill) throw new Error('Skill not found: ' + id);
    if (skill.status !== 'installed' && skill.status !== 'disabled') {
      throw new Error('Skill must be installed or disabled to enable');
    }
    skill.status = 'active';
    persist();
    return skill;
  }

  function disableSkill(id) {
    const skill = skills.get(id);
    if (!skill) throw new Error('Skill not found: ' + id);
    if (skill.status !== 'active' && skill.status !== 'installed') {
      throw new Error('Skill must be active or installed to disable');
    }
    skill.status = 'disabled';
    persist();
    return skill;
  }

  function deepStringCollect(obj) {
    const strings = [];
    if (typeof obj === 'string') {
      strings.push(obj);
    } else if (Array.isArray(obj)) {
      for (const item of obj) strings.push(...deepStringCollect(item));
    } else if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        strings.push(key);
        strings.push(...deepStringCollect(obj[key]));
      }
    }
    return strings;
  }

  function scanSkill(id) {
    const skill = skills.get(id);
    if (!skill) throw new Error('Skill not found: ' + id);

    const issues = [];
    // Collect all string content from skill definition
    const content = deepStringCollect(skill).join('\n').toLowerCase();
    const rawContent = deepStringCollect(skill).join('\n');

    // 1. Prompt injection
    for (const pattern of INJECTION_PATTERNS) {
      if (content.includes(pattern)) {
        issues.push({ severity: 'critical', type: 'prompt-injection', message: 'Prompt injection pattern detected: "' + pattern + '"' });
      }
    }

    // 2. Dangerous commands
    for (const cmd of DANGEROUS_COMMANDS) {
      if (content.includes(cmd.toLowerCase())) {
        issues.push({ severity: 'high', type: 'dangerous-commands', message: 'Dangerous command detected: "' + cmd.trim() + '"' });
      }
    }

    // 3. Credential patterns
    for (const pat of CREDENTIAL_PATTERNS) {
      if (pat.test(rawContent)) {
        issues.push({ severity: 'critical', type: 'credential-patterns', message: 'Hardcoded credential pattern detected' });
        break; // one issue per category is enough
      }
    }

    // 4. Data exfiltration
    for (const pat of EXFIL_PATTERNS) {
      if (pat.test(rawContent)) {
        issues.push({ severity: 'high', type: 'data-exfiltration', message: 'Network access pattern detected' });
        break;
      }
    }

    // 5. Obfuscation
    for (const pat of OBFUSCATION_PATTERNS) {
      if (pat.test(rawContent)) {
        issues.push({ severity: 'medium', type: 'obfuscation', message: 'Obfuscated content detected' });
        break;
      }
    }

    // Score: 100 minus deductions
    let score = 100;
    for (const issue of issues) {
      score -= SEVERITIES[issue.severity] || 0;
    }
    if (score < 0) score = 0;

    const scanResult = {
      scannedAt: Date.now(),
      score,
      issues,
      passed: score >= 50
    };

    skill.securityScan = scanResult;
    persist();
    return scanResult;
  }

  function quarantineSkill(id, reason) {
    const skill = skills.get(id);
    if (!skill) throw new Error('Skill not found: ' + id);
    skill.status = 'quarantined';
    if (reason) {
      skill.securityScan.issues.push({
        severity: 'critical',
        type: 'manual-quarantine',
        message: reason
      });
    }
    persist();
    return skill;
  }

  function getSkillStats() {
    const all = [...skills.values()];
    const byCategory = {};
    for (const cat of CATEGORIES) {
      byCategory[cat] = all.filter(s => s.category === cat).length;
    }
    return {
      total: all.length,
      installed: all.filter(s => s.status === 'installed').length,
      active: all.filter(s => s.status === 'active').length,
      quarantined: all.filter(s => s.status === 'quarantined').length,
      byCategory
    };
  }

  function searchSkills(query) {
    if (!query || !query.trim()) return [...skills.values()];
    return listSkills({ search: query });
  }

  function importSkill(skillData) {
    if (!skillData || typeof skillData !== 'object') {
      throw new Error('Invalid skill data');
    }
    if (!skillData.name) {
      throw new Error('Skill name is required');
    }
    const skill = makeSkill({
      ...skillData,
      id: skillData.id || crypto.randomUUID(),
      source: 'local',
      status: 'available',
      installDate: null
    });
    skills.set(skill.id, skill);
    persist();
    return skill;
  }

  function exportSkill(id) {
    const skill = skills.get(id);
    if (!skill) throw new Error('Skill not found: ' + id);
    return JSON.parse(JSON.stringify(skill));
  }

  function getCategories() {
    const all = [...skills.values()];
    const result = [];
    for (const cat of CATEGORIES) {
      const count = all.filter(s => s.category === cat).length;
      result.push({ category: cat, count });
    }
    return result;
  }

  function getRecommended() {
    const all = [...skills.values()];
    // Sort by rating desc, then downloads desc
    return all
      .filter(s => s.status !== 'quarantined')
      .sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.downloads - a.downloads;
      })
      .slice(0, 10);
  }

  // Initialize
  load();

  return {
    listSkills,
    getSkill,
    installSkill,
    uninstallSkill,
    enableSkill,
    disableSkill,
    scanSkill,
    quarantineSkill,
    getSkillStats,
    searchSkills,
    importSkill,
    exportSkill,
    getCategories,
    getRecommended
  };
}

module.exports = { createSkillsHub };
