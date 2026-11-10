import WorkPlan from '../models/WorkPlan.js';
import ReportingPeriod from '../models/ReportingPeriod.js';
import { hasEvaluation } from './performance.js';
import { analyticsScope } from './access.js';
import { bad, idOf, isObjectId, toInt } from '../utils/http.js';

const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : 0);

export const yearRange = (y) => ({ start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 11, 31, 23, 59, 59)) });
export const periodsOfYear = (y) => {
  const { start, end } = yearRange(y);
  return ReportingPeriod.find({ startDate: { $lte: end }, endDate: { $gte: start } }).sort({ startDate: 1 }).lean();
};

// Aggregated performance numbers (scores only, never report contents).
export async function teamPerformance(user, { year, periodId, departmentId }) {
  const scope = await analyticsScope(user);
  const y = toInt(year, new Date().getFullYear(), 2000, 2100);
  if (periodId && !isObjectId(periodId)) throw bad('Invalid period');
  if (departmentId && !isObjectId(departmentId)) throw bad('Invalid department');

  const periods = await periodsOfYear(y);
  const filter = { period: { $in: periods.map((p) => p._id) } };
  if (!scope.all) filter.owner = { $in: scope.ownerIds };

  const plansYear = (
    await WorkPlan.find(filter).populate('owner', 'fullName jobTitle').populate('department', 'name nameAm').lean()
  )
    .filter(hasEvaluation)
    .filter((p) => !departmentId || idOf(p.department) === departmentId);
  const selected = periodId ? plansYear.filter((p) => idOf(p.period) === periodId) : plansYear;

  const byEmp = new Map();
  for (const p of selected) {
    if (!p.owner) continue;
    const key = idOf(p.owner);
    if (!byEmp.has(key)) {
      byEmp.set(key, {
        id: key, name: p.owner.fullName, jobTitle: p.owner.jobTitle || '',
        departmentId: p.department ? idOf(p.department) : null,
        departmentName: p.department?.name || 'Unassigned',
        departmentNameAm: p.department?.nameAm || '',
        weighted: [], count: [],
      });
    }
    const e = byEmp.get(key);
    e.weighted.push(p.scoreWeighted);
    e.count.push(p.scoreByCount);
  }
  const employees = [...byEmp.values()]
    .map((e) => ({
      id: e.id, name: e.name, jobTitle: e.jobTitle, departmentId: e.departmentId,
      departmentName: e.departmentName, departmentNameAm: e.departmentNameAm,
      plans: e.weighted.length, avgWeighted: avg(e.weighted), avgCount: avg(e.count),
    }))
    .sort((a, b) => b.avgWeighted - a.avgWeighted);

  const byDept = new Map();
  for (const e of employees) {
    const key = e.departmentId || 'none';
    if (!byDept.has(key)) byDept.set(key, { id: e.departmentId, name: e.departmentName, nameAm: e.departmentNameAm, scores: [] });
    byDept.get(key).scores.push(e.avgWeighted);
  }
  const departments = [...byDept.values()]
    .map((d) => ({ id: d.id, name: d.name, nameAm: d.nameAm, employees: d.scores.length, average: avg(d.scores) }))
    .sort((a, b) => b.average - a.average);

  const periodTrend = periods.map((per) => {
    const ps = plansYear.filter((p) => idOf(p.period) === idOf(per._id));
    return { periodId: idOf(per._id), name: per.name, average: ps.length ? avg(ps.map((p) => p.scoreWeighted)) : null, plans: ps.length };
  });

  const band = (lo, hi) => employees.filter((e) => e.avgWeighted >= lo && e.avgWeighted < hi).length;
  return {
    year: y,
    periodId: periodId || null,
    departmentId: departmentId || null,
    periods: periods.map((p) => ({ _id: idOf(p._id), name: p.name })),
    average: avg(employees.map((e) => e.avgWeighted)),
    employeeCount: employees.length,
    employees,
    departments,
    periodTrend,
    distribution: [
      { band: '0-49', count: band(0, 50) },
      { band: '50-69', count: band(50, 70) },
      { band: '70-84', count: band(70, 85) },
      { band: '85-100', count: band(85, 101) },
    ],
  };
}
