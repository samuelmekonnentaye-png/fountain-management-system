import AuditLog from '../models/AuditLog.js';
import { asyncHandler, cleanStr, escapeRegex, paginate } from '../utils/http.js';

export const listAudit = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  const action = cleanStr(String(req.query.action || ''), 50);
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actor', 'fullName roles').lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});
