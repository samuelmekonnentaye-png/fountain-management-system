import test from 'node:test';
import assert from 'node:assert/strict';
import { accountBlock } from '../services/accountStatus.js';

test('an approved, active account may sign in', () => {
  assert.equal(accountBlock({ approvalStatus: 'approved', isActive: true }), null);
});

test('old accounts without an approval status count as approved', () => {
  assert.equal(accountBlock({ isActive: true }), null);
});

test('a pending registration cannot sign in and gets a clear code', () => {
  const b = accountBlock({ approvalStatus: 'pending', isActive: false });
  assert.equal(b.code, 'ACCOUNT_PENDING');
  assert.match(b.message, /waiting for approval/);
});

test('a rejected registration shows the reason', () => {
  const b = accountBlock({ approvalStatus: 'rejected', isActive: false, rejectionReason: 'Not an employee' });
  assert.equal(b.code, 'ACCOUNT_REJECTED');
  assert.match(b.message, /Not an employee/);
});

test('a deactivated approved account is blocked', () => {
  assert.equal(accountBlock({ approvalStatus: 'approved', isActive: false }).code, 'ACCOUNT_DISABLED');
});
