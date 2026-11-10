import Report from '../models/Report.js';
import User from '../models/User.js';
import { calcScores, computeAchievement } from './performance.js';
import { HttpError, bad, idOf, isObjectId } from '../utils/http.js';
import { ROLES, hasRole } from '../config/roles.js';
import { OPEN_STATUSES } from './workflow.js';
import Position from '../models/Position.js';
import { buildIndex, resolveChain } from './orgChain.js';

const plainTask = (t) => ({
  title: t.title,
  description: t.description || '',
  kpi: t.kpi || '',
  target: t.target ?? 1,
  unit: t.unit || '',
  weight: t.weight || 0,
  startDate: t.startDate || null,
  dueDate: t.dueDate || null,
  status: t.status,
  actual: t.actual || 0,
  achievement: computeAchievement(t),
  actualResult: t.actualResult || '',
  shortfallReason: t.shortfallReason || '',
});

// Frozen copy of a plan. plan.period must be populated.
export function makeSnapshot(plan, owner, department, period) {
  const tasks = plan.tasks.map(plainTask);
  const s = calcScores(tasks);
  return {
    ownerId: owner._id,
    ownerName: owner.fullName,
    ownerJobTitle: owner.jobTitle || '',
    departmentName: department?.name || '',
    departmentNameAm: department?.nameAm || '',
    periodId: period._id,
    periodName: period.name,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    title: plan.title || '',
    objectives: plan.objectives || '',
    tasks,
    scoreByCount: s.scoreByCount,
    scoreWeighted: s.scoreWeighted,
    totalTasks: s.total,
    completedTasks: s.completed,
  };
}

// Business rules that must hold before a plan / evaluation report can be sent.
export function validatePlanForKind(plan, kind) {
  const active = plan.tasks.filter((t) => t.status !== 'cancelled');
  if (active.length === 0) throw bad('Add at least one task before sending the report');

  if (kind === 'plan') {
    for (const t of active) {
      if (!(Number(t.target) > 0)) throw bad(`Set a target greater than 0 for "${t.title}"`);
    }
    const total = active.reduce((s, t) => s + (t.weight || 0), 0);
    if (Math.abs(total - 100) > 0.01) throw bad(`Task weights must add up to 100% (currently ${total}%)`);
  } else {
    for (const t of active) {
      if (!['completed', 'not_completed'].includes(t.status)) {
        throw bad(`Evaluate every task before sending (not evaluated: "${t.title}")`);
      }
      if (t.status === 'not_completed' && !t.shortfallReason) {
        throw bad(`Explain why the goal was not reached for "${t.title}"`);
      }
    }
  }
}

// Validates To / CC lists and loads the users.
export async function buildRecipients(to, cc, selfId, { requireTo = true } = {}) {
  const clean = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(String))];
  const toIds = clean(to).filter((id) => id !== String(selfId));
  const ccIds = clean(cc).filter((id) => id !== String(selfId) && !toIds.includes(id));
  if (requireTo && toIds.length === 0) throw bad('Choose at least one person in "Send To"');
  if (toIds.length + ccIds.length > 30) throw bad('Too many recipients (maximum 30)');
  if ([...toIds, ...ccIds].some((id) => !isObjectId(id))) throw bad('Invalid recipient');

  const users = await User.find({ _id: { $in: [...toIds, ...ccIds] }, isActive: true }).select('fullName email roles jobTitle');
  if (users.length !== toIds.length + ccIds.length) throw bad('One or more recipients are not active users');
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const entries = [...toIds.map((id) => ['to', id]), ...ccIds.map((id) => ['cc', id])];
  return {
    recipients: entries.map(([type, id]) => ({ user: byId.get(id)._id, type })),
    populated: entries.map(([type, id]) => ({ user: byId.get(id), type })),
  };
}

// The approval chain of a person: the approvers on their OWN line of command (from the organisation chart,
// or the manager set by hand), up to the General Manager. See services/orgChain.js.
export async function loadOrgIndex() {
  const [users, positions] = await Promise.all([
    User.find({}).select('manager position department isActive roles').lean(),
    Position.find({}).select('name parent approver chainEnd').lean(),
  ]);
  return buildIndex(users, positions);
}

export async function buildChainInfo(ownerId) {
  const idx = await loadOrgIndex();
  const r = resolveChain(ownerId, idx);
  return { ids: r.ids, stop: r.stop, positionName: r.position?.name || '' };
}

export async function buildChain(ownerId) {
  return (await buildChainInfo(ownerId)).ids;
}

// Access rule: the sender, a recipient (To/CC) or the General Manager (read-only).
export async function loadReportForUser(id, user, { populate = true } = {}) {
  if (!isObjectId(id)) throw new HttpError(404, 'Report not found');
  let q = Report.findById(id);
  if (populate) {
    q = q
      .populate('sender', 'fullName email jobTitle roles')
      .populate('recipients.user', 'fullName email roles jobTitle')
      .populate('reviews.reviewer', 'fullName roles')
      .populate('approvalChain', 'fullName jobTitle roles')
      .populate('currentApproverId', 'fullName');
  }
  const report = await q;
  if (!report) throw new HttpError(404, 'Report not found');
  const uid = String(user._id);
  const isSender = idOf(report.sender) === uid;
  const rec = report.recipients.find((r) => idOf(r.user) === uid);
  if (!isSender && !rec && !hasRole(user, ROLES.GM)) {
    throw new HttpError(403, 'You do not have access to this report');
  }
  return { report, isSender, rec };
}

// Mongo filter: reports waiting for THIS user's decision.
export const pendingFilter = (userId) => ({
  status: { $in: OPEN_STATUSES },
  $or: [
    { workflow: 'hierarchical', currentApproverId: userId },
    {
      workflow: { $ne: 'hierarchical' },
      recipients: { $elemMatch: { user: userId, type: 'to' } },
      'reviews.reviewer': { $ne: userId },
    },
  ],
});
