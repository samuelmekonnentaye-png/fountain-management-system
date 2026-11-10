import WorkPlan from '../models/WorkPlan.js';
import ReportingPeriod from '../models/ReportingPeriod.js';
import Report from '../models/Report.js';
import { ROLES, hasRole } from '../config/roles.js';
import { asyncHandler, HttpError, bad, conflict, idOf, isObjectId, notFound, toInt } from '../utils/http.js';
import { audit } from '../services/notify.js';
import { periodsOfYear } from '../services/analytics.js';

const BLANK_TASK = {
  title: '', description: '', kpi: '', target: 1, unit: 'tasks', weight: 0, startDate: null, dueDate: null,
  status: 'pending', actual: 0, actualResult: '', shortfallReason: '',
};

// Planning fields are editable while the plan phase is draft/returned;
// evaluation fields while the evaluation phase is open. Anything else is ignored.
function applyTask(base, raw, { planEditable, evalEditable }) {
  const t = { ...base };
  if (planEditable) {
    for (const k of ['title', 'description', 'kpi', 'target', 'weight', 'startDate', 'dueDate']) {
      if (raw[k] !== undefined) t[k] = raw[k];
    }
    if (raw.unit !== undefined) t.unit = raw.unit || 'tasks';
  }
  if (evalEditable) {
    for (const k of ['status', 'actual', 'actualResult', 'shortfallReason']) {
      if (raw[k] !== undefined) t[k] = raw[k];
    }
  }
  if (t.startDate && t.dueDate && new Date(t.dueDate) < new Date(t.startDate)) {
    throw bad(`"${t.title || 'Task'}": the due date must be on or after the start date`);
  }
  if (t.status === 'completed') t.shortfallReason = '';
  return t;
}

async function loadOwnPlan(req) {
  if (!isObjectId(req.params.id)) throw notFound('Plan not found');
  const plan = await WorkPlan.findById(req.params.id);
  if (!plan) throw notFound('Plan not found');
  if (idOf(plan.owner) !== idOf(req.user._id)) throw new HttpError(403, 'This plan belongs to another employee');
  return plan;
}

const planDTO = (plan) => ({
  ...plan.toObject(),
  planEditable: plan.planEditable(),
  evalEditable: plan.evalEditable(),
});

const summary = (p) => ({
  _id: p._id,
  title: p.title,
  taskCount: p.tasks.length,
  completedCount: p.tasks.filter((t) => t.status === 'completed').length,
  planStatus: p.planStatus,
  evalStatus: p.evalStatus,
  scoreByCount: p.scoreByCount,
  scoreWeighted: p.scoreWeighted,
  evaluated: p.tasks.some((t) => t.status !== 'pending'),
});

// All reporting periods of a year, each with MY plan for it (or null).
export const overview = asyncHandler(async (req, res) => {
  const year = toInt(req.query.year, new Date().getFullYear(), 2000, 2100);
  const periods = await periodsOfYear(year);
  const plans = await WorkPlan.find({ owner: req.user._id, period: { $in: periods.map((p) => p._id) } }).lean();
  const byPeriod = new Map(plans.map((p) => [idOf(p.period), p]));
  res.json({
    year,
    items: periods.map((period) => ({ period, plan: byPeriod.has(idOf(period._id)) ? summary(byPeriod.get(idOf(period._id))) : null })),
  });
});

export const createPlan = asyncHandler(async (req, res) => {
  const period = await ReportingPeriod.findById(req.body.periodId);
  if (!period) throw bad('Reporting period not found');
  if (period.status !== 'open') throw conflict('This reporting period is closed');
  if (await WorkPlan.exists({ owner: req.user._id, period: period._id })) {
    throw conflict('You already have a plan for this period');
  }
  const flags = { planEditable: true, evalEditable: false };
  const tasks = (req.body.tasks || []).map((r) => {
    const t = applyTask(BLANK_TASK, r, flags);
    if (!t.title) throw bad('Every task needs a title');
    return t;
  });

  const plan = new WorkPlan({
    owner: req.user._id,
    department: req.user.department || undefined,
    period: period._id,
    title: req.body.title || period.name,
    objectives: req.body.objectives || '',
    tasks,
    history: [{ action: 'created', phase: 'plan', actor: req.user._id }],
  });
  plan.recalc();
  await plan.save();
  await audit(req.user._id, 'plan.create', 'WorkPlan', plan._id, { period: period.name });
  res.status(201).json({ plan: planDTO(plan) });
});

export const getPlan = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Plan not found');
  const plan = await WorkPlan.findById(req.params.id)
    .populate('period', 'name type startDate endDate status')
    .populate('history.actor', 'fullName');
  if (!plan) throw notFound('Plan not found');
  const isOwner = idOf(plan.owner) === idOf(req.user._id);
  const gmMayView = hasRole(req.user, ROLES.GM) && (plan.planStatus !== 'draft' || plan.evalStatus !== 'not_started');
  if (!isOwner && !gmMayView) throw new HttpError(403, 'You do not have access to this plan');

  const reports = await Report.find({ plan: plan._id, sender: plan.owner })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('kind status reviews createdAt subject workflow')
    .populate('reviews.reviewer', 'fullName')
    .lean();
  res.json({ plan: planDTO(plan), reports });
});

export const updatePlan = asyncHandler(async (req, res) => {
  const plan = await loadOwnPlan(req);
  const flags = { planEditable: plan.planEditable(), evalEditable: plan.evalEditable() };
  if (!flags.planEditable && !flags.evalEditable) {
    throw conflict('This plan is locked while it is waiting for review or after a final decision');
  }
  const { title, objectives, tasks } = req.body;
  if (flags.planEditable) {
    if (title !== undefined) plan.title = title;
    if (objectives !== undefined) plan.objectives = objectives;
  }

  if (tasks) {
    const existing = new Map(plan.tasks.map((t) => [String(t._id), t]));
    const seen = new Set();
    const next = [];
    for (const raw of tasks) {
      const current = raw._id ? existing.get(String(raw._id)) : null;
      if (current) {
        seen.add(String(raw._id));
        const updated = applyTask(current.toObject(), raw, flags);
        if (!updated.title) throw bad('Every task needs a title');
        next.push(updated);
      } else if (flags.planEditable) {
        const created = applyTask(BLANK_TASK, raw, flags);
        if (!created.title) throw bad('Every task needs a title');
        next.push(created);
      }
    }
    // Tasks missing from the request are removed only while the plan itself is editable.
    for (const [id, t] of existing) {
      if (!seen.has(id) && !flags.planEditable) next.push(t.toObject());
    }
    plan.tasks = next;
  }

  if (flags.evalEditable && plan.evalStatus === 'not_started' && plan.tasks.some((t) => t.status !== 'pending')) {
    plan.evalStatus = 'draft';
  }
  plan.recalc();
  await plan.save();
  await audit(req.user._id, 'plan.update', 'WorkPlan', plan._id, { tasks: plan.tasks.length });
  res.json({ plan: planDTO(plan) });
});

// A rejected phase is locked; the owner can reopen it as a draft and send it again.
export const reopenPlan = asyncHandler(async (req, res) => {
  const plan = await loadOwnPlan(req);
  const field = req.body.phase === 'plan' ? 'planStatus' : 'evalStatus';
  if (plan[field] !== 'rejected') throw conflict('Only a rejected report can be reopened');
  plan[field] = 'draft';
  plan.history.push({ action: 'reopened', phase: req.body.phase, actor: req.user._id });
  await plan.save();
  await audit(req.user._id, 'plan.reopen', 'WorkPlan', plan._id, { phase: req.body.phase });
  res.json({ plan: planDTO(plan) });
});

export const deletePlan = asyncHandler(async (req, res) => {
  const plan = await loadOwnPlan(req);
  if (plan.planStatus !== 'draft' || plan.evalStatus !== 'not_started') {
    throw conflict('Only plans that were never sent can be deleted');
  }
  if (await Report.exists({ plan: plan._id })) throw conflict('This plan already has reports');
  await plan.deleteOne();
  await audit(req.user._id, 'plan.delete', 'WorkPlan', plan._id, {});
  res.json({ ok: true });
});
