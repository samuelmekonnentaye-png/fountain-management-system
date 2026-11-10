// Mirrors server/src/services/performance.js so the editor can show live scores.
const clamp = (n) => Math.min(100, Math.max(0, n));

export function achievementOf(t) {
  if (t.status === 'completed') return 100;
  if (t.status === 'pending' || t.status === 'cancelled') return 0;
  const target = Number(t.target);
  const actual = Number(t.actual);
  if (!(target > 0) || !Number.isFinite(actual) || actual < 0) return 0;
  return Math.round(clamp((actual / target) * 100) * 100) / 100;
}

export function calcScores(tasks = []) {
  const active = tasks.filter((t) => t.status !== 'cancelled');
  const completed = active.filter((t) => t.status === 'completed').length;
  if (!active.length) return { byCount: 0, weighted: 0, total: 0, completed: 0, weightSum: 0 };
  const weightSum = active.reduce((s, t) => s + (Number(t.weight) || 0), 0);
  const byCount = Math.round((completed / active.length) * 100);
  const weighted =
    weightSum > 0
      ? Math.round(active.reduce((s, t) => s + (Number(t.weight) || 0) * achievementOf(t), 0) / weightSum)
      : Math.round(active.reduce((s, t) => s + achievementOf(t), 0) / active.length);
  return { byCount, weighted, total: active.length, completed, weightSum };
}

export const scoreColor = (n) => {
  if (n === null || n === undefined) return '#9fb3d1';
  if (n >= 85) return '#0e9f6e';
  if (n >= 70) return '#0b4fd6';
  if (n >= 50) return '#d98a00';
  return '#d64545';
};
