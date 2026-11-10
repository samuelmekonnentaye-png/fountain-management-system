import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    nameAm: { type: String, trim: true, maxlength: 100, default: '' },
    code: { type: String, trim: true, maxlength: 20, default: '' },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Department', departmentSchema);
