import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeploymentSteps, runDeploymentSteps } from './deploy.mjs';

test('applies migrations before deploying an existing D1-backed Worker', () => {
  assert.deepEqual(buildDeploymentSteps({
    d1_databases: [{ binding: 'DB', database_name: 'private-notes-db', database_id: '65617025-69bb-4683-a992-2c6d467d7cf4' }],
  }), [
    ['d1', 'migrations', 'apply', 'DB', '--remote'],
    ['deploy'],
  ]);
});

test('provisions D1 before migrating a fresh Deploy Button checkout', () => {
  assert.deepEqual(buildDeploymentSteps({
    d1_databases: [{ binding: 'DB', database_name: 'private-notes-db' }],
  }), [
    ['deploy'],
    ['d1', 'migrations', 'apply', 'DB', '--remote'],
  ]);
});

test('fails closed when the DB binding is missing', () => {
  assert.throws(() => buildDeploymentSteps({ d1_databases: [] }), /DB binding/i);
});

test('stops before deploy when an existing database migration fails', () => {
  const calls = [];
  const status = runDeploymentSteps([
    ['d1', 'migrations', 'apply', 'DB', '--remote'],
    ['deploy'],
  ], (args) => {
    calls.push(args);
    return { status: 1 };
  });

  assert.equal(status, 1);
  assert.deepEqual(calls, [['d1', 'migrations', 'apply', 'DB', '--remote']]);
});

test('stops before migration when a fresh automatic deployment fails', () => {
  const calls = [];
  const status = runDeploymentSteps([
    ['deploy'],
    ['d1', 'migrations', 'apply', 'DB', '--remote'],
  ], (args) => {
    calls.push(args);
    return { status: 2 };
  });

  assert.equal(status, 2);
  assert.deepEqual(calls, [['deploy']]);
});
