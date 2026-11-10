import WorkPlan from '../models/WorkPlan.js';
import Report from '../models/Report.js';
import Notification from '../models/Notification.js';
import { hasEvaluation } from '../services/performance.js';
import { periodsOfYear, teamPerformance } from '../services/analytics.js';
import { pendingFilter } from '../services/reportService.js';
import { asyncHandler, idOf, toInt } from '../utils/http.js';

export const myDashboard = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const now = new Date();
  const year = toInt(req.query.year, now.getFullYear(), 2000, 2100);
  const periods = await periodsOfYear(year);
  const plans = await WorkPlan.find({ owner: uid, period: { $in: periods.map((p) => p._id) } }).lean();
  const byPeriod = new Map(plans.map((p) => [idOf(p.period), p]));

  const items = periods.map((per) => {
    const p = byPeriod.get(idOf(per._id));
    const ev = p && hasEvaluation(p);
    return {
      periodId: per._id, name: per.name, type: per.type, status: per.status,
      startDate: per.startDate, endDate: per.endDate,
      planId: p?._id || null,
      planStatus: p?.planStatus || null,
      evalStatus: p?.evalStatus || null,
      taskCount: p?.tasks.length || 0,
      scoreWeighted: ev ? p.scoreWeighted : null,
      scoreByCount: ev ? p.scoreByCount : null,
    };
  });
  const evaluated = items.filter((m) => m.scoreWeighted !== null);
  const avg = (key) => (evaluated.length ? Math.round(evaluated.reduce((s, m) => s + m[key], 0) / evaluated.length) : null);

  // current period = the open period that covers today (else the latest open one that has started)
  const open = periods.filter((p) => p.status === 'open');
  const current =
    open.find((p) => p.startDate <= now && p.endDate >= now) ||
    [...open].reverse().find((p) => p.startDate <= now) ||
    null;
  let currentPeriod = null;
  if (current) {
    const p = byPeriod.get(idOf(current._id));
    const counts = { pending: 0, in_progress: 0, completed: 0, not_completed: 0, cancelled: 0 };
    p?.tasks.forEach((t) => { counts[t.status] += 1; });
    currentPeriod = {
      periodId: current._id, name: current.name, endDate: current.endDate,
      planId: p?._id || null, title: p?.title || '', counts, total: p?.tasks.length || 0,
      planStatus: p?.planStatus || null, evalStatus: p?.evalStatus || null,
      scoreWeighted: p?.scoreWeighted ?? null, scoreByCount: p?.scoreByCount ?? null,
    };
  }

  const upcoming = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today.getTime() + 8 * 86400000);
  for (const p of plans) {
    for (const t of p.tasks) {
      if (t.dueDate && t.dueDate >= today && t.dueDate < limit && ['pending', 'in_progress'].includes(t.status)) {
        upcoming.push({ planId: p._id, taskId: t._id, title: t.title, dueDate: t.dueDate });
      }
    }
  }
  upcoming.sort((a, b) => a.dueDate - b.dueDate);

  const [sentAgg, unreadReports, pendingReview, unreadNotifications] = await Promise.all([
    Report.aggregate([{ $match: { sender: uid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Report.countDocuments({ recipients: { $elemMatch: { user: uid, readAt: null } } }),
    Report.countDocuments(pendingFilter(uid)),
    Notification.countDocuments({ user: uid, isRead: false }),
  ]);
  const sent = { submitted: 0, in_review: 0, approved: 0, returned: 0, rejected: 0 };
  sentAgg.forEach((s) => { sent[s._id] = s.n; });

  res.json({
    year,
    periods: items,
    averages: { weighted: avg('scoreWeighted'), count: avg('scoreByCount'), evaluatedPeriods: evaluated.length },
    planCount: plans.length,
    currentPeriod,
    upcoming: upcoming.slice(0, 8),
    reports: { sent, unreadReports, pendingReview },
    unreadNotifications,
  });
});

export const teamDashboard = asyncHandler(async (req, res) => {
  res.json(
    await teamPerformance(req.user, {
      year: req.query.year,
      periodId: req.query.period,
      departmentId: req.query.department,
    })
  );
});
