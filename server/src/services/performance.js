// Scoring used everywhere (API, exports, snapshots). Cancelled tasks never count.
//  - Achievement of one task: completed = 100, pending/cancelled = 0, otherwise actual / target (capped at 100)
//  - By count:  completed / (all - cancelled) * 100
//  - Weighted:  sum(weight * achievement) / sum(weight)   (no weights -> every task counts equally)

const clamp = (n) => Math.min(100, Math.max(0, n));

export function computeAchievement(task) {
  if (task.status === 'completed') return 100;
  if (task.status === 'pending' || task.status === 'cancelled') return 0;
  const target = Number(task.target);
  const actual = Number(task.actual);
  if (!(target > 0) || !Number.isFinite(actual) || actual < 0) return 0;
  return Math.round(clamp((actual / target) * 100) * 100) / 100;
}

export function calcScores(tasks = []) {
  const active = tasks.filter((t) => t.status !== 'cancelled');
  const completed = active.filter((t) => t.status === 'completed').length;
  if (active.length === 0) {
    return { scoreByCount: 0, scoreWeighted: 0, total: 0, completed: 0, cancelled: tasks.length };
  }
  const scoreByCount = Math.round((completed / active.length) * 100);

  const totalWeight = active.reduce((s, t) => s + (Number(t.weight) || 0), 0);
  let scoreWeighted;
  if (totalWeight > 0) {
    const sum = active.reduce((s, t) => s + (Number(t.weight) || 0) * computeAchievement(t), 0);
    scoreWeighted = Math.round(sum / totalWeight);
  } else {
    scoreWeighted = Math.round(active.reduce((s, t) => s + computeAchievement(t), 0) / active.length);
  }
  return { scoreByCount, scoreWeighted, total: active.length, completed, cancelled: tasks.length - active.length };
}

// A plan only counts in analytics once at least one task has been evaluated.
export const hasEvaluation = (plan) => (plan.tasks || []).some((t) => t.status !== 'pending');
