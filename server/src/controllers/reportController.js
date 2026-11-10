import Report from '../models/Report.js';
import WorkPlan from '../models/WorkPlan.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { ROLES, hasRole } from '../config/roles.js';
import { env } from '../config/env.js';
import { asyncHandler, HttpError, bad, conflict, forbidden, idOf, paginate } from '../utils/http.js';
import { notify, audit } from '../services/notify.js';
import { sendReportEmails } from '../services/mailer.js';
import {
  buildChainInfo, buildRecipients, loadReportForUser, makeSnapshot, pendingFilter, validatePlanForKind,
} from '../services/reportService.js';
import {
  afterApprove, canDecide, canForward, insertNextApprover, isOpen, phaseStatusFor,
} from '../services/workflow.js';

const link = (id) => `${env.clientUrls[0]}/reports/${id}`;

const summarize = (r, uid) => {
  const rec = r.recipients.find((x) => idOf(x.user) === uid);
  return {
    _id: r._id,
    kind: r.kind,
    status: r.status,
    workflow: r.workflow,
    subject: r.subject,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    forwarded: Boolean(r.forwardedFrom),
    sender: r.sender,
    recipients: r.recipients.map((x) => ({ user: x.user, type: x.type })),
    myRole: rec?.type || null,
    unread: rec ? !rec.readAt : false,
    needsMyDecision: canDecide(r, uid),
    snapshot: {
      ownerName: r.snapshot.ownerName,
      departmentName: r.snapshot.departmentName,
      departmentNameAm: r.snapshot.departmentNameAm,
      periodName: r.snapshot.periodName,
      scoreWeighted: r.snapshot.scoreWeighted,
      scoreByCount: r.snapshot.scoreByCount,
    },
  };
};

const listFilter = (req, base) => {
  const f = { ...base };
  if (['plan', 'evaluation'].includes(req.query.kind)) f.kind = req.query.kind;
  if (['submitted', 'in_review', 'approved', 'returned', 'rejected'].includes(req.query.status)) f.status = req.query.status;
  return f;
};

const LIST_SELECT = '-snapshot.tasks';
const populateList = (q) => q.populate('sender', 'fullName roles').populate('recipients.user', 'fullName');

async function pushPlanHistory(planId, entry) {
  const plan = await WorkPlan.findById(planId);
  if (!plan) return null;
  plan.history.push(entry);
  return plan;
}

// ---------------------------------------------------------------- send
export const sendReport = asyncHandler(async (req, res) => {
  const { planId, kind, workflow, subject, message } = req.body;
  const plan = await WorkPlan.findOne({ _id: planId, owner: req.user._id })
    .populate('department', 'name nameAm')
    .populate('period');
  if (!plan) throw new HttpError(404, 'Plan not found');
  if (plan.period.status !== 'open') throw conflict('This reporting period is closed. Ask the administrator to reopen it.');

  const editable = kind === 'plan' ? plan.planEditable() : plan.evalEditable();
  if (!editable) throw conflict('This report was already sent and is waiting for a decision, or it has a final decision');
  validatePlanForKind(plan, kind);

  let recipients;
  let populated;
  let chain = [];
  if (workflow === 'hierarchical') {
    const info = await buildChainInfo(req.user._id);
    if (info.stop === 'ambiguous') {
      throw bad(`Your superior cannot be decided automatically: several people hold the position "${info.positionName}". Ask the administrator to set your direct manager.`);
    }
    chain = info.ids;
    if (chain.length === 0) {
      throw bad('You have no approval chain yet. Ask the administrator to set your position or manager, or choose "Direct" and pick the recipients yourself.');
    }
    // The sender may stop the chain earlier: the report only goes up to the approver who is really concerned.
    if (req.body.finalApproverId) {
      const at = chain.indexOf(String(req.body.finalApproverId));
      if (at < 0) throw bad('The chosen final approver is not in your approval chain');
      chain = chain.slice(0, at + 1);
    }
    const firstUser = await User.findById(chain[0]).select('fullName email roles jobTitle');
    const cc = await buildRecipients([], req.body.cc.filter((id) => id !== chain[0]), req.user._id, { requireTo: false });
    recipients = [{ user: firstUser._id, type: 'to' }, ...cc.recipients];
    populated = [{ user: firstUser, type: 'to' }, ...cc.populated];
  } else {
    ({ recipients, populated } = await buildRecipients(req.body.to, req.body.cc, req.user._id));
  }

  const snapshot = makeSnapshot(plan, req.user, plan.department, plan.period);
  const report = await Report.create({
    plan: plan._id,
    kind,
    sender: req.user._id,
    workflow,
    recipients,
    approvalChain: chain,
    approvalIndex: 0,
    currentApproverId: workflow === 'hierarchical' ? chain[0] : null,
    subject,
    message,
    snapshot,
  });

  if (kind === 'plan') {
    plan.planStatus = 'submitted';
    plan.planSubmittedAt = new Date();
  } else {
    plan.evalStatus = 'submitted';
    plan.evalSubmittedAt = new Date();
  }
  plan.history.push({ action: 'submitted', phase: kind, actor: req.user._id, comment: message.slice(0, 300) });
  plan.recalc();
  await plan.save();

  await notify(recipients.map((r) => r.user), {
    type: 'report_received',
    meta: { sender: req.user.fullName, kind, period: snapshot.periodName },
    report: report._id,
    plan: plan._id,
  });
  await audit(req.user._id, 'report.send', 'Report', report._id, {
    kind, workflow,
    to: recipients.filter((r) => r.type === 'to').map((r) => String(r.user)),
    cc: recipients.filter((r) => r.type === 'cc').map((r) => String(r.user)),
    chain: chain.map(String),
  });
  sendReportEmails({ report, sender: req.user, recipients: populated, link: link(report._id) }).catch(() => {});

  res.status(201).json({ report: { _id: report._id, status: report.status, kind: report.kind } });
});

// ---------------------------------------------------------------- lists
export const inbox = asyncHandler(async (req, res) => {
  const uid = idOf(req.user._id);
  const { page, limit, skip } = paginate(req.query);
  let filter;
  if (req.query.pending === 'true') {
    filter = listFilter(req, pendingFilter(req.user._id));
  } else {
    const elem = { user: req.user._id };
    if (req.query.unread === 'true') elem.readAt = null;
    filter = listFilter(req, { recipients: { $elemMatch: elem } });
  }
  const [items, total] = await Promise.all([
    populateList(Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select(LIST_SELECT)).lean(),
    Report.countDocuments(filter),
  ]);
  res.json({ items: items.map((r) => summarize(r, uid)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const sent = asyncHandler(async (req, res) => {
  const uid = idOf(req.user._id);
  const { page, limit, skip } = paginate(req.query);
  const filter = listFilter(req, { sender: req.user._id });
  const [items, total] = await Promise.all([
    populateList(Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select(LIST_SELECT)).lean(),
    Report.countDocuments(filter),
  ]);
  res.json({ items: items.map((r) => summarize(r, uid)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const stats = asyncHandler(async (req, res) => {
  const [unread, pending] = await Promise.all([
    Report.countDocuments({ recipients: { $elemMatch: { user: req.user._id, readAt: null } } }),
    Report.countDocuments(pendingFilter(req.user._id)),
  ]);
  res.json({ unread, pending });
});

// ---------------------------------------------------------------- one report
export const getReport = asyncHandler(async (req, res) => {
  const { report, isSender, rec } = await loadReportForUser(req.params.id, req.user);
  const uid = idOf(req.user._id);
  const now = new Date();

  if (rec && !rec.readAt) {
    await Report.updateOne(
      { _id: report._id },
      { $set: { 'recipients.$[r].readAt': now } },
      { arrayFilters: [{ 'r.user': req.user._id, 'r.readAt': null }], timestamps: false }
    );
    await Notification.updateMany({ user: req.user._id, report: report._id, isRead: false }, { isRead: true });
  }

  const seesReceipts = isSender || hasRole(req.user, ROLES.GM);
  const obj = report.toObject();
  obj.recipients = obj.recipients.map((r) => {
    const mine = idOf(r.user) === uid;
    return { ...r, readAt: seesReceipts ? r.readAt : mine ? r.readAt || now : undefined };
  });
  res.json({
    report: obj,
    myRole: rec?.type || (isSender ? 'sender' : 'viewer'),
    canReview: canDecide(report, uid),
    canForward: canForward(report, uid),
  });
});

// ---------------------------------------------------------------- decide
export const reviewReport = asyncHandler(async (req, res) => {
  const { report, rec } = await loadReportForUser(req.params.id, req.user, { populate: false });
  if (!isOpen(report)) throw conflict('This report already has a final decision');
  if (!canDecide(report, req.user._id)) {
    throw forbidden(rec?.type === 'cc' ? 'CC recipients cannot decide on a report' : 'It is not your turn to decide on this report');
  }

  const { decision, comment } = req.body;
  if (decision !== 'approved' && comment.length < 3) {
    throw bad('Write a short comment explaining the reason');
  }

  const snap = report.snapshot;
  const phaseField = report.kind === 'plan' ? 'planStatus' : 'evalStatus';
  report.reviews.push({ reviewer: req.user._id, decision, comment });

  let next = { final: true };
  if (decision === 'approved') {
    next = afterApprove(report);
    if (next.final) {
      report.status = 'approved';
      report.currentApproverId = null;
    } else {
      report.status = 'in_review';
      report.approvalIndex = next.nextIndex;
      report.currentApproverId = next.nextApproverId;
      const existing = report.recipients.find((r) => idOf(r.user) === next.nextApproverId);
      if (existing) existing.type = 'to';
      else report.recipients.push({ user: next.nextApproverId, type: 'to', readAt: null });
    }
  } else {
    report.status = decision; // returned | rejected
    report.currentApproverId = null;
  }
  await report.save();

  const plan = await pushPlanHistory(report.plan, { action: decision, phase: report.kind, actor: req.user._id, comment });
  if (plan) {
    if (next.final && plan[phaseField] === 'submitted') plan[phaseField] = phaseStatusFor(decision);
    await plan.save();
  }

  const meta = { reviewer: req.user.fullName, kind: report.kind, period: snap.periodName, comment: comment.slice(0, 200) };
  const ownerId = idOf(snap.ownerId);
  const informees = [...new Set([idOf(report.sender), ownerId])];

  if (decision === 'approved' && !next.final) {
    const senderUser = await User.findById(report.sender).select('fullName');
    await notify([next.nextApproverId], {
      type: 'report_received',
      meta: { sender: senderUser?.fullName || snap.ownerName, kind: report.kind, period: snap.periodName, step: next.nextIndex + 1, of: report.approvalChain.length },
      report: report._id,
      plan: report.plan,
    });
    await notify([report.sender], {
      type: 'report_approved',
      meta: { ...meta, step: next.nextIndex, of: report.approvalChain.length, partial: true },
      report: report._id,
      plan: report.plan,
    });
  } else {
    const type = decision === 'approved' ? 'report_approved' : decision === 'returned' ? 'report_returned' : 'report_rejected';
    await notify([report.sender], { type, meta, report: report._id, plan: report.plan });
    if (informees.length > 1) await notify(informees.filter((x) => x !== idOf(report.sender)), { type, meta, plan: report.plan });
  }
  await audit(req.user._id, `report.${decision === 'approved' ? 'approve' : decision === 'returned' ? 'return' : 'reject'}`, 'Report', report._id, { comment });
  res.json({ ok: true, status: report.status, final: next.final });
});

// ---------------------------------------------------------------- forward
export const forwardReport = asyncHandler(async (req, res) => {
  const { report } = await loadReportForUser(req.params.id, req.user, { populate: false });
  if (!canForward(report, req.user._id)) throw forbidden('You cannot forward this report');
  const snap = report.snapshot;
  const ownerId = idOf(snap.ownerId);
  const { message, subject } = req.body;

  if (report.workflow === 'hierarchical') {
    // The person is inserted as the next approver after me.
    const targetId = req.body.to[0];
    if (!targetId) throw bad('Choose the person who should approve next');
    if (targetId === idOf(req.user._id) || targetId === ownerId || targetId === idOf(report.sender)) {
      throw bad('Choose someone else');
    }
    const target = await User.findOne({ _id: targetId, isActive: true }).select('fullName');
    if (!target) throw bad('That user is not active');
    const chain = insertNextApprover(report.approvalChain, report.approvalIndex, targetId);
    if (!chain) throw conflict('This person is already in the approval route');
    report.approvalChain = chain;
    report.reviews.push({ reviewer: req.user._id, decision: 'forwarded', comment: message });
    await report.save();
    const plan = await pushPlanHistory(report.plan, { action: 'forwarded', phase: report.kind, actor: req.user._id, comment: `→ ${target.fullName}. ${message}`.trim() });
    if (plan) await plan.save();
    await notify([report.sender], {
      type: 'report_forwarded',
      meta: { forwarder: req.user.fullName, kind: report.kind, period: snap.periodName, to: target.fullName },
      report: report._id,
      plan: report.plan,
    });
    await audit(req.user._id, 'report.forward', 'Report', report._id, { addedApprover: targetId });
    return res.status(201).json({ report: { _id: report._id } });
  }

  // direct workflow: a copy goes to the new recipients, who can decide on it
  const { recipients, populated } = await buildRecipients(req.body.to, req.body.cc, req.user._id);
  const forwarded = await Report.create({
    plan: report.plan,
    kind: report.kind,
    sender: req.user._id,
    workflow: 'direct',
    recipients,
    subject: subject || `Fwd: ${report.subject || ''}`.trim(),
    message,
    snapshot: report.toObject().snapshot,
    forwardedFrom: report._id,
  });
  report.reviews.push({ reviewer: req.user._id, decision: 'forwarded', comment: message });
  await report.save();
  const plan = await pushPlanHistory(report.plan, { action: 'forwarded', phase: report.kind, actor: req.user._id, comment: message });
  if (plan) await plan.save();

  await notify(recipients.map((r) => r.user), {
    type: 'report_received',
    meta: { sender: req.user.fullName, kind: report.kind, period: snap.periodName, forwarded: true },
    report: forwarded._id,
    plan: report.plan,
  });
  if (ownerId !== idOf(req.user._id)) {
    await notify([ownerId], {
      type: 'report_forwarded',
      meta: { forwarder: req.user.fullName, kind: report.kind, period: snap.periodName },
      plan: report.plan,
    });
  }
  await audit(req.user._id, 'report.forward', 'Report', forwarded._id, { from: String(report._id), to: recipients.map((r) => String(r.user)) });
  sendReportEmails({ report: forwarded, sender: req.user, recipients: populated, link: link(forwarded._id) }).catch(() => {});
  return res.status(201).json({ report: { _id: forwarded._id } });
});

