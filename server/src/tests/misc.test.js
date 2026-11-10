import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRow, escapeRegex } from '../utils/text.js';
import { scopeKind, primaryRole, hasRole, ROLES } from '../config/roles.js';

test('csv cells are quoted and formula injection is neutralised', () => {
  assert.equal(csvCell('hello'), '"hello"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), '"\'+1"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvRow(['a', 'b,c']), '"a","b,c"');
});

test('escapeRegex escapes special characters', () => {
  assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c');
  assert.equal(new RegExp(escapeRegex('(x)')).test('(x)'), true);
});

test('analytics scope by role', () => {
  assert.equal(scopeKind([ROLES.GM]), 'all');
  assert.equal(scopeKind([ROLES.DEPUTY_GM, ROLES.EMPLOYEE]), 'all');
  assert.equal(scopeKind([ROLES.MANAGER]), 'team');
  assert.equal(scopeKind([ROLES.DEPARTMENT_HEAD, ROLES.EMPLOYEE]), 'team');
  assert.equal(scopeKind([ROLES.EMPLOYEE]), 'none');
  assert.equal(scopeKind([ROLES.ADMIN]), 'none');
});

test('a person with several roles shows the highest one', () => {
  assert.equal(primaryRole([ROLES.EMPLOYEE, ROLES.MANAGER]), ROLES.MANAGER);
  assert.equal(primaryRole([ROLES.DEPARTMENT_HEAD, ROLES.MANAGER]), ROLES.MANAGER);
  assert.equal(primaryRole([]), ROLES.EMPLOYEE);
  assert.equal(hasRole({ roles: ['manager'] }, 'gm', 'manager'), true);
  assert.equal(hasRole({ roles: ['employee'] }, 'manager'), false);
});
