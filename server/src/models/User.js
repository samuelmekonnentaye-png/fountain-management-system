import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_LIST, ROLES, primaryRole } from '../config/roles.js';

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 150 },
    password: { type: String, required: true, select: false },
    employeeId: { type: String, trim: true, maxlength: 40, set: (v) => v || undefined },
    // A person can hold several roles (e.g. Department Head and Manager).
    roles: {
      type: [{ type: String, enum: ROLE_LIST }],
      default: [ROLES.EMPLOYEE],
      validate: [(v) => v.length > 0, 'A user needs at least one role'],
    },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
    // The box of the organisation chart this person holds; the superior is derived from it.
    position: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', index: true },
    // Optional: a manager chosen by hand. It wins over the chart (needed when several people hold the position above).
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    jobTitle: { type: String, trim: true, maxlength: 100, default: '' },
    preferredLanguage: { type: String, enum: ['en', 'am'], default: 'am' },
    isActive: { type: Boolean, default: true },
    // Self-registered accounts wait for the System Admin: pending -> approved | rejected.
    // (Accounts created before this field existed count as approved.)
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
    requestedRoles: { type: [{ type: String, enum: ROLE_LIST }], default: [] },
    rejectionReason: { type: String, trim: true, maxlength: 500, default: '' },
    decidedAt: { type: Date },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mustChangePassword: { type: Boolean, default: false },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ employeeId: 1 }, { unique: true, partialFilterExpression: { employeeId: { $type: 'string' } } });
userSchema.index({ roles: 1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(String(candidate ?? ''), this.password);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.__v;
    ret.primaryRole = primaryRole(ret.roles);
    return ret;
  },
});

export default mongoose.model('User', userSchema);
