import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeploymentSteps } from './deploy.mjs';

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
