import Department from '../models/Department.js';
import User from '../models/User.js';
import { asyncHandler, HttpError, bad, isObjectId, notFound } from '../utils/http.js';
import { audit } from '../services/notify.js';

export const listDepartments = asyncHandler(async (_req, res) => {
  const [items, counts] = await Promise.all([
    Department.find().sort({ name: 1 }).populate('parent', 'name nameAm').lean(),
    User.aggregate([{ $match: { department: { $ne: null } } }, { $group: { _id: '$department', n: { $sum: 1 } } }]),
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ items: items.map((d) => ({ ...d, memberCount: map.get(String(d._id)) || 0 })) });
});

async function checkParent(parentId, selfId) {
  if (!parentId) return;
  if (selfId && String(parentId) === String(selfId)) throw bad('A department cannot be its own parent');
  if (!(await Department.exists({ _id: parentId }))) throw bad('Parent department not found');
  // no loops: walk up from the parent
  let cur = await Department.findById(parentId).select('parent');
  for (let i = 0; cur && i < 20; i += 1) {
    if (selfId && String(cur._id) === String(selfId)) throw bad('This would create a loop in the department structure');
    cur = cur.parent ? await Department.findById(cur.parent).select('parent') : null;
  }
}

export const createDepartment = asyncHandler(async (req, res) => {
  const { name, nameAm, code, parentId } = req.body;
  if (await Department.exists({ name })) throw new HttpError(409, 'A department with this name already exists');
  await checkParent(parentId);
  const dept = await Department.create({ name, nameAm: nameAm || '', code: code || '', parent: parentId || null });
  await audit(req.user._id, 'department.create', 'Department', dept._id, { name });
  res.status(201).json({ item: dept });
});

export const updateDepartment = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Department not found');
  const dept = await Department.findById(req.params.id);
  if (!dept) throw notFound('Department not found');
  const { name, nameAm, code, parentId, isActive } = req.body;
  if (name !== undefined) {
    if (await Department.exists({ name, _id: { $ne: dept._id } })) throw new HttpError(409, 'A department with this name already exists');
    dept.name = name;
  }
  if (nameAm !== undefined) dept.nameAm = nameAm;
  if (code !== undefined) dept.code = code;
  if (parentId !== undefined) {
    await checkParent(parentId, dept._id);
    dept.parent = parentId || null;
  }
  if (isActive !== undefined) dept.isActive = isActive;
  await dept.save();
  await audit(req.user._id, 'department.update', 'Department', dept._id, { name: dept.name });
  res.json({ item: dept });
});

export const deleteDepartment = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Department not found');
  const dept = await Department.findById(req.params.id);
  if (!dept) throw notFound('Department not found');
  if (await User.exists({ department: dept._id })) {
    throw new HttpError(409, 'This department still has users. Move them to another department first.');
  }
  if (await Department.exists({ parent: dept._id })) {
    throw new HttpError(409, 'This department has sub-departments. Move or delete them first.');
  }
  await dept.deleteOne();
  await audit(req.user._id, 'department.delete', 'Department', dept._id, { name: dept.name });
  res.json({ ok: true });
});
