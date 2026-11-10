import mongoose from 'mongoose';

export const REPORT_KIND = ['plan', 'evaluation'];
export const REPORT_STATUS = ['submitted', 'in_review', 'approved', 'returned', 'rejected'];

const recipientSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['to', 'cc'], required: true }, // Send To / CC only (no BCC)
    readAt: { type: Date, default: null },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema({
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  decision: { type: String, enum: ['approved', 'returned', 'rejected', 'forwarded'], required: true },
  comment: { type: String, trim: true, maxlength: 2000, default: '' },
  at: { type: Date, default: Date.now },
});

const reportSchema = new mongoose.Schema(
  {
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkPlan', required: true, index: true },
    kind: { type: String, enum: REPORT_KIND, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workflow: { type: String, enum: ['direct', 'hierarchical'], default: 'direct' },
    recipients: {
      type: [recipientSchema],
      validate: [(v) => v.some((r) => r.type === 'to'), 'At least one "Send To" recipient is required'],
    },
    // hierarchical workflow only
    approvalChain: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    approvalIndex: { type: Number, default: 0 },
    currentApproverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    subject: { type: String, trim: true, maxlength: 200, default: '' },
    message: { type: String, trim: true, maxlength: 3000, default: '' },
    // Frozen copy of the plan at send time: later edits never change a sent report.
    snapshot: {
      ownerId: mongoose.Schema.Types.ObjectId,
      ownerName: String,
      ownerJobTitle: String,
      departmentName: String,
      departmentNameAm: String,
      periodId: mongoose.Schema.Types.ObjectId,
      periodName: String,
      periodStart: Date,
      periodEnd: Date,
      title: String,
      objectives: String,
      tasks: [mongoose.Schema.Types.Mixed],
      scoreByCount: Number,
      scoreWeighted: Number,
      totalTasks: Number,
      completedTasks: Number,
    },
    status: { type: String, enum: REPORT_STATUS, default: 'submitted', index: true },
    reviews: { type: [reviewSchema], default: [] },
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
  },
  { timestamps: true, optimisticConcurrency: true }
);

reportSchema.index({ 'recipients.user': 1, createdAt: -1 });

export default mongoose.model('Report', reportSchema);
