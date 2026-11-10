import Report from '../models/Report.js';
import WorkPlan from '../models/WorkPlan.js';
import ReportingPeriod from '../models/ReportingPeriod.js';
import User from '../models/User.js';
import { ROLES } from '../config/roles.js';
import { notify } from './notify.js';
import { OPEN_STATUSES, idStr } from './workflow.js';

const DAY = 86400000;

// Creates in-app reminders (at most one per person, per item, per day).
export async function runReminders(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const counts = { pendingReview: 0, returned: 0, periodEnding: 0, overdue: 0, deadlineNear: 0 };

  // 1. Reports waiting for a decision for more than 2 days -> remind the approvers
  const waiting = await Report.find({ status: { $in: OPEN_STATUSES }, updatedAt: { $lt: new Date(now - 2 * DAY) } })
    .select('workflow recipients currentApproverId snapshot kind reviews')
    .lean();
  for (const r of waiting) {
    const approvers =
      r.workflow === 'hierarchical'
        ? [r.currentApproverId]
        : r.recipients.filter((x) => x.type === 'to' && !r.reviews.some((v) => idStr(v.reviewer) === idStr(x.user))).map((x) => x.user);
    await notify(approvers.filter(Boolean), {
      type: 'reminder',
      meta: { reason: 'pending_review', owner: r.snapshot.ownerName, period: r.snapshot.periodName, kind: r.kind },
      report: r._id,
      dedupeKey: `pr:${r._id}:${day}`,
    });
    counts.pendingReview += 1;
  }

  // 2. Returned plans that nobody corrected for more than 2 days -> remind the owner
  const returned = await WorkPlan.find({
    $or: [{ planStatus: 'returned' }, { evalStatus: 'returned' }],
    updatedAt: { $lt: new Date(now - 2 * DAY) },
  })
    .populate('period', 'name')
    .select('owner period planStatus evalStatus')
    .lean();
  for (const p of returned) {
    await notify([p.owner], {
      type: 'reminder',
      meta: { reason: 'returned', period: p.period?.name, kind: p.planStatus === 'returned' ? 'plan' : 'evaluation' },
      plan: p._id,
      dedupeKey: `ret:${p._id}:${day}`,
    });
    counts.returned += 1;
  }

  // 3. Period ends within 3 days and the evaluation was not sent -> remind the employee
  const ending = await ReportingPeriod.find({ status: 'open', endDate: { $gte: now, $lte: new Date(now.getTime() + 3 * DAY) } }).lean();
  if (ending.length) {
    const reporters = await User.find({
      isActive: true,
      roles: { $in: [ROLES.EMPLOYEE, ROLES.DEPARTMENT_HEAD, ROLES.MANAGER, ROLES.DEPUTY_GM] },
    }).select('_id');
    for (const per of ending) {
      const done = new Set(
        (await WorkPlan.find({ period: per._id, evalStatus: { $in: ['submitted', 'approved'] } }).select('owner').lean()).map((p) => idStr(p.owner))
      );
      const late = reporters.filter((u) => !done.has(idStr(u._id))).map((u) => u._id);
      await notify(late, {
        type: 'reminder',
        meta: { reason: 'period_ending', period: per.name, endDate: per.endDate },
        dedupeKey: `end:${per._id}:${day}`,
      });
      counts.periodEnding += late.length;
    }
  }

  // 4 + 5. Tasks already overdue, or due within 3 days
  const limit = new Date(startOfToday.getTime() + 3 * DAY);
  const plans = await WorkPlan.find({
    tasks: { $elemMatch: { dueDate: { $lt: limit }, status: { $in: ['pending', 'in_progress'] } } },
    $or: [{ planStatus: { $in: ['draft', 'returned', 'approved'] } }],
  })
    .select('owner tasks')
    .lean();
  for (const plan of plans) {
    for (const t of plan.tasks) {
      if (!t.dueDate || !['pending', 'in_progress'].includes(t.status) || t.dueDate >= limit) continue;
      const overdue = t.dueDate < startOfToday;
      await notify([plan.owner], {
        type: overdue ? 'reminder' : 'deadline_near',
        meta: overdue ? { reason: 'overdue', title: t.title, dueDate: t.dueDate } : { title: t.title, dueDate: t.dueDate },
        plan: plan._id,
        dedupeKey: `${overdue ? 'od' : 'due'}:${t._id}:${day}`,
      });
      if (overdue) counts.overdue += 1;
      else counts.deadlineNear += 1;
    }
  }
  return counts;
}

export function startReminders() {
  const run = () => runReminders().catch((e) => console.error('reminder job failed:', e.message));
  setTimeout(run, 10_000).unref?.();
  setInterval(run, 6 * 60 * 60 * 1000).unref?.();
}
