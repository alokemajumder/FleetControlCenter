'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_STATUSES = new Set(['active', 'archived']);

function createProjectManager(opts = {}) {
  const dataDir = opts.dataDir || null;
  const projectsDir = dataDir ? path.join(dataDir, 'projects') : null;
  const projects = new Map();
  let saveTimer = null;
  const DEBOUNCE_MS = 5000;

  // Ensure directory exists
  if (projectsDir) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  // Load persisted projects on init
  if (projectsDir) {
    const projectsFile = path.join(projectsDir, 'projects.json');
    try {
      const data = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
      if (data && typeof data === 'object') {
        for (const [id, project] of Object.entries(data)) {
          projects.set(id, project);
        }
      }
    } catch { /* no persisted projects yet */ }
  }

  function scheduleSave() {
    if (!projectsDir) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistProjects();
    }, DEBOUNCE_MS);
  }

  function persistProjects() {
    if (!projectsDir) return;
    const obj = {};
    for (const [id, project] of projects) {
      obj[id] = project;
    }
    const tmpPath = path.join(projectsDir, 'projects.json.tmp');
    const finalPath = path.join(projectsDir, 'projects.json');
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2));
      fs.renameSync(tmpPath, finalPath);
    } catch { /* ignore write errors */ }
  }

  function createProject(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Project data is required');
    }
    if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
      throw new Error('Project name is required');
    }

    const id = data.id || crypto.randomUUID();
    if (projects.has(id)) {
      throw new Error('Project already exists: ' + id);
    }

    const now = Date.now();
    const project = {
      id,
      name: data.name.trim(),
      description: data.description || '',
      repository: data.repository || null,
      status: 'active',
      tags: Array.isArray(data.tags) ? data.tags : [],
      agents: [],
      sessions: [],
      metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
      createdBy: data.createdBy || 'unknown',
      createdAt: now,
      updatedAt: now
    };

    projects.set(id, project);
    scheduleSave();
    return project;
  }

  function getProject(id) {
    return projects.get(id) || null;
  }

  function listProjects(filters = {}) {
    let result = [...projects.values()];

    if (filters.status) {
      result = result.filter(p => p.status === filters.status);
    }
    if (filters.tag) {
      result = result.filter(p => p.tags.includes(filters.tag));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }

    return result;
  }

  function updateProject(id, updates) {
    const project = projects.get(id);
    if (!project) throw new Error('Project not found: ' + id);

    const allowedFields = ['name', 'description', 'repository', 'tags', 'metadata'];
    for (const key of Object.keys(updates)) {
      if (allowedFields.includes(key)) {
        if (key === 'name') {
          if (!updates.name || typeof updates.name !== 'string' || updates.name.trim() === '') {
            throw new Error('Project name is required');
          }
          project.name = updates.name.trim();
        } else {
          project[key] = updates[key];
        }
      }
    }
    project.updatedAt = Date.now();
    scheduleSave();
    return project;
  }

  function archiveProject(id) {
    const project = projects.get(id);
    if (!project) throw new Error('Project not found: ' + id);
    project.status = 'archived';
    project.updatedAt = Date.now();
    scheduleSave();
    return project;
  }

  function activateProject(id) {
    const project = projects.get(id);
    if (!project) throw new Error('Project not found: ' + id);
    project.status = 'active';
    project.updatedAt = Date.now();
    scheduleSave();
    return project;
  }

  function deleteProject(id) {
    const existed = projects.delete(id);
    if (!existed) throw new Error('Project not found: ' + id);
    scheduleSave();
    return true;
  }

  function assignAgent(projectId, agentId) {
    const project = projects.get(projectId);
    if (!project) throw new Error('Project not found: ' + projectId);
    if (!agentId) throw new Error('agentId is required');
    if (project.agents.includes(agentId)) {
      throw new Error('Agent already assigned: ' + agentId);
    }
    project.agents.push(agentId);
    project.updatedAt = Date.now();
    scheduleSave();
    return project;
  }

  function removeAgent(projectId, agentId) {
    const project = projects.get(projectId);
    if (!project) throw new Error('Project not found: ' + projectId);
    const idx = project.agents.indexOf(agentId);
    if (idx === -1) throw new Error('Agent not assigned: ' + agentId);
    project.agents.splice(idx, 1);
    project.updatedAt = Date.now();
    scheduleSave();
    return project;
  }

  function linkSession(projectId, sessionId) {
    const project = projects.get(projectId);
    if (!project) throw new Error('Project not found: ' + projectId);
    if (!sessionId) throw new Error('sessionId is required');
    if (!project.sessions.includes(sessionId)) {
      project.sessions.push(sessionId);
      project.updatedAt = Date.now();
      scheduleSave();
    }
    return project;
  }

  function getProjectStats(id) {
    const project = projects.get(id);
    if (!project) throw new Error('Project not found: ' + id);
    return {
      agentCount: project.agents.length,
      sessionCount: project.sessions.length,
      lastActivity: project.updatedAt
    };
  }

  function searchProjects(query) {
    if (!query || typeof query !== 'string') return [];
    const q = query.toLowerCase();
    return [...projects.values()].filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  }

  function destroy() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistProjects();
  }

  return {
    createProject,
    getProject,
    listProjects,
    updateProject,
    archiveProject,
    activateProject,
    deleteProject,
    assignAgent,
    removeAgent,
    linkSession,
    getProjectStats,
    searchProjects,
    destroy
  };
}

module.exports = { createProjectManager };
