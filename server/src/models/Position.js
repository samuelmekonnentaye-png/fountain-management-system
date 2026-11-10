import mongoose from 'mongoose';

// One box of the organisation chart. "parent" is the position this one reports to.
const positionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    nameAm: { type: String, trim: true, maxlength: 120, default: '' },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', default: null, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
    // Can the holder approve reports of the people below? (Advisors, secretaries, experts ... cannot.)
    approver: { type: Boolean, default: true },
    // Reports from below stop here (the General Manager). Positions above it are not part of the chain.
    chainEnd: { type: Boolean, default: false },
    // How many people hold this position in the chart (informational, e.g. "Supervisors (5)").
    seats: { type: Number, min: 1, default: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Position', positionSchema);
