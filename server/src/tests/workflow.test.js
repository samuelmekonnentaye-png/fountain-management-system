import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterApprove, canDecide, canForward, insertNextApprover, phaseStatusFor, walkChain,
} from '../services/workflow.js';

const direct = (over = {}) => ({
  workflow: 'direct',
  status: 'submitted',
  recipients: [{ user: 'u-to', type: 'to' }, { user: 'u-cc', type: 'cc' }],
  reviews: [],
  ...over,
});
const hier = (over = {}) => ({
  workflow: 'hierarchical',
  status: 'submitted',
  recipients: [{ user: 'a', type: 'to' }],
  approvalChain: ['a', 'b', 'c'],
  approvalIndex: 0,
  currentApproverId: 'a',
  reviews: [],
  ...over,
});

test('direct: only a "To" recipient can decide, CC cannot', () => {
  assert.equal(canDecide(direct(), 'u-to'), true);
  assert.equal(canDecide(direct(), 'u-cc'), false);
  assert.equal(canDecide(direct(), 'stranger'), false);
});

test('direct: first decision wins, nobody can decide a closed report', () => {
  const decided = direct({ reviews: [{ decision: 'approved' }] });
  assert.equal(canDecide(decided, 'u-to'), false);
  assert.equal(canDecide(direct({ status: 'approved' }), 'u-to'), false);
  assert.equal(canDecide(direct({ status: 'returned' }), 'u-to'), false);
});

test('hierarchical: only the current approver can decide', () => {
  assert.equal(canDecide(hier(), 'a'), true);
  assert.equal(canDecide(hier(), 'b'), false);
  assert.equal(canDecide(hier({ approvalIndex: 1, currentApproverId: 'b', status: 'in_review' }), 'b'), true);
});

test('forward rules: direct allows after approval, never after return/reject', () => {
  assert.equal(canForward(direct({ status: 'approved' }), 'u-to'), true);
  assert.equal(canForward(direct({ status: 'returned' }), 'u-to'), false);
  assert.equal(canForward(direct({ status: 'rejected' }), 'u-to'), false);
  assert.equal(canForward(direct(), 'u-cc'), false);
  assert.equal(canForward(hier(), 'b'), false);
});

test('afterApprove moves along the chain and finishes at the end', () => {
  assert.deepEqual(afterApprove(hier()), { final: false, nextIndex: 1, nextApproverId: 'b' });
  assert.deepEqual(afterApprove(hier({ approvalIndex: 2, currentApproverId: 'c' })), { final: true });
  assert.deepEqual(afterApprove(direct()), { final: true });
});

test('phase status for each decision', () => {
  assert.equal(phaseStatusFor('approved'), 'approved');
  assert.equal(phaseStatusFor('returned'), 'returned');
  assert.equal(phaseStatusFor('rejected'), 'rejected');
});

test('forwarding inserts the person right after the current approver, once', () => {
  assert.deepEqual(insertNextApprover(['a', 'b'], 0, 'x'), ['a', 'x', 'b']);
  assert.equal(insertNextApprover(['a', 'b'], 0, 'b'), null);
});

test('walkChain follows managers, skips inactive ones, stops at loops and depth', () => {
  const users = new Map([
    ['emp', { manager: 'head' }],
    ['head', { manager: 'mgr', isActive: true }],
    ['mgr', { manager: 'gm', isActive: false }],
    ['gm', { manager: 'emp' }], // loop back to the employee
  ]);
  assert.deepEqual(walkChain('emp', users), ['head', 'gm']);

  const long = new Map();
  for (let i = 0; i < 20; i += 1) long.set(`u${i}`, { manager: `u${i + 1}` });
  long.set('u20', {});
  assert.equal(walkChain('u0', long, 8).length, 8);
  assert.deepEqual(walkChain('nobody', new Map()), []);
});

import { isEvalEditable, isOpen, isPlanEditable } from '../services/workflow.js';

test('REGRESSION: a hierarchical report stays open for the next approver after an earlier approval', () => {
  const r = hier({
    status: 'in_review',
    approvalIndex: 1,
    currentApproverId: 'b',
    recipients: [{ user: 'a', type: 'to' }, { user: 'b', type: 'to' }],
    reviews: [{ reviewer: 'a', decision: 'approved' }],
  });
  assert.equal(isOpen(r), true);
  assert.equal(canDecide(r, 'b'), true);
  assert.equal(canDecide(r, 'a'), false); // the first approver already did his part
});

test('a finished report is not open', () => {
  for (const status of ['approved', 'returned', 'rejected']) assert.equal(isOpen({ status }), false);
  for (const status of ['submitted', 'in_review']) assert.equal(isOpen({ status }), true);
});

test('planning fields lock once the plan or the evaluation is sent or approved', () => {
  assert.equal(isPlanEditable('draft', 'not_started'), true);
  assert.equal(isPlanEditable('returned', 'draft'), true);
  assert.equal(isPlanEditable('submitted', 'not_started'), false);
  assert.equal(isPlanEditable('approved', 'draft'), false);
  assert.equal(isPlanEditable('rejected', 'not_started'), false);
  // the plan was never sent, but the evaluation was: goals can no longer move
  assert.equal(isPlanEditable('draft', 'submitted'), false);
  assert.equal(isPlanEditable('draft', 'approved'), false);
  assert.equal(isPlanEditable('draft', 'returned'), false);
});

test('evaluation fields are editable until the evaluation is sent, and again when it is returned', () => {
  assert.equal(isEvalEditable('not_started'), true);
  assert.equal(isEvalEditable('draft'), true);
  assert.equal(isEvalEditable('returned'), true);
  for (const s of ['submitted', 'approved', 'rejected']) assert.equal(isEvalEditable(s), false);
});
