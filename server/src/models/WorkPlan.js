import mongoose from 'mongoose';
import { calcScores, computeAchievement } from '../services/performance.js';
import { isEvalEditable, isPlanEditable } from '../services/workflow.js';

export const TASK_STATUS = ['pending', 'in_progress', 'completed', 'not_completed', 'cancelled'];
export const PHASE_STATUS = ['draft', 'submitted', 'approved', 'returned', 'rejected'];
export const EVAL_STATUS = ['not_started', ...PHASE_STATUS];

// Planned at the start of the period (title, KPI, target, unit, weight, dates),
// evaluated at the end (status, actual, result, shortfall reason).
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  kpi: { type: String, trim: true, maxlength: 300, default: '' },
  target: { type: Number, min: 0, default: 1 },
  unit: { type: String, trim: true, maxlength: 40, default: 'tasks' },
  weight: { type: Number, min: 0, max: 100, default: 0 },
  startDate: { type: Date, default: null },
  dueDate: { type: Date, default: null },
  status: { type: String, enum: TASK_STATUS, default: 'pending' },
  actual: { type: Number, min: 0, default: 0 },
  achievement: { type: Number, min: 0, max: 100, default: 0 }, // calculated, never typed in
  actualResult: { type: String, trim: true, maxlength: 2000, default: '' },
  shortfallReason: { type: String, trim: true, maxlength: 2000, default: '' },
});

const historySchema = new mongoose.Schema({
  action: { type: String, required: true }, // created | submitted | approved | returned | rejected | forwarded | reopened
  phase: { type: String, enum: ['plan', 'evaluation'] },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  comment: { type: String, trim: true, maxlength: 2000, default: '' },
  at: { type: Date, default: Date.now },
});

const workPlanSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
    period: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportingPeriod', required: true, index: true },
    title: { type: String, trim: true, maxlength: 200, default: '' },
    objectives: { type: String, trim: true, maxlength: 2000, default: '' },
    tasks: { type: [taskSchema], default: [] },
    // The planning phase and the evaluation phase are reviewed separately.
    planStatus: { type: String, enum: PHASE_STATUS, default: 'draft' },
    evalStatus: { type: String, enum: EVAL_STATUS, default: 'not_started' },
    planSubmittedAt: Date,
    evalSubmittedAt: Date,
    scoreByCount: { type: Number, default: 0 },
    scoreWeighted: { type: Number, default: 0 },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true }
);

workPlanSchema.index({ owner: 1, period: 1 }, { unique: true });

workPlanSchema.methods.recalc = function () {
  this.tasks.forEach((t) => {
    t.achievement = computeAchievement(t);
  });
  const s = calcScores(this.tasks);
  this.scoreByCount = s.scoreByCount;
  this.scoreWeighted = s.scoreWeighted;
};
workPlanSchema.methods.planEditable = function () {
  return isPlanEditable(this.planStatus, this.evalStatus);
};
workPlanSchema.methods.evalEditable = function () {
  return isEvalEditable(this.evalStatus);
};

export default mongoose.model('WorkPlan', workPlanSchema);
