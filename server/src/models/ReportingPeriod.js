import mongoose from 'mongoose';

// A window in which employees plan and evaluate (a week, a month, or any custom range).
// Custom periods can carry any name, e.g. an Ethiopian month such as "ጥቅምት 2019".
const periodSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ['weekly', 'monthly', 'custom'], required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

periodSchema.index({ startDate: -1 });

export default mongoose.model('ReportingPeriod', periodSchema);
