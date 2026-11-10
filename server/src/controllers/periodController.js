import ReportingPeriod from '../models/ReportingPeriod.js';
import WorkPlan from '../models/WorkPlan.js';
import { asyncHandler, HttpError, isObjectId, notFound, toInt } from '../utils/http.js';
import { audit } from '../services/notify.js';
import { periodsOfYear } from '../services/analytics.js';

export const listPeriods = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status === 'open' || req.query.status === 'closed') filter.status = req.query.status;
  let items;
  if (req.query.year) {
    items = await periodsOfYear(toInt(req.query.year, new Date().getFullYear(), 2000, 2100));
    if (filter.status) items = items.filter((p) => p.status === filter.status);
    items.reverse();
  } else {
    items = await ReportingPeriod.find(filter).sort({ startDate: -1 }).limit(200).lean();
  }
  res.json({ items });
});

export const createPeriod = asyncHandler(async (req, res) => {
  const { name, type, startDate } = req.body;
  // the period lasts until the very end of its last day
  const endDate = new Date(req.body.endDate);
  endDate.setUTCHours(23, 59, 59, 999);
  const overlap = await ReportingPeriod.exists({ type, startDate: { $lte: endDate }, endDate: { $gte: startDate } });
  if (overlap) throw new HttpError(409, 'A period of the same type already covers some of these dates');
  const period = await ReportingPeriod.create({ name, type, startDate, endDate, createdBy: req.user._id });
  await audit(req.user._id, 'period.create', 'ReportingPeriod', period._id, { name, type });
  res.status(201).json({ item: period });
});

export const updatePeriod = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Period not found');
  const period = await ReportingPeriod.findById(req.params.id);
  if (!period) throw notFound('Period not found');
  if (req.body.name !== undefined) period.name = req.body.name;
  if (req.body.status !== undefined) period.status = req.body.status;
  await period.save();
  await audit(req.user._id, 'period.update', 'ReportingPeriod', period._id, req.body);
  res.json({ item: period });
});

export const deletePeriod = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Period not found');
  const period = await ReportingPeriod.findById(req.params.id);
  if (!period) throw notFound('Period not found');
  if (await WorkPlan.exists({ period: period._id })) {
    throw new HttpError(409, 'Employees already have plans in this period. Close it instead of deleting it.');
  }
  await period.deleteOne();
  await audit(req.user._id, 'period.delete', 'ReportingPeriod', period._id, { name: period.name });
  res.json({ ok: true });
});
