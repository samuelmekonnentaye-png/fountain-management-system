import mongoose from 'mongoose';
import { endsAt } from '../services/meetingLogic.js';

// A meeting between departments / people. Phase 1: the Zoom (or other) link is pasted in;
// the "audio" channel is reserved for the in-system audio room.
const inviteSchema = new mongoose.Schema(
  {
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    scope: { type: String, enum: ['all', 'heads'], default: 'all' }, // everybody of the unit, or only its heads
    includeSubunits: { type: Boolean, default: true },
  },
  { _id: false }
);

const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: ['organizer', 'department', 'user'], default: 'user' },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null }, // invited through this unit
    status: { type: String, enum: ['invited', 'accepted', 'declined', 'tentative'], default: 'invited' },
    respondedAt: { type: Date, default: null },
    attended: { type: Boolean, default: false },
  },
  { _id: false }
);

const actionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 300 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  dueDate: { type: Date, default: null },
  done: { type: Boolean, default: false },
});

const meetingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    agenda: { type: String, trim: true, maxlength: 4000, default: '' },
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    hostDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    startsAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, min: 5, max: 720, default: 60 },
    endsAt: { type: Date, required: true, index: true },
    channel: { type: String, enum: ['zoom', 'link', 'in_person', 'audio'], default: 'zoom' },
    joinUrl: { type: String, trim: true, maxlength: 500, default: '' },
    passcode: { type: String, trim: true, maxlength: 40, default: '' },
    meetingNumber: { type: String, trim: true, maxlength: 40, default: '' },
    location: { type: String, trim: true, maxlength: 200, default: '' },
    invites: { type: [inviteSchema], default: [] },
    invitedUsers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    participants: { type: [participantSchema], default: [] },
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled', index: true },
    cancelReason: { type: String, trim: true, maxlength: 500, default: '' },
    minutes: { type: String, trim: true, maxlength: 20000, default: '' },
    minutesUpdatedAt: { type: Date },
    actions: { type: [actionSchema], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true }
);

meetingSchema.index({ 'participants.user': 1, startsAt: -1 });

meetingSchema.pre('validate', function () {
  if (this.startsAt) this.endsAt = endsAt(this.startsAt, this.durationMinutes || 60);
});

export default mongoose.model('Meeting', meetingSchema);
