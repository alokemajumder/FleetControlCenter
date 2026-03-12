'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createProjectManager } = require('../../control-plane/lib/projects');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-projects-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// -- CRUD tests --

describe('Project CRUD', () => {
  let pm;
  beforeEach(() => {
    pm = createProjectManager();
  });

  it('should create a project with required fields', () => {
    const project = pm.createProject({ name: 'Test Project', createdBy: 'admin' });
    assert.ok(project.id);
    assert.equal(project.name, 'Test Project');
    assert.equal(project.status, 'active');
    assert.equal(project.createdBy, 'admin');
    assert.ok(project.createdAt);
    assert.ok(project.updatedAt);
    assert.deepEqual(project.agents, []);
    assert.deepEqual(project.sessions, []);
    assert.deepEqual(project.tags, []);
    assert.equal(project.repository, null);
  });

  it('should reject project without name', () => {
    assert.throws(() => pm.createProject({ description: 'no name' }), /name is required/);
  });

  it('should reject empty name', () => {
    assert.throws(() => pm.createProject({ name: '   ' }), /name is required/);
  });

  it('should get a project by ID', () => {
    const created = pm.createProject({ name: 'Fetch Me' });
    const fetched = pm.getProject(created.id);
    assert.equal(fetched.name, 'Fetch Me');
  });

  it('should return null for non-existent project', () => {
    assert.equal(pm.getProject('nope'), null);
  });

  it('should update a project', () => {
    const project = pm.createProject({ name: 'Original' });
    const updated = pm.updateProject(project.id, { name: 'Updated', description: 'new desc', tags: ['a', 'b'] });
    assert.equal(updated.name, 'Updated');
    assert.equal(updated.description, 'new desc');
    assert.deepEqual(updated.tags, ['a', 'b']);
    assert.ok(updated.updatedAt >= project.updatedAt);
  });

  it('should throw updating non-existent project', () => {
    assert.throws(() => pm.updateProject('ghost', { name: 'x' }), /not found/);
  });

  it('should delete a project', () => {
    const project = pm.createProject({ name: 'Delete Me' });
    pm.deleteProject(project.id);
    assert.equal(pm.getProject(project.id), null);
  });

  it('should throw deleting non-existent project', () => {
    assert.throws(() => pm.deleteProject('ghost'), /not found/);
  });
});

// -- Search and filter tests --

describe('Project listing and search', () => {
  let pm;
  beforeEach(() => {
    pm = createProjectManager();
    pm.createProject({ name: 'Alpha', description: 'First project', tags: ['web'] });
    pm.createProject({ name: 'Beta', description: 'Second project', tags: ['api'] });
    pm.createProject({ name: 'Gamma', description: 'Third project', tags: ['web', 'api'] });
  });

  it('should list all projects', () => {
    const all = pm.listProjects();
    assert.equal(all.length, 3);
  });

  it('should filter by tag', () => {
    const webProjects = pm.listProjects({ tag: 'web' });
    assert.equal(webProjects.length, 2);
  });

  it('should filter by search term', () => {
    const results = pm.listProjects({ search: 'second' });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Beta');
  });

  it('should search projects by name', () => {
    const results = pm.searchProjects('alpha');
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Alpha');
  });

  it('should return empty for no match', () => {
    const results = pm.searchProjects('zzzzz');
    assert.equal(results.length, 0);
  });
});

// -- Archive/Activate tests --

describe('Project archive and activate', () => {
  let pm;
  beforeEach(() => {
    pm = createProjectManager();
  });

  it('should archive a project', () => {
    const project = pm.createProject({ name: 'Archivable' });
    const archived = pm.archiveProject(project.id);
    assert.equal(archived.status, 'archived');
  });

  it('should activate an archived project', () => {
    const project = pm.createProject({ name: 'Revive' });
    pm.archiveProject(project.id);
    const activated = pm.activateProject(project.id);
    assert.equal(activated.status, 'active');
  });

  it('should filter by status', () => {
    const p1 = pm.createProject({ name: 'Active' });
    const p2 = pm.createProject({ name: 'Archived' });
    pm.archiveProject(p2.id);
    const archived = pm.listProjects({ status: 'archived' });
    assert.equal(archived.length, 1);
    assert.equal(archived[0].name, 'Archived');
  });
});

// -- Agent assignment tests --

describe('Agent assignment', () => {
  let pm;
  beforeEach(() => {
    pm = createProjectManager();
  });

  it('should assign and remove an agent', () => {
    const project = pm.createProject({ name: 'With Agents' });
    pm.assignAgent(project.id, 'agent-1');
    assert.deepEqual(pm.getProject(project.id).agents, ['agent-1']);

    pm.removeAgent(project.id, 'agent-1');
    assert.deepEqual(pm.getProject(project.id).agents, []);
  });

  it('should reject duplicate agent assignment', () => {
    const project = pm.createProject({ name: 'Dup Agent' });
    pm.assignAgent(project.id, 'agent-1');
    assert.throws(() => pm.assignAgent(project.id, 'agent-1'), /already assigned/);
  });

  it('should throw removing unassigned agent', () => {
    const project = pm.createProject({ name: 'No Agent' });
    assert.throws(() => pm.removeAgent(project.id, 'ghost'), /not assigned/);
  });

  it('should link sessions', () => {
    const project = pm.createProject({ name: 'With Sessions' });
    pm.linkSession(project.id, 'sess-1');
    pm.linkSession(project.id, 'sess-2');
    pm.linkSession(project.id, 'sess-1'); // duplicate - should not add
    assert.deepEqual(pm.getProject(project.id).sessions, ['sess-1', 'sess-2']);
  });
});

// -- Stats tests --

describe('Project stats', () => {
  it('should return correct stats', () => {
    const pm = createProjectManager();
    const project = pm.createProject({ name: 'Stats Project' });
    pm.assignAgent(project.id, 'a1');
    pm.assignAgent(project.id, 'a2');
    pm.linkSession(project.id, 's1');

    const stats = pm.getProjectStats(project.id);
    assert.equal(stats.agentCount, 2);
    assert.equal(stats.sessionCount, 1);
    assert.ok(stats.lastActivity > 0);
  });

  it('should throw for non-existent project stats', () => {
    const pm = createProjectManager();
    assert.throws(() => pm.getProjectStats('nope'), /not found/);
  });
});

// -- Persistence tests --

describe('Project persistence', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should persist and reload projects from disk', () => {
    tmpDir = makeTmpDir();
    const pm1 = createProjectManager({ dataDir: tmpDir });
    pm1.createProject({ name: 'Persisted', id: 'persist-1', tags: ['test'] });
    pm1.destroy(); // forces final persist

    const pm2 = createProjectManager({ dataDir: tmpDir });
    const project = pm2.getProject('persist-1');
    assert.ok(project);
    assert.equal(project.name, 'Persisted');
    assert.deepEqual(project.tags, ['test']);
  });
});
