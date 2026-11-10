import mongoose from 'mongoose';
import User from '../models/User.js';
import Department from '../models/Department.js';
import ReportingPeriod from '../models/ReportingPeriod.js';
import WorkPlan from '../models/WorkPlan.js';
import Report from '../models/Report.js';
import AuditLog from '../models/AuditLog.js';
import { env } from '../config/env.js';
import { ROLES } from '../config/roles.js';
import { mailEnabled } from '../services/mailer.js';
import { OPEN_STATUSES, idStr } from '../services/workflow.js';
import { needsSuperior } from '../services/orgChain.js';
import { loadOrgIndex } from '../services/reportService.js';
import { asyncHandler } from '../utils/http.js';

const DAY = 86400000;
const countMap = (rows) => Object.fromEntries(rows.map((r) => [String(r._id ?? 'none'), r.n]));
const ym = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;

// System-wide monitoring for the System Admin: numbers and statuses only, never report contents.
export const overview = asyncHandler(async (_req, res) => {
  const now = new Date();
  const since = (days) => new Date(now.getTime() - days * DAY);
  const approved = { approvalStatus: { $nin: ['pending', 'rejected'] } };
  const reporterRoles = [ROLES.EMPLOYEE, ROLES.DEPARTMENT_HEAD, ROLES.MANAGER, ROLES.DEPUTY_GM];
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const stalledFilter = { status: { $in: OPEN_STATUSES }, updatedAt: { $lt: since(2) } };
  const evaluatedTask = { 'tasks.status': { $in: ['in_progress', 'completed', 'not_completed', 'cancelled'] } };

  const recentPeriods = await ReportingPeriod.find().sort({ startDate: -1 }).limit(6).lean();
  const periodIds = recentPeriods.map((p) => p._id);

  const [
    totalUsers, activeUsers, pendingUsers, signedIn7d, new30d, withoutManager, expectedReporters,
    byRole, byDept, deptCount, periodStatus, plansTotal, planStatus, evalStatus, scoreAgg, perPeriod,
    reportsTotal, reportStatus, reportKind, reportWorkflow, monthly, stalledCount, stalledDocs, approvalAgg,
    auditDaily, topActions, recentAudit,
  ] = await Promise.all([
    User.countDocuments(approved),
    User.countDocuments({ ...approved, isActive: true }),
    User.countDocuments({ approvalStatus: 'pending' }),
    User.countDocuments({ lastLoginAt: { $gte: since(7) } }),
    User.countDocuments({ ...approved, createdAt: { $gte: since(30) } }),
    loadOrgIndex().then((idx) => [...idx.usersById.values()].filter((u) => u.isActive !== false && needsSuperior(u, idx)).length),
    User.countDocuments({ isActive: true, roles: { $in: reporterRoles } }),
    User.aggregate([{ $match: { ...approved, isActive: true } }, { $unwind: '$roles' }, { $group: { _id: '$roles', n: { $sum: 1 } } }]),
    User.aggregate([
      { $match: { ...approved, isActive: true } },
      { $group: { _id: '$department', n: { $sum: 1 } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'd' } },
      { $project: { n: 1, name: { $ifNull: [{ $arrayElemAt: ['$d.name', 0] }, 'Unassigned'] }, nameAm: { $ifNull: [{ $arrayElemAt: ['$d.nameAm', 0] }, ''] } } },
      { $sort: { n: -1 } },
    ]),
    Department.countDocuments(),
    ReportingPeriod.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    WorkPlan.countDocuments(),
    WorkPlan.aggregate([{ $group: { _id: '$planStatus', n: { $sum: 1 } } }]),
    WorkPlan.aggregate([{ $group: { _id: '$evalStatus', n: { $sum: 1 } } }]),
    WorkPlan.aggregate([{ $match: evaluatedTask }, { $group: { _id: null, avg: { $avg: '$scoreWeighted' }, n: { $sum: 1 } } }]),
    WorkPlan.aggregate([
      { $match: { period: { $in: periodIds } } },
      {
        $group: {
          _id: '$period',
          plans: { $sum: 1 },
          planApproved: { $sum: { $cond: [{ $eq: ['$planStatus', 'approved'] }, 1, 0] } },
          evalSent: { $sum: { $cond: [{ $in: ['$evalStatus', ['submitted', 'approved', 'returned', 'rejected']] }, 1, 0] } },
          evalApproved: { $sum: { $cond: [{ $eq: ['$evalStatus', 'approved'] }, 1, 0] } },
        },
      },
    ]),
    Report.countDocuments(),
    Report.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Report.aggregate([{ $group: { _id: '$kind', n: { $sum: 1 } } }]),
    Report.aggregate([{ $group: { _id: '$workflow', n: { $sum: 1 } } }]),
    Report.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
          sent: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        },
      },
    ]),
    Report.countDocuments(stalledFilter),
    Report.find(stalledFilter)
      .sort({ updatedAt: 1 })
      .limit(8)
      .select('workflow recipients currentApproverId reviews kind updatedAt snapshot.ownerName snapshot.periodName')
      .populate('currentApproverId', 'fullName')
      .populate('recipients.user', 'fullName')
      .lean(),
    Report.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, avgMs: { $avg: { $subtract: ['$updatedAt', '$createdAt'] } } } }]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: since(13) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: since(30) } } },
      { $group: { _id: '$action', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 6 },
    ]),
    AuditLog.find().sort({ createdAt: -1 }).limit(10).populate('actor', 'fullName roles').lean(),
  ]);

  // fill the gaps so charts always show 6 months / 14 days
  const monthMap = new Map(monthly.map((r) => [`${r._id.y}-${r._id.m}`, r]));
  const monthlySeries = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
    const r = monthMap.get(ym(d));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, sent: r?.sent || 0, approved: r?.approved || 0 };
  });
  const dayMap = new Map(auditDaily.map((r) => [r._id, r.n]));
  const dailySeries = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getTime() - (13 - i) * DAY);
    const key = d.toISOString().slice(0, 10);
    return { date: key, n: dayMap.get(key) || 0 };
  });

  const ppMap = new Map(perPeriod.map((r) => [idStr(r._id), r]));
  const periods = [...recentPeriods].reverse().map((p) => {
    const r = ppMap.get(idStr(p._id));
    return {
      _id: p._id, name: p.name, status: p.status, expected: expectedReporters,
      plans: r?.plans || 0, planApproved: r?.planApproved || 0, evalSent: r?.evalSent || 0, evalApproved: r?.evalApproved || 0,
    };
  });

  const stalled = stalledDocs.map((r) => ({
    owner: r.snapshot.ownerName,
    period: r.snapshot.periodName,
    kind: r.kind,
    workflow: r.workflow,
    days: Math.floor((now - r.updatedAt) / DAY),
    waitingFor:
      r.workflow === 'hierarchical'
        ? [r.currentApproverId?.fullName].filter(Boolean)
        : r.recipients
            .filter((x) => x.type === 'to' && !r.reviews.some((v) => idStr(v.reviewer) === idStr(x.user)))
            .map((x) => x.user?.fullName)
            .filter(Boolean),
  }));

  const openPeriods = Object.fromEntries(periodStatus.map((r) => [r._id, r.n]));
  res.json({
    generatedAt: now,
    users: {
      total: totalUsers, active: activeUsers, inactive: totalUsers - activeUsers, pending: pendingUsers,
      signedIn7d, new30d, withoutManager,
      byRole: countMap(byRole),
      byDepartment: byDept.map((d) => ({ name: d.name, nameAm: d.nameAm, n: d.n })),
    },
    departments: deptCount,
    periods: { open: openPeriods.open || 0, closed: openPeriods.closed || 0, recent: periods },
    plans: {
      total: plansTotal, byPlanStatus: countMap(planStatus), byEvalStatus: countMap(evalStatus),
      averageScore: scoreAgg[0] ? Math.round(scoreAgg[0].avg) : null, evaluated: scoreAgg[0]?.n || 0,
    },
    reports: {
      total: reportsTotal, byStatus: countMap(reportStatus), byKind: countMap(reportKind), byWorkflow: countMap(reportWorkflow),
      monthly: monthlySeries, stalledCount, stalled,
      avgApprovalHours: approvalAgg[0] ? Math.round((approvalAgg[0].avgMs / 3600000) * 10) / 10 : null,
    },
    activity: { daily: dailySeries, topActions: topActions.map((a) => ({ action: a._id, n: a.n })), recent: recentAudit },
    system: {
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'down',
      databaseName: mongoose.connection.name,
      emailEnabled: mailEnabled,
      environment: env.isProd ? 'production' : 'development',
      registrationOpen: env.allowRegistration,
    },
  });
});
