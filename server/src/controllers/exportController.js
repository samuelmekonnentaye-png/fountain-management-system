import ExcelJS from 'exceljs';
import WorkPlan from '../models/WorkPlan.js';
import { env } from '../config/env.js';
import { asyncHandler, toInt } from '../utils/http.js';
import { csvRow } from '../utils/text.js';
import { periodsOfYear, teamPerformance } from '../services/analytics.js';
import { loadReportForUser } from '../services/reportService.js';

const L = {
  en: {
    period: 'Period', plan: 'Plan', tasks: 'Tasks', done: 'Completed', byCount: 'Score by count %', weighted: 'Weighted score %',
    planStatus: 'Plan status', evalStatus: 'Evaluation status', task: 'Task', kpi: 'KPI', target: 'Target', unit: 'Unit', weight: 'Weight %',
    due: 'Due date', status: 'Status', ach: 'Achievement %', actual: 'Actual', result: 'Result achieved', why: 'Why the goal was not reached',
    summary: 'Summary', rank: 'Rank', name: 'Employee', job: 'Job title', dept: 'Department', plans: 'Plans', employees: 'Employees',
    avg: 'Average %', departments: 'Departments', trend: 'Trend by period', owner: 'Employee', sender: 'Sent by', to: 'Send To', cc: 'CC',
    yearly: 'Annual work plan summary', perf: 'Performance report', rep: 'Work plan report', kind: 'Report type', workflow: 'Workflow',
    s: { pending: 'Pending', in_progress: 'In progress', completed: 'Completed', not_completed: 'Not completed', cancelled: 'Cancelled',
      draft: 'Draft', submitted: 'Submitted', in_review: 'In review', approved: 'Approved', returned: 'Returned', rejected: 'Rejected',
      not_started: 'Not started', plan: 'Work plan', evaluation: 'Monthly evaluation', direct: 'Direct', hierarchical: 'Hierarchical' },
  },
  am: {
    period: 'ወቅት', plan: 'ዕቅድ', tasks: 'ተግባራት', done: 'የተጠናቀቁ', byCount: 'በብዛት ውጤት %', weighted: 'በክብደት ውጤት %',
    planStatus: 'የዕቅድ ሁኔታ', evalStatus: 'የግምገማ ሁኔታ', task: 'ተግባር', kpi: 'መለኪያ (KPI)', target: 'ግብ', unit: 'መለኪያ ክፍል', weight: 'ክብደት %',
    due: 'የሚጠናቀቅበት ቀን', status: 'ሁኔታ', ach: 'የተገኘ ውጤት %', actual: 'የተሠራው', result: 'የተገኘ ውጤት', why: 'ግቡ ያልተሳካበት ምክንያት',
    summary: 'ማጠቃለያ', rank: 'ደረጃ', name: 'ሠራተኛ', job: 'የሥራ መደብ', dept: 'ክፍል', plans: 'ዕቅዶች', employees: 'ሠራተኞች',
    avg: 'አማካይ %', departments: 'ክፍሎች', trend: 'በወቅት አዝማሚያ', owner: 'ሠራተኛ', sender: 'የላከው', to: 'ለ (Send To)', cc: 'CC',
    yearly: 'ዓመታዊ የሥራ ዕቅድ ማጠቃለያ', perf: 'የሥራ አፈጻጸም ሪፖርት', rep: 'የሥራ ዕቅድ ሪፖርት', kind: 'የሪፖርት ዓይነት', workflow: 'የአሠራር ዓይነት',
    s: { pending: 'ያልተጀመረ', in_progress: 'በሂደት ላይ', completed: 'የተጠናቀቀ', not_completed: 'ያልተጠናቀቀ', cancelled: 'የተሰረዘ',
      draft: 'ረቂቅ', submitted: 'የተላከ', in_review: 'በግምገማ ላይ', approved: 'የጸደቀ', returned: 'የተመለሰ', rejected: 'ውድቅ የተደረገ',
      not_started: 'ያልተጀመረ', plan: 'የሥራ ዕቅድ', evaluation: 'ወርሃዊ ግምገማ', direct: 'ቀጥታ', hierarchical: 'በአለቃ ሰንሰለት' },
  },
};
const pick = (req) => {
  const lang = req.query.lang === 'am' ? 'am' : 'en';
  return { lang, l: L[lang], company: env.company[lang] };
};

const BLUE = 'FF0B4FD6';
function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 22;
}
function titleBlock(ws, company, title, cols) {
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = company;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: BLUE } };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = title;
  ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.addRow([]);
}
const widths = (ws, ws_) => ws_.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
const wrap = (ws) => ws.eachRow((r) => r.eachCell((c) => { c.alignment = { ...(c.alignment || {}), wrapText: true, vertical: 'top' }; }));
async function send(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const exportMyPlans = asyncHandler(async (req, res) => {
  const { l, company } = pick(req);
  const year = toInt(req.query.year, new Date().getFullYear(), 2000, 2100);
  const periods = await periodsOfYear(year);
  const plans = await WorkPlan.find({ owner: req.user._id, period: { $in: periods.map((p) => p._id) } }).lean();
  const pMap = new Map(periods.map((p) => [String(p._id), p]));
  plans.sort((a, b) => pMap.get(String(a.period)).startDate - pMap.get(String(b.period)).startDate);
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet(l.summary);
  titleBlock(ws, company, `${l.yearly} ${year} – ${req.user.fullName}`, 8);
  styleHeader(ws.addRow([l.period, l.plan, l.tasks, l.done, l.byCount, l.weighted, l.planStatus, l.evalStatus]));
  plans.forEach((p) =>
    ws.addRow([pMap.get(String(p.period)).name, p.title, p.tasks.length, p.tasks.filter((t) => t.status === 'completed').length,
      p.scoreByCount, p.scoreWeighted, l.s[p.planStatus], l.s[p.evalStatus]])
  );
  widths(ws, [24, 32, 10, 12, 18, 18, 18, 20]);

  const wt = wb.addWorksheet(l.tasks);
  titleBlock(wt, company, `${l.tasks} ${year} – ${req.user.fullName}`, 11);
  styleHeader(wt.addRow([l.period, l.task, l.kpi, l.target, l.unit, l.weight, l.due, l.status, l.actual, l.ach, l.why]));
  plans.forEach((p) =>
    p.tasks.forEach((t) =>
      wt.addRow([pMap.get(String(p.period)).name, t.title, t.kpi, t.target, t.unit, t.weight, fmtDate(t.dueDate), l.s[t.status], t.actual, t.achievement, t.shortfallReason])
    )
  );
  widths(wt, [20, 34, 24, 10, 12, 10, 14, 16, 10, 14, 36]);
  wrap(wt);
  await send(res, wb, `work-plans-${year}.xlsx`);
});

export const exportPerformance = asyncHandler(async (req, res) => {
  const { l, company } = pick(req);
  const data = await teamPerformance(req.user, { year: req.query.year, periodId: req.query.period, departmentId: req.query.department });
  const periodName = data.periods.find((p) => p._id === data.periodId)?.name || String(data.year);
  const am = req.query.lang === 'am';
  const wb = new ExcelJS.Workbook();

  const we = wb.addWorksheet(l.employees);
  titleBlock(we, company, `${l.perf} – ${periodName}`, 7);
  styleHeader(we.addRow([l.rank, l.name, l.job, l.dept, l.plans, l.weighted, l.byCount]));
  data.employees.forEach((e, i) => we.addRow([i + 1, e.name, e.jobTitle, am && e.departmentNameAm ? e.departmentNameAm : e.departmentName, e.plans, e.avgWeighted, e.avgCount]));
  widths(we, [8, 30, 26, 28, 10, 18, 18]);

  const wd = wb.addWorksheet(l.departments);
  titleBlock(wd, company, `${l.departments} – ${periodName}`, 3);
  styleHeader(wd.addRow([l.dept, l.employees, l.avg]));
  data.departments.forEach((d) => wd.addRow([am && d.nameAm ? d.nameAm : d.name, d.employees, d.average]));
  widths(wd, [30, 12, 12]);

  const wm = wb.addWorksheet(l.trend);
  titleBlock(wm, company, `${l.trend} – ${data.year}`, 3);
  styleHeader(wm.addRow([l.period, l.plans, l.avg]));
  data.periodTrend.forEach((m) => wm.addRow([m.name, m.plans, m.average ?? '']));
  widths(wm, [26, 10, 12]);
  await send(res, wb, `performance-${data.year}.xlsx`);
});

// CSV (opens in Excel too); cells are protected against formula injection.
export const exportPerformanceCsv = asyncHandler(async (req, res) => {
  const { l } = pick(req);
  const data = await teamPerformance(req.user, { year: req.query.year, periodId: req.query.period, departmentId: req.query.department });
  const lines = [csvRow([l.rank, l.name, l.job, l.dept, l.plans, l.weighted, l.byCount])];
  data.employees.forEach((e, i) => lines.push(csvRow([i + 1, e.name, e.jobTitle, e.departmentName, e.plans, e.avgWeighted, e.avgCount])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="performance-${data.year}.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

export const exportReport = asyncHandler(async (req, res) => {
  const { l, company } = pick(req);
  const { report } = await loadReportForUser(req.params.id, req.user);
  const s = report.snapshot;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(l.rep);
  titleBlock(ws, company, `${l.rep}: ${s.ownerName} – ${s.periodName}`, 8);

  const names = (type) => report.recipients.filter((r) => r.type === type).map((r) => r.user.fullName).join(', ');
  [
    [l.owner, s.ownerName], [l.dept, s.departmentName], [l.kind, l.s[report.kind]], [l.workflow, l.s[report.workflow]],
    [l.sender, report.sender.fullName], [l.to, names('to')], [l.cc, names('cc')], [l.status, l.s[report.status]],
    [l.byCount, s.scoreByCount], [l.weighted, s.scoreWeighted],
  ].forEach(([k, v]) => { const r = ws.addRow([k, v]); r.getCell(1).font = { bold: true }; });
  ws.addRow([]);
  styleHeader(ws.addRow([l.task, l.kpi, l.target, l.unit, l.weight, l.status, l.actual, l.ach, l.result, l.why]));
  s.tasks.forEach((t) => ws.addRow([t.title, t.kpi, t.target, t.unit, t.weight, l.s[t.status], t.actual, t.achievement, t.actualResult, t.shortfallReason]));
  widths(ws, [34, 24, 10, 12, 10, 16, 10, 14, 36, 36]);
  wrap(ws);
  await send(res, wb, `report-${String(report._id).slice(-6)}.xlsx`);
});
