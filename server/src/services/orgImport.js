import Department from '../models/Department.js';
import Position from '../models/Position.js';
import { ORG_POSITIONS, ORG_UNITS } from './orgData.js';

// Loads the company's organisation chart (units + positions). Safe to run again: anything that already
// exists (same name) is left as it is, so changes made by the administrator are never overwritten.
export async function importOrg() {
  const result = { unitsCreated: 0, positionsCreated: 0, unitsTotal: ORG_UNITS.length, positionsTotal: ORG_POSITIONS.length };

  const units = new Map();
  for (const u of ORG_UNITS) {
    let d = await Department.findOne({ name: u.name });
    if (!d) {
      d = await Department.create({ name: u.name, nameAm: u.nameAm });
      result.unitsCreated += 1;
    } else if (!d.nameAm && u.nameAm) {
      d.nameAm = u.nameAm;
      await d.save();
    }
    units.set(u.name, d);
  }
  for (const u of ORG_UNITS) {
    const d = units.get(u.name);
    if (u.parent && !d.parent) {
      d.parent = units.get(u.parent)._id;
      await d.save();
    }
  }

  const positions = new Map();
  for (const p of ORG_POSITIONS) {
    let doc = await Position.findOne({ name: p.name });
    if (!doc) {
      doc = await Position.create({
        name: p.name,
        nameAm: p.nameAm,
        parent: p.parent ? positions.get(p.parent)?._id || null : null,
        department: units.get(p.unit)._id,
        approver: p.approver,
        chainEnd: p.chainEnd,
        seats: p.seats,
      });
      result.positionsCreated += 1;
    }
    positions.set(p.name, doc);
  }
  return result;
}
