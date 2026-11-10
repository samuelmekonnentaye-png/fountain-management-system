import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDepartmentIds, endsAt, expandInvites, isHead, joinWindowOpen, overlaps, phaseOf, respondable,
} from '../services/meetingLogic.js';

const departments = [
  { _id: 'exec', parent: null },
  { _id: 'dgmo', parent: 'exec' },
  { _id: 'sec', parent: 'dgmo' },
  { _id: 'cln', parent: 'dgmo' },
  { _id: 'fin', parent: 'exec' },
];
const positionsById = new Map([
  ['p-head', { approver: true }],
  ['p-staff', { approver: false }],
]);
const u = (id, department, extra = {}) => ({ _id: id, department, roles: ['employee'], isActive: true, position: null, ...extra });
const users = [
  u('boss', 'fin', { roles: ['department_head'] }),
  u('acc1', 'fin', { position: 'p-staff' }),
  u('acc2', 'fin', { position: 'p-staff' }),
  u('sup', 'sec', { position: 'p-head' }),
  u('guard', 'sec', { position: 'p-staff' }),
  u('clean', 'cln'),
  u('gone', 'sec', { isActive: false }),
  u('lone', null),
];

test('a unit includes its sub-units only when asked', () => {
  assert.deepEqual([...collectDepartmentIds(['dgmo'], departments, true)].sort(), ['cln', 'dgmo', 'sec']);
  assert.deepEqual([...collectDepartmentIds(['dgmo'], departments, false)], ['dgmo']);
  assert.deepEqual([...collectDepartmentIds(['fin'], departments, true)], ['fin']);
});

test('heads are leading roles or holders of approver positions', () => {
  assert.equal(isHead(users[0], positionsById), true);
  assert.equal(isHead(users[3], positionsById), true);
  assert.equal(isHead(users[1], positionsById), false);
});

test('a whole department is invited, the organizer is always included and has accepted', () => {
  const p = expandInvites({ invites: [{ departmentId: 'fin', scope: 'all' }], organizerId: 'sup', users, departments, positionsById });
  const ids = p.map((x) => x.user).sort();
  assert.deepEqual(ids, ['acc1', 'acc2', 'boss', 'sup']);
  assert.equal(p.find((x) => x.user === 'sup').status, 'accepted');
  assert.equal(p.find((x) => x.user === 'sup').source, 'organizer');
  assert.equal(p.find((x) => x.user === 'acc1').status, 'invited');
});

test('"heads only" invites the leaders of the unit and nobody else', () => {
  const p = expandInvites({ invites: [{ departmentId: 'dgmo', scope: 'heads', includeSubunits: true }], organizerId: 'boss', users, departments, positionsById });
  assert.deepEqual(p.map((x) => x.user).sort(), ['boss', 'sup']);
});

test('inactive people are skipped and nobody is listed twice (department + single invite)', () => {
  const p = expandInvites({
    invites: [{ departmentId: 'sec', scope: 'all' }, { departmentId: 'dgmo', scope: 'all' }],
    invitedUserIds: ['guard', 'lone', 'gone', 'unknown'],
    organizerId: 'boss', users, departments, positionsById,
  });
  const ids = p.map((x) => x.user).sort();
  assert.deepEqual(ids, ['boss', 'clean', 'guard', 'lone', 'sup']);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(p.find((x) => x.user === 'lone').source, 'user');
});

test('answers given earlier are kept when the invitation list is rebuilt', () => {
  const existing = [{ user: 'acc1', status: 'declined', respondedAt: new Date(1), attended: false }];
  const p = expandInvites({ invites: [{ departmentId: 'fin', scope: 'all' }], organizerId: 'boss', users, departments, positionsById, existing });
  assert.equal(p.find((x) => x.user === 'acc1').status, 'declined');
  assert.equal(p.find((x) => x.user === 'acc2').status, 'invited');
});

test('meeting phases: upcoming, live, ended, cancelled', () => {
  const start = new Date('2026-11-02T08:00:00Z');
  const m = { startsAt: start, durationMinutes: 60, endsAt: endsAt(start, 60), status: 'scheduled' };
  assert.equal(phaseOf(m, new Date('2026-11-02T07:59:00Z')), 'upcoming');
  assert.equal(phaseOf(m, new Date('2026-11-02T08:30:00Z')), 'live');
  assert.equal(phaseOf(m, new Date('2026-11-02T09:01:00Z')), 'ended');
  assert.equal(phaseOf({ ...m, status: 'cancelled' }, start), 'cancelled');
  assert.equal(phaseOf({ ...m, status: 'completed' }, start), 'ended');
});

test('the join button opens 15 minutes before the start and closes at the end', () => {
  const start = new Date('2026-11-02T08:00:00Z');
  const m = { startsAt: start, durationMinutes: 30, endsAt: endsAt(start, 30), status: 'scheduled' };
  assert.equal(joinWindowOpen(m, new Date('2026-11-02T07:44:00Z')), false);
  assert.equal(joinWindowOpen(m, new Date('2026-11-02T07:46:00Z')), true);
  assert.equal(joinWindowOpen(m, new Date('2026-11-02T08:29:00Z')), true);
  assert.equal(joinWindowOpen(m, new Date('2026-11-02T08:31:00Z')), false);
  assert.equal(joinWindowOpen({ ...m, status: 'cancelled' }, new Date('2026-11-02T08:10:00Z')), false);
  assert.equal(respondable(m, new Date('2026-11-02T09:00:00Z')), false);
});

test('overlapping time ranges are detected, touching ones are not', () => {
  const t = (s) => new Date(`2026-11-02T${s}:00Z`);
  assert.equal(overlaps(t('08:00'), t('09:00'), t('08:30'), t('09:30')), true);
  assert.equal(overlaps(t('08:00'), t('09:00'), t('09:00'), t('10:00')), false);
  assert.equal(overlaps(t('08:00'), t('09:00'), t('07:00'), t('08:00')), false);
});
