#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const testDir = __dirname;
const testFiles = [];

function findTests(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) findTests(path.join(dir, entry.name));
    else if (entry.name.endsWith('.test.js')) testFiles.push(path.join(dir, entry.name));
  }
}

findTests(testDir);

console.log(`\nRunning ${testFiles.length} test suites...\n`);

let passed = 0, failed = 0;
for (const file of testFiles) {
  const rel = path.relative(testDir, file);
  try {
    execSync(`node --test ${file}`, { stdio: 'inherit', timeout: 30000 });
    passed++;
  } catch (err) {
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${testFiles.length} suites`);
process.exit(failed > 0 ? 1 : 0);
