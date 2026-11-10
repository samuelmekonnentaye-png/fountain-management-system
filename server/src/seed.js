// Demo data for local testing:  npm run seed   (or  npm run seed:reset  to wipe everything first)
// It loads the company organisation chart and a few people placed in it. Do NOT use it on the online database.
import './config/env.js';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Department from './models/Department.js';
import Position from './models/Position.js';
import ReportingPeriod from './models/ReportingPeriod.js';
import WorkPlan from './models/WorkPlan.js';
import Report from './models/Report.js';
import Meeting from './models/Meeting.js';
import { expandInvites } from './services/meetingLogic.js';
import Notification from './models/Notification.js';
import AuditLog from './models/AuditLog.js';
import { ROLES } from './config/roles.js';
import { makeSnapshot, loadOrgIndex } from './services/reportService.js';
import { resolveChain } from './services/orgChain.js';
import { importOrg } from './services/orgImport.js';

const reset = process.argv.includes('--reset');
await connectDB();

if (reset) {
  await Promise.all([User, Department, Position, ReportingPeriod, WorkPlan, Report, Notification, AuditLog].map((m) => m.deleteMany({})));
  // drop indexes left over from older versions (they are rebuilt from the models)
  await Promise.all([User, Position, WorkPlan, Report, Notification].map((m) => m.syncIndexes().catch(() => {})));
  console.log('Existing data removed.');
} else if ((await User.countDocuments()) > 0) {
  console.log('The database already has users. Run "npm run seed:reset" to wipe it and load demo data.');
  await mongoose.disconnect();
  process.exit(0);
}

// ---- the organisation chart
const org = await importOrg();
console.log(`Organisation chart loaded: ${org.unitsCreated} units, ${org.positionsCreated} positions.`);
const D = Object.fromEntries((await Department.find()).map((d) => [d.name, d]));
const P = Object.fromEntries((await Position.find()).map((p) => [p.name, p]));

// ---- people, placed in the chart (the superior comes from the chart; nobody needs a manager by hand here)
const PW = 'Fountain@123';
let seq = 1;
const mk = (fullName, email, roles, positionName, password = PW) =>
  User.create({
    fullName, email, password, roles,
    position: positionName ? P[positionName]._id : undefined,
    department: positionName ? P[positionName].department : D['Information Technology']._id,
    jobTitle: positionName || 'System Admin',
    employeeId: `FIT-${String(seq++).padStart(3, '0')}`,
  });

const gm = await mk('Ato Tesfaye Bekele', 'gm@fountain.com', [ROLES.GM], 'General Manager (GM)');
const dgm = await mk('Ato Dawit Hailu', 'deputy@fountain.com', [ROLES.DEPUTY_GM], 'Deputy General Manager');
const abate = await mk('Ato Abate Girma', 'abate@fountain.com', [ROLES.MANAGER], 'Security Section Operation Manager');
const tigist = await mk('W/ro Tigist Haile', 'tigist@fountain.com', [ROLES.DEPARTMENT_HEAD], 'District Operation Section Head (Security)');
const biruk = await mk('Ato Biruk Tadesse', 'biruk@fountain.com', [ROLES.EMPLOYEE], 'Supervisors (District Operation)');
const dagim = await mk('Dagim Alemu', 'dagim@fountain.com', [ROLES.EMPLOYEE], 'Shift Leaders');
const selam = await mk('W/ro Selamawit Mekonnen', 'selamawit@fountain.com', [ROLES.DEPARTMENT_HEAD], 'Marketing & Customer Relations Department Head');
const samuel = await mk('Samuel Tadesse', 'samuel@fountain.com', [ROLES.EMPLOYEE], 'Business Development and Customer Relation Expert');
const meron = await mk('Meron Assefa', 'meron@fountain.com', [ROLES.EMPLOYEE], 'Bid Preparation Expert');
const henok = await mk('Ato Henok Alemu', 'henok@fountain.com', [ROLES.DEPARTMENT_HEAD], 'Finance Department Head');
const yonas = await mk('Yonas Kebede', 'yonas@fountain.com', [ROLES.EMPLOYEE], 'Accounting Team');
const hana = await mk('Hana Worku', 'hana@fountain.com', [ROLES.DEPARTMENT_HEAD], 'IT Senior Supervisor');
await mk('W/ro Kidist Alemu', 'kidist@fountain.com', [ROLES.MANAGER], 'Human Resource Manager (HRM)');
const admin = await mk('System Administrator', 'admin@fountain.com', [ROLES.ADMIN], null, 'Admin@12345');

// the chain of every demo person comes from the chart
const idx = await loadOrgIndex();
const users = Object.fromEntries((await User.find()).map((u) => [String(u._id), u]));
const chainOf = (u) => resolveChain(u._id, idx).ids.map((id) => users[id]);

// ---- reporting periods: last month and this month (both open)
const now = new Date();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthly = (y, m) =>
  ReportingPeriod.create({
    name: `${MONTHS[m]} ${y}`, type: 'monthly',
    startDate: new Date(Date.UTC(y, m, 1)), endDate: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59)),
  });
const prevY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
const prevM = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
const pPrev = await monthly(prevY, prevM);
const pCur = await monthly(now.getFullYear(), now.getMonth());
const day = (n) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + n));

// task helper: T(title, kpi, target, unit, weight, status, actual, result, shortfall, dueDate)
const T = (title, kpi, target, unit, weight, status, actual = 0, actualResult = '', shortfallReason = '', dueDate = null) => ({
  title, kpi, target, unit, weight, status, actual, actualResult, shortfallReason, dueDate,
});

async function makePlan(owner, period, title, tasks, { planStatus = 'draft', evalStatus = 'not_started' } = {}) {
  const plan = new WorkPlan({
    owner: owner._id, department: owner.department, period: period._id, title, tasks, planStatus, evalStatus,
    history: [{ action: 'created', phase: 'plan', actor: owner._id }],
  });
  plan.recalc();
  await plan.save();
  return plan;
}

async function makeReport(plan, owner, period, o) {
  const open = ['submitted', 'in_review'].includes(o.status);
  const chain = o.chain || [];
  const dept = await Department.findById(owner.department);
  const shown = o.workflow === 'hierarchical' ? chain.slice(0, (o.index || 0) + 1) : o.to;
  return Report.create({
    plan: plan._id,
    kind: o.kind,
    sender: owner._id,
    workflow: o.workflow || 'direct',
    recipients: [...shown.map((u) => ({ user: u._id, type: 'to' })), ...(o.cc || []).map((u) => ({ user: u._id, type: 'cc' }))],
    approvalChain: chain.map((u) => u._id),
    approvalIndex: o.index || 0,
    currentApproverId: o.workflow === 'hierarchical' && open ? chain[o.index || 0]._id : null,
    subject: `${o.kind === 'plan' ? 'Work plan' : 'Monthly evaluation'} – ${period.name}`,
    message: o.kind === 'plan' ? 'Please find my work plan for this period.' : 'Please find my evaluation for this period.',
    snapshot: makeSnapshot(plan, owner, dept, period),
    reviews: (o.reviews || []).map((r) => ({ reviewer: r.by._id, decision: r.decision, comment: r.comment || '' })),
    status: o.status,
  });
}
async function addHistory(plan, entries) {
  entries.forEach((e) => plan.history.push({ phase: e.phase, action: e.action, actor: e.by._id, comment: e.comment || '' }));
  await plan.save();
}

// ===== Samuel (Marketing): his line is only  Department Head -> General Manager
const chainS = chainOf(samuel);
const samuelPrev = await makePlan(samuel, pPrev, 'Business development targets', [
  T('Visit key customers', '20 customers visited', 20, 'visits', 30, 'completed', 22, '22 customers visited'),
  T('Close new supply contracts', '5 signed contracts', 5, 'contracts', 25, 'completed', 6, '6 contracts signed'),
  T('Submit weekly sales report', '4 reports on time', 4, 'reports', 15, 'completed', 4, 'All submitted on time'),
  T('Update customer database', '100% of records updated', 100, '%', 15, 'completed', 100, 'Completed'),
  T('Run one promotion campaign', 'Campaign launched', 1, 'campaign', 15, 'not_completed', 0.4, 'Design finished, launch pending', 'Budget approval arrived late'),
], { planStatus: 'approved', evalStatus: 'submitted' });
await makeReport(samuelPrev, samuel, pPrev, { kind: 'plan', to: [selam], reviews: [{ by: selam, decision: 'approved', comment: 'Plan accepted.' }], status: 'approved' });
await makeReport(samuelPrev, samuel, pPrev, {
  kind: 'evaluation', workflow: 'hierarchical', chain: chainS, index: 1, status: 'in_review',
  reviews: [{ by: selam, decision: 'approved', comment: 'Good month.' }],
});
await addHistory(samuelPrev, [
  { action: 'submitted', phase: 'plan', by: samuel }, { action: 'approved', phase: 'plan', by: selam, comment: 'Plan accepted.' },
  { action: 'submitted', phase: 'evaluation', by: samuel }, { action: 'approved', phase: 'evaluation', by: selam, comment: 'Good month.' },
]);

await makePlan(samuel, pCur, 'Business development targets', [
  T('Visit key customers', '25 customers visited', 25, 'visits', 30, 'in_progress', 10, '', '', day(6)),
  T('Close new supply contracts', '6 signed contracts', 6, 'contracts', 25, 'pending', 0, '', '', day(12)),
  T('Launch promotion campaign', 'Campaign launched', 1, 'campaign', 25, 'pending', 0, '', '', day(2)),
  T('Weekly sales reports', '4 reports on time', 4, 'reports', 20, 'in_progress', 1, '', '', day(20)),
], { planStatus: 'approved', evalStatus: 'draft' });

// ===== Meron: evaluation waits for her Department Head
const meronPrev = await makePlan(meron, pPrev, 'Bid preparation', [
  T('Prepare tender documents', '12 documents', 12, 'documents', 40, 'completed', 13, '13 documents'),
  T('Update the company profile', 'Profile updated', 1, 'profile', 35, 'completed', 1, 'Updated'),
  T('Organise a customer event', 'Event held', 1, 'event', 25, 'not_completed', 0.3, 'Venue booked only', 'Event postponed by the organiser'),
], { planStatus: 'approved', evalStatus: 'submitted' });
await makeReport(meronPrev, meron, pPrev, { kind: 'evaluation', workflow: 'hierarchical', chain: chainOf(meron), index: 0, status: 'submitted' });

// ===== Yonas (Finance): evaluation returned by the Finance Department Head
const yonasPrev = await makePlan(yonas, pPrev, 'Accounting tasks', [
  T('Close monthly books', 'Books closed by day 5', 1, 'closing', 50, 'completed', 1, 'Closed on day 4'),
  T('Reconcile bank statements', 'All accounts reconciled', 100, '%', 30, 'completed', 100, 'Done'),
  T('Prepare VAT return', 'Filed on time', 1, 'return', 20, 'not_completed', 0.6, 'Draft prepared', 'Missing invoices from suppliers'),
], { planStatus: 'approved', evalStatus: 'returned' });
await makeReport(yonasPrev, yonas, pPrev, {
  kind: 'evaluation', workflow: 'hierarchical', chain: chainOf(yonas), index: 0, status: 'returned',
  reviews: [{ by: henok, decision: 'returned', comment: 'Please attach the list of missing supplier invoices.' }],
});
await addHistory(yonasPrev, [
  { action: 'submitted', phase: 'evaluation', by: yonas },
  { action: 'returned', phase: 'evaluation', by: henok, comment: 'Please attach the list of missing supplier invoices.' },
]);

// ===== Hana (IT Senior Supervisor reports straight to the General Manager): approved
const hanaPrev = await makePlan(hana, pPrev, 'IT support', [
  T('Resolve helpdesk tickets', '95% resolved within SLA', 95, '%', 50, 'completed', 97, '97% within SLA'),
  T('Set up backup server', 'Server running', 1, 'server', 30, 'completed', 1, 'Installed and tested'),
  T('Staff security training', '1 session', 1, 'session', 20, 'completed', 1, 'Held for 18 staff'),
], { planStatus: 'approved', evalStatus: 'approved' });
await makeReport(hanaPrev, hana, pPrev, {
  kind: 'evaluation', workflow: 'hierarchical', chain: chainOf(hana), index: 0, status: 'approved',
  reviews: [{ by: gm, decision: 'approved' }],
});

// ===== Dagim (Security, Shift Leader): the longest line - now waiting for the Security Section Operation Manager
const chainD = chainOf(dagim); // Biruk -> Tigist -> Abate -> Dawit -> Tesfaye
const dagimPrev = await makePlan(dagim, pPrev, 'Shift operations', [
  T('Complete all shifts on schedule', '30 shifts', 30, 'shifts', 50, 'completed', 30, 'No missed shift'),
  T('Submit daily incident reports', '30 reports', 30, 'reports', 30, 'completed', 29, '29 reports', ''),
  T('Train two new guards', '2 guards', 2, 'guards', 20, 'completed', 2, 'Both trained'),
], { planStatus: 'approved', evalStatus: 'submitted' });
await makeReport(dagimPrev, dagim, pPrev, {
  kind: 'evaluation', workflow: 'hierarchical', chain: chainD, index: 2, status: 'in_review',
  reviews: [{ by: biruk, decision: 'approved' }, { by: tigist, decision: 'approved', comment: 'Well done.' }],
});

// ===== meetings between departments
const people = {
  users: await User.find({ isActive: true }).select('fullName department position roles isActive').lean(),
  departments: await Department.find().select('name parent').lean(),
  positionsById: new Map((await Position.find().select('approver').lean()).map((p) => [String(p._id), p])),
};
const at = (daysFromToday, hourEat) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday, hourEat - 3, 0));
async function makeMeeting(o) {
  const participants = expandInvites({
    invites: o.invites, invitedUserIds: o.extra || [], organizerId: o.organizer._id, ...people,
  });
  participants.forEach((p, i) => {
    if (p.source !== 'organizer' && o.answers) p.status = o.answers[i % o.answers.length];
    if (o.attended && p.status === 'accepted') p.attended = true;
  });
  return Meeting.create({
    title: o.title, agenda: o.agenda, organizer: o.organizer._id, hostDepartment: o.organizer.department,
    startsAt: o.start, durationMinutes: o.minutes || 60, endsAt: new Date(o.start.getTime() + (o.minutes || 60) * 60000),
    channel: o.channel, joinUrl: o.joinUrl || '', passcode: o.passcode || '', location: o.location || '',
    invites: o.invites.map((i) => ({ department: i.departmentId, scope: i.scope, includeSubunits: i.includeSubunits !== false })),
    invitedUsers: o.extra || [], participants, status: o.status || 'scheduled',
    minutes: o.minutesText || '', minutesUpdatedAt: o.minutesText ? new Date() : undefined,
    actions: o.actions || [],
  });
}
const meetingFinance = await makeMeeting({
  organizer: henok, title: 'Finance and Marketing: monthly coordination',
  agenda: '1. Budget approvals that arrive late\n2. Campaign spending for next month\n3. Invoices from suppliers',
  start: at(2, 9), minutes: 60, channel: 'zoom', joinUrl: 'https://zoom.us/j/1234567890?pwd=demo', passcode: '123456',
  invites: [{ departmentId: D['Marketing & Customer Relations']._id, scope: 'all' }, { departmentId: D['Finance']._id, scope: 'all' }],
  answers: ['accepted', 'invited', 'tentative'],
});
await makeMeeting({
  organizer: abate, title: 'Security Section: weekly briefing', agenda: 'Incidents of the week, shift schedule, equipment.',
  start: at(1, 8), minutes: 45, channel: 'in_person', location: 'Head office, meeting room 2',
  invites: [{ departmentId: D['Security Section']._id, scope: 'all' }], answers: ['accepted', 'invited'],
});
await makeMeeting({
  organizer: gm, title: 'Quarterly review with the heads of all units', agenda: 'Results of the quarter, plans for the next one.',
  start: at(-3, 10), minutes: 90, channel: 'zoom', joinUrl: 'https://zoom.us/j/9876543210',
  invites: [{ departmentId: D["Deputy General Manager's Office"]._id, scope: 'heads', includeSubunits: true }, { departmentId: D['Finance']._id, scope: 'heads' }, { departmentId: D['Marketing & Customer Relations']._id, scope: 'heads' }],
  answers: ['accepted'], attended: true, status: 'completed',
  minutesText: 'The quarter closed above target. Finance will present the new reporting format next month.',
  actions: [{ title: 'Present the new reporting format', owner: henok._id, dueDate: day(20), done: false }, { title: 'Share the campaign results', owner: selam._id, dueDate: day(10), done: true }],
});
await Notification.create([
  { user: samuel._id, type: 'meeting_invited', meta: { title: meetingFinance.title, startsAt: meetingFinance.startsAt.toISOString(), organizer: henok.fullName }, meeting: meetingFinance._id },
]);

// ===== a registration that waits for the System Admin
await User.create({
  fullName: 'Rahel Desta', email: 'rahel@fountain.com', password: PW, roles: [ROLES.EMPLOYEE],
  requestedRoles: [ROLES.EMPLOYEE], position: P['Procurement Officer']._id, department: P['Procurement Officer'].department,
  jobTitle: 'Procurement Officer', approvalStatus: 'pending', isActive: false,
});

await Notification.create([
  { user: admin._id, type: 'registration_pending', meta: { name: 'Rahel Desta', email: 'rahel@fountain.com', requestedRoles: [ROLES.EMPLOYEE] } },
  { user: abate._id, type: 'report_received', meta: { sender: dagim.fullName, kind: 'evaluation', period: pPrev.name, step: 3, of: 5 } },
  { user: gm._id, type: 'report_received', meta: { sender: samuel.fullName, kind: 'evaluation', period: pPrev.name, step: 2, of: 2 } },
  { user: selam._id, type: 'report_received', meta: { sender: meron.fullName, kind: 'evaluation', period: pPrev.name, step: 1, of: 2 } },
  { user: yonas._id, type: 'report_returned', meta: { reviewer: henok.fullName, kind: 'evaluation', period: pPrev.name, comment: 'Please attach the list of missing supplier invoices.' } },
]);

console.log('\nDemo data created. Sign in with:');
console.log('  admin@fountain.com      / Admin@12345   (System Admin)');
console.log(`  gm@fountain.com         / ${PW}   (General Manager)`);
console.log(`  deputy@fountain.com     / ${PW}   (Deputy General Manager)`);
console.log(`  abate@fountain.com      / ${PW}   (Security Section Operation Manager)`);
console.log(`  selamawit@fountain.com  / ${PW}   (Marketing & Customer Relations Head)`);
console.log(`  henok@fountain.com      / ${PW}   (Finance Department Head)`);
console.log(`  samuel@fountain.com     / ${PW}   (Business Development Expert)`);
console.log(`  dagim@fountain.com      / ${PW}   (Shift Leader, the longest chain)`);
console.log(`  meron@, yonas@, hana@, tigist@, biruk@, kidist@fountain.com / ${PW}`);
console.log('\nApproval chains come from the organisation chart, only the people on each own line:');
console.log('  Samuel : Selamawit -> Tesfaye (GM)');
console.log('  Dagim  : Biruk -> Tigist -> Abate -> Dawit -> Tesfaye (GM)');
console.log('A registration request (rahel@fountain.com) waits for the System Admin.\n');
await mongoose.disconnect();
