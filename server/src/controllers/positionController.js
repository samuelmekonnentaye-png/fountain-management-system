import Position from '../models/Position.js';
import Department from '../models/Department.js';
import User from '../models/User.js';
import { asyncHandler, HttpError, bad, idOf, isObjectId, notFound } from '../utils/http.js';
import { audit } from '../services/notify.js';
import { buildIndex, bossOf, needsSuperior } from '../services/orgChain.js';
import { importOrg } from '../services/orgImport.js';

// the whole chart, with who holds each position (for the chart page and the pickers)
export const listPositions = asyncHandler(async (_req, res) => {
  const [items, holders] = await Promise.all([
    Position.find().populate('department', 'name nameAm').sort({ name: 1 }).lean(),
    User.find({ position: { $ne: null }, isActive: true }).select('fullName position').lean(),
  ]);
  const byPos = new Map();
  for (const u of holders) {
    const k = idOf(u.position);
    if (!byPos.has(k)) byPos.set(k, []);
    byPos.get(k).push({ _id: u._id, fullName: u.fullName });
  }
  res.json({ items: items.map((p) => ({ ...p, holders: byPos.get(idOf(p._id)) || [] })) });
});

// minimal list for the registration form (before sign-in)
export const listPublic = asyncHandler(async (_req, res) => {
  const items = await Position.find({ isActive: true }).select('name nameAm department').sort({ name: 1 }).lean();
  res.json({ items });
});

async function checkParent(parentId, selfId) {
  if (!parentId) return;
  if (selfId && String(parentId) === String(selfId)) throw bad('A position cannot report to itself');
  let cur = await Position.findById(parentId).select('parent');
  if (!cur) throw bad('Parent position not found');
  for (let i = 0; cur && i < 50; i += 1) {
    if (selfId && String(cur._id) === String(selfId)) throw bad('This would create a loop in the chart');
    cur = cur.parent ? await Position.findById(cur.parent).select('parent') : null;
  }
}
async function checkDepartment(id) {
  if (id && !(await Department.exists({ _id: id }))) throw bad('Department not found');
}

export const createPosition = asyncHandler(async (req, res) => {
  const b = req.body;
  if (await Position.exists({ name: b.name })) throw new HttpError(409, 'A position with this name already exists');
  await checkParent(b.parentId);
  await checkDepartment(b.departmentId);
  const doc = await Position.create({
    name: b.name, nameAm: b.nameAm || '', parent: b.parentId || null, department: b.departmentId || undefined,
    approver: b.approver, chainEnd: b.chainEnd, seats: b.seats,
  });
  await audit(req.user._id, 'position.create', 'Position', doc._id, { name: b.name });
  res.status(201).json({ item: doc });
});

export const updatePosition = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Position not found');
  const doc = await Position.findById(req.params.id);
  if (!doc) throw notFound('Position not found');
  const b = req.body;
  if (b.name !== undefined) {
    if (await Position.exists({ name: b.name, _id: { $ne: doc._id } })) throw new HttpError(409, 'A position with this name already exists');
    doc.name = b.name;
  }
  if (b.nameAm !== undefined) doc.nameAm = b.nameAm;
  if (b.parentId !== undefined) {
    await checkParent(b.parentId, doc._id);
    doc.parent = b.parentId || null;
  }
  if (b.departmentId !== undefined) {
    await checkDepartment(b.departmentId);
    doc.department = b.departmentId || undefined;
  }
  for (const k of ['approver', 'chainEnd', 'seats', 'isActive']) if (b[k] !== undefined) doc[k] = b[k];
  await doc.save();
  await audit(req.user._id, 'position.update', 'Position', doc._id, { name: doc.name });
  res.json({ item: doc });
});

export const deletePosition = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Position not found');
  const doc = await Position.findById(req.params.id);
  if (!doc) throw notFound('Position not found');
  if (await User.exists({ position: doc._id })) throw new HttpError(409, 'People hold this position. Move them to another position first.');
  if (await Position.exists({ parent: doc._id })) throw new HttpError(409, 'Other positions report to this one. Move or delete them first.');
  await doc.deleteOne();
  await audit(req.user._id, 'position.delete', 'Position', doc._id, { name: doc.name });
  res.json({ ok: true });
});

export const importCompany = asyncHandler(async (req, res) => {
  const result = await importOrg();
  await audit(req.user._id, 'position.import', 'Position', undefined, result);
  res.json(result);
});

// For every active person: who is the superior, and is it certain?
export const checkSuperiors = asyncHandler(async (_req, res) => {
  const [users, positions] = await Promise.all([
    User.find({ approvalStatus: { $nin: ['pending', 'rejected'] } }).select('fullName manager position department isActive roles').lean(),
    Position.find({}).select('name nameAm parent approver chainEnd').lean(),
  ]);
  const idx = buildIndex(users, positions);
  const rows = users
    .filter((u) => u.isActive !== false)
    .map((u) => {
      const r = bossOf(u, idx);
      return {
        userId: u._id,
        name: u.fullName,
        position: u.position ? idx.positionsById.get(idOf(u.position))?.name || '' : '',
        superior: r.boss?.fullName || null,
        status: r.status, // manager | position | top | ambiguous | unassigned
        ambiguousPosition: r.status === 'ambiguous' ? r.position?.name : undefined,
        needsAttention: needsSuperior(u, idx),
      };
    })
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.name.localeCompare(b.name));
  res.json({ items: rows, attention: rows.filter((r) => r.needsAttention).length });
});
