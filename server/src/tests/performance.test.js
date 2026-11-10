import test from 'node:test';
import assert from 'node:assert/strict';
import { calcScores, computeAchievement, hasEvaluation } from '../services/performance.js';

test('completed counts as 100, pending and cancelled as 0', () => {
  assert.equal(computeAchievement({ status: 'completed', target: 10, actual: 0 }), 100);
  assert.equal(computeAchievement({ status: 'pending', target: 10, actual: 9 }), 0);
  assert.equal(computeAchievement({ status: 'cancelled', target: 10, actual: 9 }), 0);
});

test('achievement is actual / target, capped at 100', () => {
  assert.equal(computeAchievement({ status: 'not_completed', target: 20, actual: 5 }), 25);
  assert.equal(computeAchievement({ status: 'in_progress', target: 10, actual: 30 }), 100);
  assert.equal(computeAchievement({ status: 'in_progress', target: 0, actual: 3 }), 0);
});

test('score by count: 4 of 5 completed = 80%', () => {
  const tasks = [
    ...Array.from({ length: 4 }, () => ({ status: 'completed', weight: 20 })),
    { status: 'not_completed', weight: 20, target: 10, actual: 2 },
  ];
  assert.equal(calcScores(tasks).scoreByCount, 80);
});

test('cancelled tasks are ignored by both scores', () => {
  const tasks = [
    { status: 'completed', weight: 50 },
    { status: 'completed', weight: 50 },
    { status: 'cancelled', weight: 50 },
  ];
  const s = calcScores(tasks);
  assert.equal(s.scoreByCount, 100);
  assert.equal(s.scoreWeighted, 100);
  assert.equal(s.total, 2);
  assert.equal(s.cancelled, 1);
});

test('weighted score uses weights and partial achievement', () => {
  const tasks = [
    { status: 'completed', weight: 40 },
    { status: 'not_completed', weight: 60, target: 10, actual: 5 }, // 50%
  ];
  assert.equal(calcScores(tasks).scoreWeighted, 70); // (40*100 + 60*50) / 100
});

test('without weights every task counts equally', () => {
  const tasks = [{ status: 'completed' }, { status: 'not_completed', target: 4, actual: 2 }];
  assert.equal(calcScores(tasks).scoreWeighted, 75);
});

test('empty plan scores zero; hasEvaluation needs a non-pending task', () => {
  assert.equal(calcScores([]).scoreWeighted, 0);
  assert.equal(hasEvaluation({ tasks: [{ status: 'pending' }] }), false);
  assert.equal(hasEvaluation({ tasks: [{ status: 'pending' }, { status: 'in_progress' }] }), true);
});
