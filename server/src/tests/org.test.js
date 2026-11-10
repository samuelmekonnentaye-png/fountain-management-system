import test from 'node:test';
import assert from 'node:assert/strict';
import { ORG_POSITIONS, ORG_UNITS } from '../services/orgData.js';
import { bossOf, buildIndex, needsSuperior, resolveChain } from '../services/orgChain.js';

// Build positions with ids from the real company chart
const positions = ORG_POSITIONS.map((p, i) => ({ ...p, _id: `pos${i}` }));
const posId = (name) => positions.find((p) => p.name === name)._id;
positions.forEach((p) => { p.parent = p.parent ? posId(p.parent) : null; });

let n = 0;
const user = (name, positionName, extra = {}) => ({
  _id: `u-${name}`, name, position: positionName ? posId(positionName) : null, department: extra.department || null,
  manager: extra.manager || null, isActive: extra.isActive !== false, roles: extra.roles || ['employee'],
});
const people = (list) => buildIndex(list, positions);
const chainNames = (r) => r.ids.map((id) => id.replace('u-', ''));

test('the company chart is consistent: unique names, parents exist and come first', () => {
  const names = new Set();
  const seen = new Set();
  for (const p of ORG_POSITIONS) {
    assert.ok(!names.has(p.name), `duplicate position ${p.name}`);
    names.add(p.name);
    if (p.parent) assert.ok(seen.has(p.parent), `${p.name}: parent "${p.parent}" must be listed before it`);
    seen.add(p.name);
    assert.ok(ORG_UNITS.some((u) => u.name === p.unit), `${p.name}: unknown unit ${p.unit}`);
  }
  assert.equal(ORG_POSITIONS.filter((p) => p.chainEnd).length, 1);
  assert.ok(ORG_POSITIONS.find((p) => p.chainEnd).name.startsWith('General Manager'));
});

const base = [
  user('Tesfaye', 'General Manager (GM)', { roles: ['general_manager'] }),
  user('Dawit', 'Deputy General Manager', { roles: ['deputy_general_manager'] }),
  user('Selam', 'Marketing & Customer Relations Department Head', { roles: ['department_head'] }),
  user('Samuel', 'Business Development and Customer Relation Expert'),
  user('Henok', 'Finance Department Head', { roles: ['department_head'] }),
  user('Yonas', 'Accounting Team'),
];

test('a marketing expert reports only to the department head and the General Manager', () => {
  const r = resolveChain('u-Samuel', people(base));
  assert.deepEqual(chainNames(r), ['Selam', 'Tesfaye']);
  assert.equal(r.stop, 'chainEnd'); // the DGM and everybody else is NOT in the chain
});

test('the Finance line is separate from the Marketing line', () => {
  assert.deepEqual(chainNames(resolveChain('u-Yonas', people(base))), ['Henok', 'Tesfaye']);
});

test('the Managing Director is never part of the chain of people below the General Manager', () => {
  const withMd = [...base, user('Boss', 'Managing Director (MD)')];
  assert.ok(!chainNames(resolveChain('u-Samuel', people(withMd))).includes('Boss'));
  // but the General Manager himself reports to the MD
  assert.deepEqual(chainNames(resolveChain('u-Tesfaye', people(withMd))), ['Boss']);
});

test('a long line of command passes every approver of the own line only', () => {
  const list = [
    ...base,
    user('Abate', 'Security Section Operation Manager', { roles: ['manager'] }),
    user('Tigist', 'District Operation Section Head (Security)', { roles: ['department_head'] }),
    user('Biruk', 'Supervisors (District Operation)'),
    user('Dagim', 'Shift Leaders'),
  ];
  const r = resolveChain('u-Dagim', people(list));
  assert.deepEqual(chainNames(r), ['Biruk', 'Tigist', 'Abate', 'Dawit', 'Tesfaye']);
});

test('advisors, secretaries and experts are never approvers', () => {
  const list = [...base, user('Sec', 'Secretary'), user('Cons', 'Consultant')];
  const idx = people(list);
  // nobody reports to them, and they are skipped if they appear on a line
  for (const name of ['Sec', 'Cons']) assert.equal(positions.find((p) => p.name === (name === 'Sec' ? 'Secretary' : 'Consultant')).approver, false);
  assert.deepEqual(chainNames(resolveChain('u-Sec', idx)), ['Dawit', 'Tesfaye']);
});

test('several holders of the superior position: unit decides, otherwise it is ambiguous', () => {
  const security = 'dept-security';
  const list = [
    ...base,
    user('Abate', 'Security Section Operation Manager', { roles: ['manager'] }),
    user('Tigist', 'District Operation Section Head (Security)', { department: security }),
    user('Biruk', 'Supervisors (District Operation)', { department: security }),
    user('Chala', 'Supervisors (District Operation)', { department: security }),
    user('Dagim', 'Shift Leaders', { department: security }),
  ];
  const idx = people(list);
  const r = bossOf(idx.usersById.get('u-Dagim'), idx);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.position.name, 'Supervisors (District Operation)');
  assert.equal(resolveChain('u-Dagim', idx).stop, 'ambiguous');
  assert.equal(needsSuperior(idx.usersById.get('u-Dagim'), idx), true);

  // an explicit manager settles it
  const fixed = list.map((u) => (u._id === 'u-Dagim' ? { ...u, manager: 'u-Biruk' } : u));
  assert.deepEqual(chainNames(resolveChain('u-Dagim', people(fixed))), ['Biruk', 'Tigist', 'Abate', 'Dawit', 'Tesfaye']);

  // two holders in different units: the same-unit one is chosen
  const split = [
    ...list.filter((u) => u._id !== 'u-Chala'),
    user('Chala', 'Supervisors (District Operation)', { department: 'dept-other' }),
  ];
  const idx2 = people(split);
  assert.equal(bossOf(idx2.usersById.get('u-Dagim'), idx2).boss._id, 'u-Biruk');
});

test('a vacant position is skipped and an inactive holder does not count', () => {
  // no Deputy Security Manager and no Section Head: the line continues to the next filled position
  const list = [
    ...base,
    user('Abate', 'Security Section Operation Manager', { roles: ['manager'] }),
    user('Worker', 'Technical Training & Development Section Head'),
  ];
  assert.deepEqual(chainNames(resolveChain('u-Worker', people(list))), ['Abate', 'Dawit', 'Tesfaye']);
  const inactive = list.map((u) => (u._id === 'u-Abate' ? { ...u, isActive: false } : u));
  assert.deepEqual(chainNames(resolveChain('u-Worker', people(inactive))), ['Dawit', 'Tesfaye']);
});

test('a person without position or manager needs the administrator; the General Manager does not', () => {
  const list = [...base, user('Newbie', null)];
  const idx = people(list);
  assert.equal(needsSuperior(idx.usersById.get('u-Newbie'), idx), true);
  assert.equal(needsSuperior(idx.usersById.get('u-Tesfaye'), idx), false);
  assert.deepEqual(resolveChain('u-Newbie', idx).ids, []);
});

test('an explicit manager overrides the chart and loops are cut', () => {
  const list = [
    ...base,
    user('Special', 'Accounting Team', { manager: 'u-Dawit' }),
  ];
  assert.deepEqual(chainNames(resolveChain('u-Special', people(list))), ['Dawit', 'Tesfaye']);
  const loop = [user('A', null, { manager: 'u-B' }), user('B', null, { manager: 'u-A' })];
  assert.equal(resolveChain('u-A', people(loop)).stop, 'loop');
});
