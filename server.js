require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

const app = express();
// Behind Render's proxy, trust it once so req.ip is the real client address
// (needed by the login rate limiter below).
app.set('trust proxy', 1);
// Restoring a Backup file posts every record at once, which can be well over
// Express's default 100kb body limit.
app.use(express.json({ limit: '25mb' }));
app.use(express.static('public'));
// New uploads now go straight to Cloudinary (see storage config below) and
// are referenced by their full https URL, not a local path — this line only
// still serves any files that were uploaded to local disk before that
// switch. Safe to remove once no record/signature still points at
// '/uploads/...' (check by searching your database for that prefix).
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// ===== Authentication (lightweight signed tokens, no extra dependency) =====
// IMPORTANT: set APP_SECRET in your .env to a long random string in production.
// Left at the fallback, anyone who reads this source could forge tokens.
const APP_SECRET = process.env.APP_SECRET || 'CHANGE_ME_APP_SECRET_KEEP_PRIVATE';
if (APP_SECRET === 'CHANGE_ME_APP_SECRET_KEEP_PRIVATE') {
    console.warn('⚠️  APP_SECRET is not set in .env — using an insecure default. Set APP_SECRET to a long random string before going live.');
}
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // password-reset code valid for 15 minutes

function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}
function verifyToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
    // Constant-time comparison to avoid timing attacks on the signature check.
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
        return null;
    }
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.exp && Date.now() > payload.exp) return null;
        return payload;
    } catch (err) {
        return null;
    }
}

// Prints an error as plain readable text lines (label, message, stack) —
// not the raw error object. Some terminals (Windows PowerShell / the VS
// Code integrated terminal have both shown this) render a bare
// console.error(label, errorObject) as just "[object Object]" with no
// usable detail. Explicit strings can't be mangled that way.
// Escapes text before it is placed inside an HTML e-mail.
function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// One bad request must never be able to take the whole server down.
process.on('unhandledRejection', (err) => { console.error('Unhandled promise rejection:', err && err.message ? err.message : err); });

function logError(label, err) {
    console.error(label);
    console.error('  message:', err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
}

// Every route below that reads/writes real data now checks this server-side —
// previously only the browser UI hid buttons for non-admins, which anyone
// could bypass entirely by calling the API directly.
function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload || !payload.id) {
        return res.status(401).json({ error: 'እባክዎ እንደገና ይግቡ (session ጊዜው አልቆ ወይም ልክ ያልሆነ ነው)።' });
    }
    // The signed token only proves who logged in earlier. The CURRENT account
    // is re-read here, so a deleted/rejected user is locked out immediately and
    // a changed role (e.g. Admin -> Employee) takes effect at once instead of
    // staying valid until the token expires.
    User.findById(payload.id).then(user => {
        if (!user || user.status === 'pending' || user.status === 'rejected') {
            return res.status(401).json({ error: 'አካውንትዎ አልተገኘም ወይም አልጸደቀም፤ እባክዎ እንደገና ይግቡ።' });
        }
        req.authUser = { id: user._id.toString(), role: user.role };
        req.authUserDoc = user;
        next();
    }).catch(err => {
        logError('requireAuth error:', err);
        res.status(500).json({ error: 'የሰርቨር ስህተት' });
    });
}
function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.authUser.role !== 'Admin') {
            return res.status(403).json({ error: 'ይህን ለማድረግ የAdmin ፈቃድ ያስፈልጋል።' });
        }
        next();
    });
}

// MongoDB Local Connection (ከ .env ፋይል ወይም በቀጥታ ከሎካል ዳታቤዝ ጋር እንዲገናኝ ተደረገ)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fountain_db';
mongoose.connect(MONGO_URI)
.then(() => console.log('MongoDB Local Connected Successfully'))
.catch(err => logError('DB Connection Error:', err));

// A user's fixed set of responsibilities within the payment/contract
// workflow: 'prepare' lets them register records and sign as "ያዘጋጀው",
// 'approve' lets an Admin designate them as someone records can be SENT TO
// for approval, and sign as "ያጸደቀው". Only an Admin can grant/revoke these —
// nobody can act outside the responsibility they've been explicitly given.
const VALID_PERMISSIONS = ['prepare', 'approve'];

// User Schema with Approval Status
const userSchema = new mongoose.Schema({
    fullName: String,
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true },
    role: { type: String, default: 'Employee' },
    status: { type: String, default: 'pending' }, // pending, approved, rejected[cite: 4]
    permissions: { type: [String], default: ['prepare'] },
    // Which sections (modules) this person may open and use. A MISSING value
    // (accounts created before this feature) means "everything" so nobody is
    // locked out on upgrade; an array — even an empty one — means exactly
    // those modules. Admins always have every module.
    access: { type: [String], default: undefined },
    // "Forgot password" flow: a short-lived 6-digit code emailed to the
    // account's address. Only its hash is stored (same idea as a password),
    // and it expires after RESET_CODE_TTL_MS so an old email can't be reused.
    resetCodeHash: { type: String, default: null },
    resetAttempts: { type: Number, default: 0 },
    resetCodeExpires: { type: Date, default: null }
});
const User = mongoose.model('User', userSchema);

// Admins can always do everything; everyone else needs the specific
// responsibility an Admin assigned them.
function hasPermission(userDoc, perm) {
    if (!userDoc) return false;
    if (userDoc.role === 'Admin') return true;
    return Array.isArray(userDoc.permissions) && userDoc.permissions.includes(perm);
}
// Route guard mirroring hasPermission() above, for endpoints that need the
// full User document (the auth token only carries id/role).
function requirePermission(perm) {
    return async (req, res, next) => {
        try {
            const user = req.authUserDoc || await User.findById(req.authUser.id);
            if (!user) return res.status(401).json({ error: 'ተጠቃሚው አልተገኘም' });
            if (!hasPermission(user, perm)) {
                return res.status(403).json({ error: 'ይህን ለማድረግ ተገቢው ኃላፊነት የለዎትም' });
            }
            req.authUserDoc = user;
            next();
        } catch (err) {
            logError('Permission check error:', err);
            res.status(500).json({ error: 'የፈቃድ ማረጋገጫ አልተሳካም' });
        }
    };
}

// ===== Per-module access (which sections a user may see / use) =====
const ACCESS_MODULES = [
    'dashboard', 'payments', 'contracts', 'gallery', 'report', 'signature', 'trash',
    'fleet_vehicles', 'fleet_trips', 'fleet_maintenance', 'fleet_fuel', 'fleet_report',
    'fleet_view_all' // lets a fleet officer see fleet entries made by OTHER people
];

function effectiveAccess(userDoc) {
    if (!userDoc) return [];
    if (userDoc.role === 'Admin') return ACCESS_MODULES.slice();
    // Legacy account (no list yet): every section, but NOT other people's fleet entries.
    if (!Array.isArray(userDoc.access)) return ACCESS_MODULES.filter(k => k !== 'fleet_view_all');
    return userDoc.access.filter(k => ACCESS_MODULES.includes(k));
}
// Route guard: the caller needs at least ONE of the listed modules.
function requireModule(...mods) {
    return async (req, res, next) => {
        try {
            const user = req.authUserDoc || await User.findById(req.authUser.id);
            if (!user) return res.status(401).json({ error: 'ተጠቃሚው አልተገኘም' });
            req.authUserDoc = user;
            const have = effectiveAccess(user);
            if (!mods.some(m => have.includes(m))) {
                return res.status(403).json({ error: 'ይህን ክፍል ለመጠቀም ፈቃድ የለዎትም' });
            }
            next();
        } catch (err) {
            logError('requireModule error:', err);
            res.status(500).json({ error: 'የሰርቨር ስህተት' });
        }
    };
}
// A record is either a payment (category 'ክፍያ') or a contract (anything else).
function recordModule(category) {
    return category === 'ክፍያ' ? 'payments' : 'contracts';
}
// Which record categories this user may READ (the dashboard and the finance
// report summarise both kinds, so those modules also let them see them).
function readableCategories(userDoc) {
    const have = effectiveAccess(userDoc);
    const pay = ['payments', 'dashboard', 'report'].some(m => have.includes(m));
    const con = ['contracts', 'gallery', 'dashboard', 'report'].some(m => have.includes(m));
    return { pay, con };
}
function filterRecordsByAccess(userDoc, list, getCategory) {
    if (!userDoc || userDoc.role === 'Admin') return list;
    const { pay, con } = readableCategories(userDoc);
    return list.filter(r => (getCategory(r) === 'ክፍያ' ? pay : con));
}
// Add/edit a payment or contract: needs the matching module. For edits the
// STORED record's category decides, so the request body can't lie about it.
async function requireRecordWrite(req, res, next) {
    try {
        const user = req.authUserDoc || await User.findById(req.authUser.id);
        if (!user) return res.status(401).json({ error: 'ተጠቃሚው አልተገኘም' });
        req.authUserDoc = user;
        let category = req.body && req.body.category;
        if (req.params && req.params.id) {
            const existing = await Record.findById(req.params.id);
            if (existing) category = existing.category;
        }
        if (!effectiveAccess(user).includes(recordModule(category))) {
            return res.status(403).json({ error: 'ይህን ክፍል ለመጠቀም ፈቃድ የለዎትም' });
        }
        next();
    } catch (err) {
        logError('requireRecordWrite error:', err);
        res.status(500).json({ error: 'የሰርቨር ስህተት' });
    }
}

// A signature record can be attached to a payment/contract as "ያዘጋጀው" (prepared
// by) or "ያጸደቀው" (approved by). The signaturePassword is a SEPARATE password
// from the account login password — it must be re-entered every time the
// signature is actually placed on a document, specifically so that someone
// merely logged into the account (or who saved the signature image) can't
// silently sign things without knowing this second secret.
const signatureSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    responsibility: { type: String, required: true }, // ኃላፊነት
    signatureImage: { type: String, required: true },
    signaturePasswordHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Signature = mongoose.model('Signature', signatureSchema);

// One of these is created whenever a record is sent to someone for approval,
// or when that approval is granted — powers the in-app notification bell so
// the right person actually finds out there's something to act on.
const notificationSchema = new mongoose.Schema({
    toUserId: { type: String, required: true },
    type: { type: String, default: 'approval_request' }, // 'approval_request' | 'approved'
    module: { type: String, default: 'record' }, // 'record' | 'fleet_maintenance'
    recordId: String,
    recordName: String,
    fromUserId: String,
    fromFullName: String,
    message: String,
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

// Record Schema
const recordSchema = new mongoose.Schema({
    userId: String,
    name: String,
    itemType: String, // e.g. "የቢሮ ኪራይ" — stored separately from `name` now so
                       // reports/filters don't need to re-parse it out of the
                       // combined "Type (Description)" display string.
    description: String,
    amount: Number,
    paymentDate: String,
    startDate: String,
    dueDate: String,
    category: String,
    file: String,
    // Digital signatures placed on this specific record (see Signature model above).
    preparedBy: {
        userId: String, fullName: String, responsibility: String,
        signatureImage: String, signedAt: Date
    },
    approvedBy: {
        userId: String, fullName: String, responsibility: String,
        signatureImage: String, signedAt: Date
    },
    // Set when the preparer sends this record to a specific person for
    // approval; cleared once that exact person approves it (see the /sign
    // endpoint below) — nobody else can approve it in the meantime.
    approval: {
        pendingApproverId: String, pendingApproverName: String, requestedAt: Date
    },
    // Soft delete: "ሰርዝ" no longer permanently erases a record. It's hidden
    // from every normal list and excluded from financial totals, but stays
    // recoverable in the Trash until someone with Admin explicitly empties
    // it — so an accidental delete can never quietly corrupt a report.
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
});
const Record = mongoose.model('Record', recordSchema);

// Every time a record's dates/amount are renewed (PUT), the PREVIOUS version
// is archived here first, so renewing no longer silently erases history.
const recordHistorySchema = new mongoose.Schema({
    recordId: String,
    snapshot: Object, // the full record as it was right before this update
    archivedAt: { type: Date, default: Date.now }
});
const RecordHistory = mongoose.model('RecordHistory', recordHistorySchema);

// File storage: Cloudinary (cloud), not the local disk. Render/Railway-style
// hosts wipe their local filesystem on every redeploy/restart, which would
// silently delete every signature photo and contract attachment — Cloudinary
// keeps them safe outside the app itself, and gives back a permanent https
// URL that's stored on the record/signature instead of a local file path.
// Needs CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
// in .env — get these free at https://cloudinary.com/users/register/free
// (Dashboard page shows all three right after signup).
//
// Uploads to Cloudinary directly via its own SDK (cloudinary.uploader.upload_stream)
// instead of the multer-storage-cloudinary bridge package — that package's
// supported multer version conflicts with this project's multer v2 (an
// npm ERESOLVE error at install time), which is a sign it isn't a safe
// pairing to rely on. Multer itself just parses the incoming file into
// memory (multer.memoryStorage()); each route then uploads that buffer to
// Cloudinary explicitly and uses the URL it returns.
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
// Wraps Cloudinary's upload_stream in a Promise so route handlers can just
// `await` it. resourceType 'auto' lets Cloudinary store PDFs correctly (as
// 'raw') alongside images in the same call.
function uploadBufferToCloudinary(buffer, folder, resourceType) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder, resource_type: resourceType || 'auto' },
            (err, result) => { if (err) reject(err); else resolve(result); }
        );
        uploadStream.end(buffer);
    });
}
const memoryStorage = multer.memoryStorage();
// Only accept image/PDF attachments, capped at 8MB.
const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const upload = multer({
    storage: memoryStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_UPLOAD_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('የፋይል አይነት ተቀባይነት የለውም (ፎቶ ወይም PDF ብቻ ይፈቀዳል)'));
        }
    }
});
// Signature photos: images only, small size cap.
const signatureUpload = multer({
    storage: memoryStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('የፊርማ ፎቶ ምስል (JPG/PNG/WEBP) መሆን አለበት'));
        }
    }
});

// Nodemailer Setup
// IMPORTANT: replace the placeholder below (or better, set EMAIL_USER /
// EMAIL_APP_PASSWORD in your .env file) with a real Gmail "App Password" —
// https://myaccount.google.com/apppasswords — a normal Gmail login password
// will NOT work here. Until this is a real app password, reminder emails
// will silently fail (the error will show in the server console as
// "Error sending email reminders").
const EMAIL_USER = process.env.EMAIL_USER || 'samuelmekonnentaye@gmail.com';
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || 'YOUR_GMAIL_APP_PASSWORD';
if (EMAIL_APP_PASSWORD === 'YOUR_GMAIL_APP_PASSWORD') {
    console.warn('⚠️  Email reminders are NOT configured yet: set EMAIL_USER / EMAIL_APP_PASSWORD in .env (a real Gmail App Password), otherwise no reminder emails will be sent.');
}
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_APP_PASSWORD
    }
});

// Email Reminder Function
async function checkAndSendEmailReminders() {
    try {
        const today = new Date();
        today.setHours(0,0,0,0);

        // Records in the Trash must not keep sending reminders.
        const records = await Record.find({ isDeleted: { $ne: true } });

        for (let record of records) {
            const dueDate = new Date(record.dueDate);
            dueDate.setHours(0,0,0,0);

            const diffTime = dueDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Sent every day starting 10 days before the due date, through the
            // due date itself, and every day it stays overdue afterwards —
            // matching the "አድስ / Renew" window used in the dashboard, and
            // continuing daily until the record is renewed.
            if (diffDays <= 10) {
                const user = await User.findById(record.userId);
                if (user && user.email) {
                    const isOverdue = diffDays < 0;
                    const daysLabel = isOverdue
                        ? `${Math.abs(diffDays)} ቀን አልፎበታል`
                        : diffDays === 0
                            ? 'ዛሬ ነው የሚያበቃው'
                            : `${diffDays} ቀን ቀርቶታል`;

                    const mailOptions = {
                        from: `"Fountain International Trading" <${EMAIL_USER}>`,
                        to: user.email,
                        subject: `${isOverdue ? '🔴 ጊዜው ያለፈበት' : '🚨'} የክፍያ/ውል ማሳሰቢያ፦ ${record.name} (${daysLabel})`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                <h2 style="color: #2b6cb0;">Fountain International Trading PLC</h2>
                                <h3 style="color: ${isOverdue ? '#e53e3e' : '#d69e2e'};">${isOverdue ? '🔴 ጊዜው ያለፈ የክፍያ/ውል ማሳሰቢያ' : '⚠️ የክፍያ/የውል ማሳሰቢያ'}</h3>
                                <p>ሰላም <strong>${escapeHtml(user.fullName || user.username)}</strong>፣</p>
                                <p>የተመዘገበው <strong>[${escapeHtml(record.category)}] ${escapeHtml(record.name)}</strong> ${isOverdue ? `የማብቂያ ቀኑ ካለፈ <strong>${Math.abs(diffDays)} ቀናት</strong> ሆኖታል፣ እባክዎ በአስቸኳይ ያድሱት።` : `የሚያበቃበት ቀን በ<strong>${diffDays} ቀናት</strong> ውስጥ ስለሆነ አስፈላጊውን ክትትል እንዲያደርጉ እናስታውሳለን።`}</p>
                                <hr />
                                <ul>
                                    <li><strong>ስም/መግለጫ፦</strong> ${escapeHtml(record.name)}</li>
                                    <li><strong>መጠን፦</strong> ${record.amount} ብር</li>
                                    <li><strong>የማብቂያ ቀን (Due Date)፦</strong> ${record.dueDate}</li>
                                    <li><strong>ሁኔታ፦</strong> <span style="color: ${isOverdue ? 'red' : '#d97706'}; font-weight: bold;">${daysLabel}</span></li>
                                </ul>
                                <p style="font-size: 12px; color: #718096;">ይህ ከአውቶማቲክ የፋይናንስ መከታተያ ሲስተም የተላከ ማስታወሻ ነው። ይህ በየቀኑ ስለሚላክ፣ ችግሩን ለማስቆም እባክዎ ሲስተሙ ላይ ቀኑን ያድሱ (renew)።</p>
                            </div>
                        `
                    };

                    await transporter.sendMail(mailOptions);
                    console.log(`Reminder email sent to ${user.email} for ${record.name} (${daysLabel})`);
                }
            }
        }
    } catch (err) {
        logError('Error sending email reminders:', err);
    }
}

// Cron Job: Every day at 8:00 AM
cron.schedule('0 8 * * *', () => {
    console.log('Running daily email reminder check...');
    checkAndSendEmailReminders();
});

// ===== Login brute-force limiter (in memory; resets on restart) =====
const loginFailures = new Map();
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
function loginKey(req, username) { return `${req.ip}|${String(username).toLowerCase()}`; }
function loginLocked(key) {
    const e = loginFailures.get(key);
    if (!e) return false;
    if (Date.now() - e.first > LOGIN_WINDOW_MS) { loginFailures.delete(key); return false; }
    return e.count >= LOGIN_MAX_FAILS;
}
function loginFailed(key) {
    const e = loginFailures.get(key);
    if (!e || Date.now() - e.first > LOGIN_WINDOW_MS) loginFailures.set(key, { count: 1, first: Date.now() });
    else e.count += 1;
}

// API 1: Login with Status Check (የተስተካከለ የሎጊን ክፍል)
app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        return res.status(400).json({ error: 'የተጠቃሚ ስም እና የይለፍ ቃል ያስገቡ' });
    }
    const lkey = loginKey(req, username);
    if (loginLocked(lkey)) {
        return res.status(429).json({ error: 'ብዙ ጊዜ ተሳስተዋል። ከ15 ደቂቃ በኋላ እንደገና ይሞክሩ።' });
    }
    try {
        const user = await User.findOne({ username });
        if (!user) {
            loginFailed(lkey);
            return res.status(401).json({ error: 'የተሳሳተ የባለቤት ስም ወይም የይለፍ ቃል!' });
        }

        // Bcrypt hashes always start with $2a$ / $2b$ / $2y$. Accounts created before this
        // update may still have a plain-text password stored — support both so no one
        // gets locked out, and silently upgrade old accounts to a hash on next login.
        const looksHashed = /^\$2[aby]\$/.test(user.password || '');
        let passwordMatches = false;

        if (looksHashed) {
            passwordMatches = await bcrypt.compare(password, user.password);
        } else {
            passwordMatches = user.password === password;
            if (passwordMatches) {
                user.password = await bcrypt.hash(password, SALT_ROUNDS);
                await user.save();
            }
        }

        if (!passwordMatches) {
            loginFailed(lkey);
            return res.status(401).json({ error: 'የተሳሳተ የባለቤት ስም ወይም የይለፍ ቃል!' });
        }
        if (user.status === 'pending') {
            return res.status(403).json({ error: 'አካውንትዎ ገና በአድሚን አልተፈቀደም (Pending)! እባክዎ በትዕግስት ይጠብቁ።' });
        }
        if (user.status === 'rejected') {
            return res.status(403).json({ error: 'ይህ አካውንት ተቀባይነት አላገኘም (Rejected)።' });
        }
        loginFailures.delete(lkey);
        const token = signToken({ id: user._id.toString(), role: user.role, exp: Date.now() + TOKEN_TTL_MS });
        res.json({ id: user._id, fullName: user.fullName, username: user.username, email: user.email, role: user.role, access: effectiveAccess(user), token });
    } catch (err) {
        // Logged so the real cause (DB connection drop, bad data, etc.) is
        // visible in the server console instead of only showing a generic
        // message to the user.
        logError('Login error:', err);
        res.status(500).json({ error: 'የሰርቨር ስህተት አጋጥሟል' });
    }
});

// Checks an emailed reset code. Only a few wrong guesses are allowed per code —
// otherwise the 6-digit code could simply be brute-forced.
const MAX_RESET_ATTEMPTS = 5;
async function checkResetCode(user, code) {
    if (!user || !user.resetCodeHash || !user.resetCodeExpires) return 'ልክ ያልሆነ ወይም ጊዜው ያለፈበት ኮድ';
    if (user.resetCodeExpires.getTime() < Date.now()) return 'የኮዱ ጊዜ አልቋል፣ አዲስ ኮድ ይጠይቁ';
    const matches = await bcrypt.compare(code, user.resetCodeHash);
    if (matches) return null;
    user.resetAttempts = (user.resetAttempts || 0) + 1;
    if (user.resetAttempts >= MAX_RESET_ATTEMPTS) {
        user.resetCodeHash = null;
        user.resetCodeExpires = null;
        user.resetAttempts = 0;
        await user.save();
        return 'ብዙ ጊዜ ተሳስተዋል፤ እባክዎ አዲስ ኮድ ይጠይቁ';
    }
    await user.save();
    return 'ልክ ያልሆነ ኮድ';
}

// API 1.1: Forgot password — request a reset code by username or email.
// Always responds with the same generic message whether or not an account
// was found, so this endpoint can't be used to check which usernames/emails
// exist. If an account IS found, a 6-digit code is emailed to the address
// already on file (never to an address supplied in the request).
app.post('/api/users/forgot-password', async (req, res) => {
    const identifier = String(req.body.identifier || '').trim();
    const genericResponse = { message: 'መለያ ካለ ወደ ኢሜይልዎ የማረጋገጫ ኮድ ተልኳል። እባክዎ ኢሜይልዎን ያረጋግጡ።' };
    try {
        if (!identifier) return res.json(genericResponse);

        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        if (!user || !user.email) return res.json(genericResponse);

        const code = String(crypto.randomInt(100000, 1000000)); // 6-digit, cryptographically random
        user.resetCodeHash = await bcrypt.hash(code, SALT_ROUNDS);
        user.resetAttempts = 0;
        user.resetCodeExpires = new Date(Date.now() + RESET_CODE_TTL_MS);
        await user.save();

        try {
            await transporter.sendMail({
                from: `"Fountain International Trading" <${EMAIL_USER}>`,
                to: user.email,
                subject: '🔑 የይለፍ ቃል መቀየሪያ ኮድ (Password Reset Code)',
                html: `
                    <p>ሰላም ${escapeHtml(user.fullName || user.username)},</p>
                    <p>የይለፍ ቃልዎን ለመቀየር የሚከተለውን ኮድ ይጠቀሙ፦</p>
                    <h2 style="letter-spacing:4px;">${code}</h2>
                    <p>ይህ ኮድ ለ15 ደቂቃ ብቻ የሚሰራ ነው። ይህን ካልጠየቁ፣ እባክዎ ይህን መልእክት ችላ ይበሉ።</p>
                `
            });
        } catch (mailErr) {
            // If email genuinely isn't configured (see the EMAIL_APP_PASSWORD
            // warning at startup), don't leave the person stuck silently —
            // but still don't reveal whether the account itself existed.
            logError('Password reset email error:', mailErr);
        }

        res.json(genericResponse);
    } catch (err) {
        logError('Forgot password error:', err);
        res.status(500).json({ error: 'ጥያቄውን ማስኬድ አልተቻለም' });
    }
});

// API 1.15: Verify the emailed code on its own, BEFORE asking for a new
// password. This lets the login page confirm the code is right in its own
// step (six individual boxes) instead of only finding out it was wrong after
// the person has also typed a new password. It does NOT consume or clear the
// code — that still happens in reset-password below — so the same code can
// still be submitted there right after being verified here.
app.post('/api/users/verify-reset-code', async (req, res) => {
    const identifier = String(req.body.identifier || '').trim();
    const code = String(req.body.code || '').trim();
    try {
        if (!identifier || !code) {
            return res.status(400).json({ error: 'እባክዎ ኮዱን ያስገቡ' });
        }
        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        const codeError = await checkResetCode(user, code);
        if (codeError) return res.status(400).json({ error: codeError });
        res.json({ ok: true, valid: true });
    } catch (err) {
        logError('Verify reset code error:', err);
        res.status(500).json({ error: 'ኮዱን ማረጋገጥ አልተቻለም' });
    }
});

// API 1.2: Reset password using the emailed code.
app.post('/api/users/reset-password', async (req, res) => {
    const { identifier, code, newPassword } = req.body;
    try {
        if ([identifier, code, newPassword].some(v => typeof v !== 'string')) {
            return res.status(400).json({ error: 'እባክዎ ሁሉንም መስኮች ይሙሉ' });
        }
        if (!identifier || !code || !newPassword) {
            return res.status(400).json({ error: 'እባክዎ ሁሉንም መስኮች ይሙሉ' });
        }
        if (newPassword.length < 4) {
            return res.status(400).json({ error: 'አዲሱ የይለፍ ቃል ቢያንስ 4 ፊደል/ቁጥር ሊኖረው ይገባል' });
        }

        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        const codeError = await checkResetCode(user, code);
        if (codeError) return res.status(400).json({ error: codeError });

        user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
        user.resetCodeHash = null;
        user.resetCodeExpires = null;
        user.resetAttempts = 0;
        await user.save();

        res.json({ message: 'የይለፍ ቃልዎ ተቀይሯል! አሁን በአዲሱ የይለፍ ቃል ይግቡ።' });
    } catch (err) {
        logError('Reset password error:', err);
        res.status(500).json({ error: 'የይለፍ ቃል መቀየር አልተቻለም' });
    }
});

// API 2: Register User (Self-Registration defaults to Pending; a genuinely
// authenticated Admin can pre-approve). Anyone could previously self-approve
// by simply sending status:'approved' in the request body — now that's only
// honored if the request actually carries a valid Admin token.
app.post('/api/users/register', async (req, res) => {
    const { fullName, username, password, email, role, status, permissions, access } = req.body;
    if ([fullName, username, password, email].some(v => typeof v !== 'string' || !v.trim())) {
        return res.status(400).json({ error: 'እባክዎ ሁሉንም መስኮች በትክክል ይሙሉ (ስም፣ ኢሜይል፣ Username፣ Password)።' });
    }
    try {
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ error: 'ይህ የተጠቃሚ ስም አስቀድሞ ተይዟል!' });

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const payload = verifyToken(token);
        const requesterDoc = (payload && payload.id) ? await User.findById(payload.id) : null;
        const requesterIsAdmin = !!(requesterDoc && requesterDoc.role === 'Admin' && requesterDoc.status !== 'rejected' && requesterDoc.status !== 'pending');

        // Only an Admin sets responsibilities directly at registration time —
        // a public self-signup always starts as a plain 'prepare' account
        // until an Admin deliberately grants anything more.
        let finalPermissions = ['prepare'];
        if (requesterIsAdmin && Array.isArray(permissions)) {
            finalPermissions = permissions.filter(p => VALID_PERMISSIONS.includes(p));
            if (finalPermissions.length === 0) finalPermissions = ['prepare'];
        }

        // Only an Admin chooses which modules a new account can open. A public
        // self-signup starts with none until an Admin grants them.
        const finalAccess = (requesterIsAdmin && Array.isArray(access))
            ? access.filter(k => ACCESS_MODULES.includes(k))
            : [];

        const newUser = new User({ 
            fullName, 
            username, 
            password: hashedPassword, 
            email, 
            role: requesterIsAdmin ? (role || 'Employee') : 'Employee',
            status: (status === 'approved' && requesterIsAdmin) ? 'approved' : 'pending',
            permissions: finalPermissions,
            access: finalAccess
        });
        await newUser.save();

        const userObj = newUser.toObject();
        delete userObj.password;
        res.json(userObj);
    } catch (err) {
        logError('Register error:', err);

        // A duplicate username can still slip past the findOne() check above
        // under a race condition (two people registering the same username
        // at almost the same moment) and gets rejected by MongoDB's unique
        // index instead — surface that as the same friendly message.
        if (err.code === 11000) {
            return res.status(400).json({ error: 'ይህ የተጠቃሚ ስም አስቀድሞ ተይዟል!' });
        }
        // Missing/invalid required fields (e.g. bad email format) throw a
        // Mongoose ValidationError — report it clearly instead of a blanket 500.
        if (err.name === 'ValidationError') {
            return res.status(400).json({ error: 'እባክዎ ሁሉንም መስኮች በትክክል ይሙሉ (ስም፣ ኢሜይል፣ Username፣ Password)።' });
        }
        res.status(500).json({ error: 'መመዝገብ አልተቻለም! (የሰርቨር ስህተት)' });
    }
});

// API 3: Get All Users
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const users = await User.find({}, '-password -resetCodeHash -resetCodeExpires -resetAttempts');
        res.json(users);
    } catch (err) {
        logError('Get users error:', err);
        res.status(500).json({ error: 'ተጠቃሚዎችን ማምጣት አልተቻለም!' });
    }
});

// API 3.1: Update User Status (Approve or Reject by Admin)
app.put('/api/users/status/:id', requireAdmin, async (req, res) => {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'ልክ ያልሆነ ሁኔታ' });
    }
    if (req.params.id === req.authUser.id && status !== 'approved') {
        return res.status(400).json({ error: 'የራስዎን አካውንት ማገድ አይችሉም' });
    }
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true, projection: '-password -resetCodeHash -resetCodeExpires -resetAttempts' });
        if (!user) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም!' });
        res.json({ message: `የተጠቃሚው ሁኔታ ወደ ${status} ተቀይሯል!`, user });
    } catch (err) {
        logError('Update user status error:', err);
        res.status(500).json({ error: 'ሁኔታውን መቀየር አልተቻለም' });
    }
});

// API 3.1b: Update a user's responsibilities (Admin only) — controls whether
// they can be sent records to approve ('approve') and/or prepare & sign
// records themselves ('prepare').
app.put('/api/users/permissions/:id', requireAdmin, async (req, res) => {
    try {
        const permissions = Array.isArray(req.body.permissions)
            ? req.body.permissions.filter(p => VALID_PERMISSIONS.includes(p))
            : [];
        const user = await User.findByIdAndUpdate(req.params.id, { permissions }, { new: true, projection: '-password -resetCodeHash -resetCodeExpires -resetAttempts' });
        if (!user) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም!' });
        res.json(user);
    } catch (err) {
        logError('Update permissions error:', err);
        res.status(500).json({ error: 'ኃላፊነቶችን ማዘመን አልተቻለም' });
    }
});

// API 3.2: Delete User (Admin only) — was missing; the "ሰርዝ" button in the dashboard already relies on this.
// API 3.1c: Which modules the logged-in user may open (re-checked by the
// browser on every page load, so an Admin's change applies at the next refresh).
app.get('/api/users/me/access', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.authUser.id);
        if (!user) return res.status(401).json({ error: 'ተጠቃሚው አልተገኘም' });
        res.json({ access: effectiveAccess(user), role: user.role });
    } catch (err) {
        logError('Get my access error:', err);
        res.status(500).json({ error: 'መዳረሻን ማምጣት አልተቻለም' });
    }
});

// API 3.1d: Set the modules a user may open (Admin only).
app.put('/api/users/access/:id', requireAdmin, async (req, res) => {
    try {
        if (!Array.isArray(req.body.access)) return res.status(400).json({ error: 'ልክ ያልሆነ ጥያቄ' });
        const access = Array.from(new Set(req.body.access.filter(k => ACCESS_MODULES.includes(k))));
        const user = await User.findByIdAndUpdate(req.params.id, { access }, { new: true, projection: '-password -resetCodeHash -resetCodeExpires -resetAttempts' });
        if (!user) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም' });
        res.json(user);
    } catch (err) {
        logError('Update access error:', err);
        res.status(500).json({ error: 'መዳረሻን ማዘመን አልተቻለም' });
    }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        if (req.params.id === req.authUser.id) {
            return res.status(400).json({ error: 'የራስዎን አካውንት መሰረዝ አይችሉም' });
        }
        const target = await User.findById(req.params.id);
        if (!target) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም!' });
        if (target.role === 'Admin' && (await User.countDocuments({ role: 'Admin' })) <= 1) {
            return res.status(400).json({ error: 'የመጨረሻውን Admin መሰረዝ አይቻልም' });
        }
        const deleted = await User.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም!' });
        res.json({ message: 'ተጠቃሚው ተሰርዟል!' });
    } catch (err) {
        logError('Delete user error:', err);
        res.status(500).json({ error: 'ተጠቃሚውን መሰረዝ አልተቻለም' });
    }
});

// API 4: Change Password
app.put('/api/users/change-password', requireAuth, async (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;
    // A logged-in user may only change their OWN password through this
    // endpoint — previously any userId could be passed in the body and
    // changed by anyone who could reach this route at all.
    if (userId !== req.authUser.id) {
        return res.status(403).json({ error: 'የራስዎን የይለፍ ቃል ብቻ መቀየር ይችላሉ።' });
    }
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም!' });

        const looksHashed = /^\$2[aby]\$/.test(user.password || '');
        const currentMatches = looksHashed
            ? await bcrypt.compare(currentPassword, user.password)
            : user.password === currentPassword;

        if (!currentMatches) {
            return res.status(400).json({ error: 'የነበረው የይለፍ ቃል የተሳሳተ ነው!' });
        }
        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ error: 'አዲሱ የይለፍ ቃል ቢያንስ 4 ፊደል/ቁጥር ሊኖረው ይገባል።' });
        }

        user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await user.save();
        res.json({ message: 'የይለፍ ቃልዎ በትክክል ተቀይሯል!' });
    } catch (err) {
        logError('Change password error:', err);
        res.status(500).json({ error: 'የይለፍ ቃል መቀየር አልተቻለም!' });
    }
});

// API 5: Get Records
app.get('/api/records/:userId', requireAuth, async (req, res) => {
    // An Employee may only ever fetch their OWN records — previously any
    // logged-in user could read anyone else's records just by changing the
    // :userId in the URL.
    if (req.authUser.role !== 'Admin' && req.authUser.id !== req.params.userId) {
        return res.status(403).json({ error: 'የሌላ ተጠቃሚ መረጃ ማየት አይችሉም።' });
    }
    try {
        const user = await User.findById(req.params.userId);
        let records;
        if (user && user.role === 'Admin') {
            records = await Record.find({ isDeleted: { $ne: true } });
        } else {
            // Own records, PLUS anything currently sent to this person for
            // approval or that they've already approved — so an approver can
            // actually see (and act on) what's been sent to them, and keeps a
            // history of what they've signed off on.
            records = await Record.find({
                isDeleted: { $ne: true },
                $or: [
                    { userId: req.params.userId },
                    { 'approval.pendingApproverId': req.params.userId },
                    { 'approvedBy.userId': req.params.userId }
                ]
            });
        }
        res.json(filterRecordsByAccess(user, records, r => r.category));
    } catch (err) {
        logError('Get records error:', err);
        res.status(500).json({ error: 'መረጃ ማምጣት አልተቻለም' });
    }
});

// API 5.1: Trash — everything soft-deleted, same visibility rules as the
// normal records list, so it mirrors exactly what someone could see/delete
// in the first place.
app.get('/api/trash/:userId', requireAuth, async (req, res) => {
    if (req.authUser.role !== 'Admin' && req.authUser.id !== req.params.userId) {
        return res.status(403).json({ error: 'የሌላ ተጠቃሚ መረጃ ማየት አይችሉም።' });
    }
    try {
        const user = await User.findById(req.params.userId);
        let records;
        if (user && user.role === 'Admin') {
            records = await Record.find({ isDeleted: true }).sort({ deletedAt: -1 });
        } else {
            records = await Record.find({
                isDeleted: true,
                $or: [
                    { userId: req.params.userId },
                    { 'approval.pendingApproverId': req.params.userId },
                    { 'approvedBy.userId': req.params.userId }
                ]
            }).sort({ deletedAt: -1 });
        }
        // Trash is its own module; without it the list is simply empty.
        if (user && user.role !== 'Admin' && !effectiveAccess(user).includes('trash')) return res.json([]);
        res.json(filterRecordsByAccess(user, records, r => r.category));
    } catch (err) {
        logError('Get trash error:', err);
        res.status(500).json({ error: 'ትራሽን ማምጣት አልተቻለም' });
    }
});

// API 5.2: Restore a soft-deleted record — brings it back into every normal
// list and back into financial totals, exactly as it was before deletion.
app.post('/api/trash/:id/restore', requireAuth, requireModule('trash'), requirePermission('prepare'), async (req, res) => {
    try {
        const record = await Record.findById(req.params.id);
        if (!record) return res.status(404).json({ error: 'መዝገቡ አልተገኘም' });
        if (req.authUser.role !== 'Admin' && record.userId !== req.authUser.id) {
            return res.status(403).json({ error: 'ይህን መልስ ማድረግ አይችሉም' });
        }
        record.isDeleted = false;
        record.deletedAt = null;
        await record.save();
        res.json(record);
    } catch (err) {
        logError('Restore record error:', err);
        res.status(500).json({ error: 'መልስ ማድረግ አልተቻለም' });
    }
});

// API 5.3: Empty the trash for one record — Admin only, since unlike the
// soft delete above this is genuinely irreversible. Also purges its renewal
// history, so nothing about it is left counting toward any report.
app.delete('/api/trash/:id/permanent', requireAuth, requireAdmin, async (req, res) => {
    try {
        const record = await Record.findById(req.params.id);
        if (!record || !record.isDeleted) {
            return res.status(404).json({ error: 'መዝገቡ በትራሽ ውስጥ አልተገኘም' });
        }
        await Record.findByIdAndDelete(req.params.id);
        await RecordHistory.deleteMany({ recordId: req.params.id });
        res.json({ message: 'ከትራሽ ላይ ለዘላለም ተሰርዟል' });
    } catch (err) {
        logError('Permanent delete error:', err);
        res.status(500).json({ error: 'ማጥፋት አልተቻለም' });
    }
});

// API 5.4: Financial events for reports/dashboard totals — NOT the same as
// the plain records list above. A renewed record only ever keeps its LATEST
// amount/dates in the Record collection itself (the previous state is moved
// to RecordHistory so the operational list and receipt only ever show the
// current one) — but every one of those past amounts was a real payment or
// contract value that genuinely occurred. If totals were computed from
// current records alone, each renewal would silently make the old amount
// disappear from every report. This endpoint returns one "event" per real
// past state PLUS one for the current state — for every record the caller
// can see that ISN'T in the trash — so annual/monthly sums add every
// renewal together instead of only reflecting the latest one. Deleting a
// record (into the trash) removes its current amount AND its whole history
// from these totals, exactly like removing an erroneous entry should;
// restoring it brings all of that back.
app.get('/api/records/financial-events/:userId', requireAuth, async (req, res) => {
    if (req.authUser.role !== 'Admin' && req.authUser.id !== req.params.userId) {
        return res.status(403).json({ error: 'የሌላ ተጠቃሚ መረጃ ማየት አይችሉም።' });
    }
    try {
        const user = await User.findById(req.params.userId);
        const scopeFilter = (user && user.role === 'Admin')
            ? { isDeleted: { $ne: true } }
            : {
                isDeleted: { $ne: true },
                $or: [
                    { userId: req.params.userId },
                    { 'approval.pendingApproverId': req.params.userId },
                    { 'approvedBy.userId': req.params.userId }
                ]
            };
        const currentRecords = await Record.find(scopeFilter);
        const recordIds = currentRecords.map(r => r._id.toString());
        const historySnapshots = await RecordHistory.find({ recordId: { $in: recordIds } });

        const toEvent = (r) => ({
            recordId: r._id ? r._id.toString() : r.recordId,
            name: r.name, category: r.category, amount: r.amount,
            paymentDate: r.paymentDate, startDate: r.startDate, dueDate: r.dueDate
        });
        const events = [
            ...currentRecords.map(toEvent),
            ...historySnapshots.map(h => toEvent(h.snapshot))
        ];
        // Totals feed the dashboard and the finance report only.
        if (user && user.role !== 'Admin' && !['dashboard', 'report'].some(m => effectiveAccess(user).includes(m))) return res.json([]);
        res.json(filterRecordsByAccess(user, events, e => e.category));
    } catch (err) {
        logError('Get financial events error:', err);
        res.status(500).json({ error: 'የፋይናንስ መረጃ ማምጣት አልተቻለም' });
    }
});

// The only fields a payment/contract form may set.
const RECORD_FORM_FIELDS = ['name', 'itemType', 'description', 'amount', 'paymentDate', 'startDate', 'dueDate', 'category'];
function pickRecordFields(body) {
    const out = {};
    RECORD_FORM_FIELDS.forEach(k => { if (body && body[k] !== undefined) out[k] = body[k]; });
    return out;
}

// Shared validation for creating/updating a payment or contract record.
function validateRecordInput(body) {
    const amount = Number(body.amount);
    if (!body.name || body.name.trim() === '') return 'ስም/መግለጫ ባዶ መሆን የለበትም';
    if (isNaN(amount) || amount <= 0) return 'መጠን (Amount) ትክክለኛ አዎንታዊ ቁጥር መሆን አለበት';
    if (!body.dueDate || isNaN(new Date(body.dueDate).getTime())) return 'የማብቂያ ቀን ትክክለኛ መሆን አለበት';
    if (body.startDate && !isNaN(new Date(body.startDate).getTime()) && new Date(body.dueDate) < new Date(body.startDate)) {
        return 'የማብቂያ ቀን ከመጀመሪያ ቀን በኋላ መሆን አለበት';
    }
    return null;
}

// API 6: Add Record
app.post('/api/records', requireAuth, requirePermission('prepare'), upload.single('file'), requireRecordWrite, async (req, res) => {
    try {
        const validationError = validateRecordInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        // Only the form's own fields are accepted, and the owner is ALWAYS the
        // logged-in user — a request can't claim another person's userId or
        // plant its own signatures/approval/deleted flags.
        const recordData = pickRecordFields(req.body);
        recordData.userId = req.authUser.id;
        if (req.file) {
            const uploaded = await uploadBufferToCloudinary(req.file.buffer, 'fountain-records', 'auto');
            recordData.file = uploaded.secure_url;
        }
        const newRecord = new Record(recordData);
        await newRecord.save();
        res.json(newRecord);
    } catch (err) {
        logError('Add record error:', err);
        res.status(500).json({ error: 'መመዝገብ አልተቻለም' });
    }
});

// API 7: Update Record (also used to "renew" a record with a fresh due date)
app.put('/api/records/:id', requireAuth, requirePermission('prepare'), upload.single('file'), requireRecordWrite, async (req, res) => {
    try {
        const validationError = validateRecordInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        // Archive the record exactly as it was before this update, so
        // renewing a contract/payment no longer permanently erases its
        // previous due date, amount, or history.
        const existing = await Record.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'መዝገቡ አልተገኘም' });
        // Only the person who registered it (or an Admin) may change/renew it.
        if (req.authUser.role !== 'Admin' && existing.userId !== req.authUser.id) {
            return res.status(403).json({ error: 'የሌላ ሰው መዝገብ ማስተካከል አይችሉም' });
        }
        await RecordHistory.create({ recordId: req.params.id, snapshot: existing.toObject() });

        // The owner never changes on an update (previously whoever edited it
        // became its owner, which moved records between people).
        const recordData = pickRecordFields(req.body);
        if (req.file) {
            const uploaded = await uploadBufferToCloudinary(req.file.buffer, 'fountain-records', 'auto');
            recordData.file = uploaded.secure_url;
        }
        const updatedRecord = await Record.findByIdAndUpdate(req.params.id, recordData, { new: true });
        res.json(updatedRecord);
    } catch (err) {
        logError('Update record error:', err);
        res.status(500).json({ error: 'ማሻሻል አልተቻለም' });
    }
});

// API 7.1: View a record's renewal history
app.get('/api/records/:id/history', requireAuth, requireModule('payments', 'contracts', 'gallery', 'dashboard', 'report'), async (req, res) => {
    try {
        if (req.authUser.role !== 'Admin') {
            const rec = await Record.findById(req.params.id);
            const me = req.authUser.id;
            const allowed = rec && (rec.userId === me
                || (rec.approval && rec.approval.pendingApproverId === me)
                || (rec.approvedBy && rec.approvedBy.userId === me));
            if (!allowed) return res.status(403).json({ error: 'የሌላ ሰው መዝገብ ታሪክ ማየት አይችሉም' });
        }
        const history = await RecordHistory.find({ recordId: req.params.id }).sort({ archivedAt: -1 });
        res.json(history);
    } catch (err) {
        logError('Get record history error:', err);
        res.status(500).json({ error: 'ታሪክ ማምጣት አልተቻለም' });
    }
});

// API 9: Restore records from a Backup file — replaces ALL current records
// with the ones in the backup, and (unlike before) actually persists them to
// the database so they survive a page refresh. Destructive, so Admin-only.
app.post('/api/records/restore', requireAdmin, async (req, res) => {
    try {
        const backupRecords = req.body.records;
        if (!Array.isArray(backupRecords)) {
            return res.status(400).json({ error: 'ልክ ያልሆነ የBackup ፋይል' });
        }
        await Record.deleteMany({});
        const toInsert = backupRecords.map(r => {
            const clean = { ...r };
            delete clean.__v;
            return clean; // keep original _id where present, so links/history stay consistent
        });
        if (toInsert.length > 0) {
            await Record.insertMany(toInsert, { ordered: false });
        }
        res.json({ message: 'መረጃዎቹ ወደ ዳታቤዝ ተመልሰዋል!', count: toInsert.length });
    } catch (err) {
        logError('Restore records error:', err);
        res.status(500).json({ error: 'Restore ማድረግ አልተቻለም' });
    }
});

// API 8: Delete Record
// API 8: Delete Record — soft delete only (moves to Trash). See the Trash
// endpoints above for restore / permanent delete.
app.delete('/api/records/:id', requireAuth, requirePermission('prepare'), async (req, res) => {
    try {
        const record = await Record.findById(req.params.id);
        if (!record) return res.status(404).json({ error: 'መዝገቡ አልተገኘም' });
        if (!effectiveAccess(req.authUserDoc).includes(recordModule(record.category))) {
            return res.status(403).json({ error: 'ይህን ክፍል ለመጠቀም ፈቃድ የለዎትም' });
        }
        if (req.authUser.role !== 'Admin' && record.userId !== req.authUser.id) {
            return res.status(403).json({ error: 'ይህን መዝገብ መሰረዝ አይችሉም' });
        }
        record.isDeleted = true;
        record.deletedAt = new Date();
        await record.save();
        res.json({ message: 'ወደ ትራሽ ተልኳል' });
    } catch (err) {
        logError('Delete record error:', err);
        res.status(500).json({ error: 'መሰረዝ አልተቻለም' });
    }
});

// ===== Digital Signature =====

// API 10: Register (or replace) my own signature. If a signature already
// exists for this user, the OLD signature password must be supplied to
// replace it — otherwise anyone with access to the account could quietly
// swap out someone else's saved signature image.
app.post('/api/signature/register', requireAuth, signatureUpload.single('signatureImage'), async (req, res) => {
    try {
        const { fullName, responsibility, signaturePassword, currentSignaturePassword } = req.body;
        if (!fullName || !responsibility || !signaturePassword) {
            return res.status(400).json({ error: 'ስም፣ ኃላፊነት እና የፊርማ ፓስወርድ ያስፈልጋሉ' });
        }
        if (signaturePassword.length < 4) {
            return res.status(400).json({ error: 'የፊርማ ፓስወርድ ቢያንስ 4 ፊደል/ቁጥር ሊኖረው ይገባል' });
        }

        const existing = await Signature.findOne({ userId: req.authUser.id });

        if (existing) {
            const matches = await bcrypt.compare(currentSignaturePassword || '', existing.signaturePasswordHash);
            if (!matches) {
                return res.status(401).json({ error: 'ነባሩ የፊርማ ፓስወርድ ትክክል አይደለም — ፊርማውን መተካት አይቻልም' });
            }
            existing.fullName = fullName;
            existing.responsibility = responsibility;
            existing.signaturePasswordHash = await bcrypt.hash(signaturePassword, SALT_ROUNDS);
            if (req.file) {
                const uploaded = await uploadBufferToCloudinary(req.file.buffer, 'fountain-signatures', 'image');
                existing.signatureImage = uploaded.secure_url;
            }
            await existing.save();
            return res.json({ message: 'ፊርማዎ በትክክል ተስተካክሏል!' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'የፊርማ ፎቶ ያስፈልጋል' });
        }

        const uploaded = await uploadBufferToCloudinary(req.file.buffer, 'fountain-signatures', 'image');
        await Signature.create({
            userId: req.authUser.id,
            fullName,
            responsibility,
            signatureImage: uploaded.secure_url,
            signaturePasswordHash: await bcrypt.hash(signaturePassword, SALT_ROUNDS)
        });
        res.json({ message: 'ፊርማዎ በትክክል ተመዝግቧል!' });
    } catch (err) {
        logError('Signature register error:', err);
        res.status(500).json({ error: 'ፊርማ መመዝገብ አልተቻለም' });
    }
});

// API 10.1: Whether I already have a registered signature (no sensitive data returned).
app.get('/api/signature/mine', requireAuth, async (req, res) => {
    try {
        const sig = await Signature.findOne({ userId: req.authUser.id });
        if (!sig) return res.json({ registered: false });
        res.json({ registered: true, fullName: sig.fullName, responsibility: sig.responsibility, signatureImage: sig.signatureImage });
    } catch (err) {
        logError('Get my signature error:', err);
        res.status(500).json({ error: 'መረጃ ማምጣት አልተቻለም' });
    }
});

// API 10.2: Everyone eligible to be sent a record for approval — must have
// the 'approve' responsibility (or be an Admin) AND have already registered
// a signature, since someone without one on file couldn't actually sign.
app.get('/api/approvers', requireAuth, async (req, res) => {
    try {
        const approverUsers = await User.find(
            { status: 'approved', $or: [{ role: 'Admin' }, { permissions: 'approve' }] },
            '_id fullName'
        );
        const ids = approverUsers.map(u => u._id.toString());
        const signatures = await Signature.find({ userId: { $in: ids } }, 'userId responsibility');
        const sigByUser = new Map(signatures.map(s => [s.userId, s]));
        const list = approverUsers
            .filter(u => sigByUser.has(u._id.toString()))
            .map(u => ({ id: u._id.toString(), fullName: u.fullName, responsibility: sigByUser.get(u._id.toString()).responsibility }));
        res.json(list);
    } catch (err) {
        logError('Get approvers error:', err);
        res.status(500).json({ error: 'የአጽዳቂዎችን ዝርዝር ማምጣት አልተቻለም' });
    }
});

// API 10.3: Actually place my signature on a record — "ያዘጋጀው" (prepared) or
// "ያጸደቀው" (approved) slot. Requires the dedicated signature password EVERY
// time, regardless of how recently the person logged in, so a signature
// can't be applied by anyone who merely has the browser session open.
//
// Preparing a record no longer silently makes it approvable by anyone who
// happens to click the "ፈርም" button: the preparer must explicitly send it to
// one specific, designated approver (sendToApproverId), and only that exact
// person (or an Admin, as an oversight override) can then approve it — which
// also fires an in-app notification to that person, and back to the
// preparer once it's approved.
app.post('/api/records/:id/sign', requireAuth, async (req, res) => {
    try {
        const { slot, signaturePassword, sendToApproverId } = req.body;
        console.log(`[sign] user=${req.authUser.id} record=${req.params.id} slot=${slot} sendTo=${sendToApproverId || '-'}`);
        if (!['prepared', 'approved'].includes(slot)) {
            console.log('[sign] rejected: invalid slot value');
            return res.status(400).json({ error: 'ልክ ያልሆነ የፊርማ ቦታ' });
        }

        const requesterUser = await User.findById(req.authUser.id);
        if (!requesterUser) {
            console.log('[sign] rejected: requester user not found in DB');
            return res.status(401).json({ error: 'ተጠቃሚው አልተገኘም' });
        }

        if (slot === 'prepared' && !hasPermission(requesterUser, 'prepare')) {
            console.log(`[sign] rejected: ${requesterUser.username} lacks 'prepare' permission`);
            return res.status(403).json({ error: 'ይህን ለማድረግ ተገቢው ኃላፊነት የለዎትም' });
        }
        if (slot === 'approved' && !hasPermission(requesterUser, 'approve')) {
            console.log(`[sign] rejected: ${requesterUser.username} lacks 'approve' permission (role=${requesterUser.role}, permissions=${requesterUser.permissions})`);
            return res.status(403).json({ error: 'ይህን ለማጽደቅ ፈቃድ የለዎትም' });
        }

        const sig = await Signature.findOne({ userId: req.authUser.id });
        if (!sig) {
            console.log(`[sign] rejected: ${requesterUser.username} has no registered Signature document yet`);
            return res.status(400).json({ error: 'መጀመሪያ የራስዎን ፊርማ ይመዝገቡ' });
        }
        const matches = await bcrypt.compare(signaturePassword || '', sig.signaturePasswordHash);
        if (!matches) {
            console.log(`[sign] rejected: wrong signature password for ${requesterUser.username}`);
            return res.status(401).json({ error: 'የፊርማ ፓስወርድ ትክክል አይደለም' });
        }

        const record = await Record.findById(req.params.id);
        if (!record) {
            console.log('[sign] rejected: record not found');
            return res.status(404).json({ error: 'መዝገቡ አልተገኘም' });
        }

        const signaturePayload = {
            userId: sig.userId,
            fullName: sig.fullName,
            responsibility: sig.responsibility,
            signatureImage: sig.signatureImage,
            signedAt: new Date()
        };

        let update = {};
        let notifyApproverId = null;

        if (slot === 'prepared') {
            update.preparedBy = signaturePayload;

            if (sendToApproverId) {
                const approverUser = await User.findById(sendToApproverId);
                if (!approverUser || approverUser.status !== 'approved' || !hasPermission(approverUser, 'approve')) {
                    return res.status(400).json({ error: 'የመረጡት ሰው ማጽደቅ የሚያስችል ኃላፊነት የለውም' });
                }
                const approverSig = await Signature.findOne({ userId: sendToApproverId });
                if (!approverSig) {
                    return res.status(400).json({ error: 'የመረጡት ሰው ገና ፊርማ አልመዘገበም' });
                }
                update.approval = {
                    pendingApproverId: sendToApproverId,
                    pendingApproverName: approverSig.fullName,
                    requestedAt: new Date()
                };
                notifyApproverId = sendToApproverId;
            }
        } else {
            // Approving: must be the exact person this specific record was
            // sent to — no one else can approve it in their place, except an
            // Admin acting as an oversight override.
            const isAssignedApprover = record.approval && record.approval.pendingApproverId === req.authUser.id;
            if (!isAssignedApprover && requesterUser.role !== 'Admin') {
                console.log(`[sign] rejected: ${requesterUser.username} is not the assigned approver (pendingApproverId=${record.approval && record.approval.pendingApproverId}) and is not Admin`);
                return res.status(403).json({ error: 'ይህ መዝገብ ለእርስዎ ማጽደቅ ገና አልተላከም' });
            }
            update.approvedBy = signaturePayload;
            update.approval = { pendingApproverId: null, pendingApproverName: null, requestedAt: record.approval ? record.approval.requestedAt : null };
        }

        const updatedRecord = await Record.findByIdAndUpdate(req.params.id, update, { new: true });
        console.log(`[sign] success: slot=${slot} record=${req.params.id} by=${requesterUser.username}`);

        try {
            if (notifyApproverId) {
                await Notification.create({
                    toUserId: notifyApproverId,
                    type: 'approval_request',
                    recordId: updatedRecord._id.toString(),
                    recordName: updatedRecord.name,
                    fromUserId: sig.userId,
                    fromFullName: sig.fullName,
                    message: `${sig.fullName} "${updatedRecord.name}" የተባለውን ${updatedRecord.category === 'ክፍያ' ? 'ክፍያ' : 'ውል'} እንዲያጸድቁ ልከውልዎታል።`
                });
            } else if (slot === 'approved') {
                await Notification.create({
                    toUserId: updatedRecord.userId,
                    type: 'approved',
                    recordId: updatedRecord._id.toString(),
                    recordName: updatedRecord.name,
                    fromUserId: sig.userId,
                    fromFullName: sig.fullName,
                    message: `${sig.fullName} "${updatedRecord.name}" የተባለውን አጽድቀዋል።`
                });
            }
        } catch (notifErr) {
            // A notification failing to save shouldn't undo/hide the signature
            // that was just successfully placed — just log it.
            logError('Create notification error:', notifErr);
        }

        res.json(updatedRecord);
    } catch (err) {
        logError('Sign record error:', err);
        res.status(500).json({ error: 'ፊርማ ማድረግ አልተቻለም' });
    }
});

// API 11: My notifications (approval requests sent to me, and updates on
// records I sent for approval), newest first.
app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
        const list = await Notification.find({ toUserId: req.authUser.id }).sort({ createdAt: -1 }).limit(50);
        res.json(list);
    } catch (err) {
        logError('Get notifications error:', err);
        res.status(500).json({ error: 'ማሳወቂያዎችን ማምጣት አልተቻለም' });
    }
});
// API 11.1: Mark one of my notifications as read.
app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const notif = await Notification.findOne({ _id: req.params.id, toUserId: req.authUser.id });
        if (!notif) return res.status(404).json({ error: 'ማሳወቂያው አልተገኘም' });
        notif.read = true;
        await notif.save();
        res.json(notif);
    } catch (err) {
        logError('Mark notification read error:', err);
        res.status(500).json({ error: 'ማሳወቂያውን ማዘመን አልተቻለም' });
    }
});

// =====================================================================
// ===== FLEET MANAGEMENT (ተሽከርካሪዎች / የአጠቃቀም / ጥገና / ነዳጅ) =====
// =====================================================================
// The browser side (public/app.js) already calls every /api/fleet/... route
// below. Without these routes the server answered with its default HTML
// "Cannot POST /api/fleet/vehicles" page, which the browser could not read
// as JSON — that is what produced the "መመዝገብ አልተቻለም" alert.

// Departments shown in the trip-log dropdown. Edit this list to match the
// company's real departments.
const FLEET_DEPARTMENTS = ['ፋይናንስ', 'ጥበቃ እና ደህንነት', 'የሰዉ ሃብት አስተዳደር', 'ማርኬቲንግ', 'አስተዳደር', 'ጠቅላላ አገልግሎት', 'ኦፕሬሽን', 'አይቲ', 'አቶ ሰለሞን', 'ስካይ ድሪም'];
const VALID_VEHICLE_STATUS = ['active', 'maintenance', 'out_of_service'];

const vehicleDocSchema = new mongoose.Schema({ expiryDate: { type: String, default: '' } }, { _id: false });
const vehicleSchema = new mongoose.Schema({
    plateNumber: { type: String, required: true },
    vehicleType: { type: String, required: true },
    model: { type: String, default: '' },
    chassisNumber: { type: String, default: '' },
    driverName: { type: String, default: '' },
    currentKm: { type: Number, default: 0 },
    status: { type: String, default: 'active' },
    fuelType: { type: String, default: 'ናፍጣ' },
    kmPerLiter: { type: Number, default: 0 },
    photo: { type: String, default: '' },
    documents: {
        libre: { type: vehicleDocSchema, default: () => ({}) },
        bolo: { type: vehicleDocSchema, default: () => ({}) },
        insurance: { type: vehicleDocSchema, default: () => ({}) },
        competency: { type: vehicleDocSchema, default: () => ({}) }
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});
const Vehicle = mongoose.model('Vehicle', vehicleSchema);

const fleetSettingsSchema = new mongoose.Schema({
    key: { type: String, default: 'main', unique: true },
    dieselPricePerLiter: { type: Number, default: 0 },
    benzinePricePerLiter: { type: Number, default: 0 }
});
const FleetSettings = mongoose.model('FleetSettings', fleetSettingsSchema);

const tripSchema = new mongoose.Schema({
    userId: String,
    vehicleId: String,
    vehiclePlate: String,
    vehicleType: String,
    department: String,
    destination: { type: String, default: '*' },
    tripDate: String,
    departureTime: { type: String, default: '' },
    departureKm: Number,
    returnKm: Number,
    distanceKm: Number,
    estimatedFuelCost: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Trip = mongoose.model('Trip', tripSchema);

const signSlotSchema = {
    userId: String, fullName: String, responsibility: String,
    signatureImage: String, signedAt: Date
};
const maintenanceSchema = new mongoose.Schema({
    userId: String,
    vehicleId: String,
    vehiclePlate: String,
    vehicleType: String,
    date: String,
    odometerKm: { type: Number, default: 0 },
    maintenanceType: { type: String, default: 'routine' },
    cost: { type: Number, default: 0 },
    garage: { type: String, default: '' },
    description: { type: String, default: '' },
    nextServiceKm: { type: Number, default: null },
    nextServiceDate: { type: String, default: '' },
    receipt: { type: String, default: '' },
    preparedBy: signSlotSchema,
    approvedBy: signSlotSchema,
    approval: { pendingApproverId: String, pendingApproverName: String, requestedAt: Date },
    createdAt: { type: Date, default: Date.now }
});
const Maintenance = mongoose.model('Maintenance', maintenanceSchema);

const fuelLogSchema = new mongoose.Schema({
    userId: String,
    vehicleId: String,
    vehiclePlate: String,
    vehicleType: String,
    date: String,
    station: { type: String, default: '' },
    liters: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    odometerKm: { type: Number, default: 0 },
    receipt: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});
const FuelLog = mongoose.model('FuelLog', fuelLogSchema);

// ----- Who may see which fleet ENTRIES -----
// Vehicles are shared company data (everyone with a fleet section needs them
// for the drop-downs), but trip / maintenance / fuel ENTRIES belong to the
// person who made them: others never see them — except Admin and anyone an
// Admin gave the 'fleet_view_all' access (e.g. the fleet officer who prepares
// the weekly report).
function canViewAllFleet(req) {
    return req.authUser.role === 'Admin'
        || (!!req.authUserDoc && effectiveAccess(req.authUserDoc).includes('fleet_view_all'));
}
function fleetScope(req) {
    return canViewAllFleet(req) ? {} : { userId: req.authUser.id };
}
function maintenanceScope(req) {
    if (canViewAllFleet(req)) return {};
    const me = req.authUser.id;
    // plus anything sent to this person for approval, or that they approved
    return { $or: [{ userId: me }, { 'approval.pendingApproverId': me }, { 'approvedBy.userId': me }] };
}

// ---------- helpers ----------
function toNum(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
}
function parseVehicleDocuments(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (e) { parsed = {}; }
    }
    parsed = parsed || {};
    const out = {};
    ['libre', 'bolo', 'insurance', 'competency'].forEach(k => {
        out[k] = { expiryDate: (parsed[k] && parsed[k].expiryDate) ? String(parsed[k].expiryDate) : '' };
    });
    return out;
}
async function getFleetSettings() {
    let s = await FleetSettings.findOne({ key: 'main' });
    if (!s) s = await FleetSettings.create({ key: 'main' });
    return s;
}
async function uploadFleetFile(file, folder) {
    if (!file) return '';
    const uploaded = await uploadBufferToCloudinary(file.buffer, folder, 'auto');
    return uploaded.secure_url;
}

// ---------- Vehicles ----------
app.get('/api/fleet/vehicles', requireAuth, requireModule('fleet_vehicles', 'fleet_trips', 'fleet_maintenance', 'fleet_fuel', 'fleet_report'), async (req, res) => {
    try {
        const list = await Vehicle.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 });
        res.json(list);
    } catch (err) {
        logError('Fleet get vehicles error:', err);
        res.status(500).json({ error: 'ተሽከርካሪዎችን ማምጣት አልተቻለም' });
    }
});

app.get('/api/fleet/vehicles/trash/list', requireAdmin, async (req, res) => {
    try {
        const list = await Vehicle.find({ isDeleted: true }).sort({ deletedAt: -1 });
        res.json(list);
    } catch (err) {
        logError('Fleet vehicle trash error:', err);
        res.status(500).json({ error: 'ትራሹን ማምጣት አልተቻለም' });
    }
});

function buildVehicleData(body) {
    const status = VALID_VEHICLE_STATUS.includes(body.status) ? body.status : 'active';
    return {
        plateNumber: String(body.plateNumber || '').trim(),
        vehicleType: String(body.vehicleType || '').trim(),
        model: String(body.model || '').trim(),
        chassisNumber: String(body.chassisNumber || '').trim(),
        driverName: String(body.driverName || '').trim(),
        currentKm: toNum(body.currentKm, 0),
        status,
        fuelType: body.fuelType === 'ቤንዚን' ? 'ቤንዚን' : 'ናፍጣ',
        kmPerLiter: toNum(body.kmPerLiter, 0),
        documents: parseVehicleDocuments(body.documents)
    };
}

app.post('/api/fleet/vehicles', requireAuth, requireModule('fleet_vehicles'), requirePermission('prepare'), upload.single('photo'), async (req, res) => {
    try {
        const data = buildVehicleData(req.body);
        if (!data.plateNumber) return res.status(400).json({ error: 'የሰሌዳ ቁጥር ያስፈልጋል' });
        if (!data.vehicleType) return res.status(400).json({ error: 'የመኪናው አይነት ያስፈልጋል' });
        if (data.currentKm < 0 || data.kmPerLiter < 0) return res.status(400).json({ error: 'ኪሎሜትር አሉታዊ መሆን አይችልም' });

        const duplicate = await Vehicle.findOne({ plateNumber: data.plateNumber, isDeleted: { $ne: true } });
        if (duplicate) return res.status(400).json({ error: 'ይህ ሰሌዳ ቁጥር ቀድሞ ተመዝግቧል' });

        if (req.file) {
            try { data.photo = await uploadFleetFile(req.file, 'fountain-fleet'); }
            catch (upErr) {
                logError('Fleet vehicle photo upload error:', upErr);
                return res.status(500).json({ error: 'የመኪናውን ፎቶ መጫን አልተቻለም (Cloudinary ቅንብርን ያረጋግጡ)። ያለ ፎቶ ይሞክሩ።' });
            }
        }
        const vehicle = await Vehicle.create(data);
        res.json(vehicle);
    } catch (err) {
        logError('Fleet add vehicle error:', err);
        res.status(500).json({ error: 'ተሽከርካሪውን መመዝገብ አልተቻለም (የሰርቨር ስህተት)' });
    }
});

app.put('/api/fleet/vehicles/:id', requireAuth, requireModule('fleet_vehicles'), requirePermission('prepare'), upload.single('photo'), async (req, res) => {
    try {
        const data = buildVehicleData(req.body);
        if (!data.plateNumber) return res.status(400).json({ error: 'የሰሌዳ ቁጥር ያስፈልጋል' });
        if (!data.vehicleType) return res.status(400).json({ error: 'የመኪናው አይነት ያስፈልጋል' });

        const duplicate = await Vehicle.findOne({ plateNumber: data.plateNumber, isDeleted: { $ne: true }, _id: { $ne: req.params.id } });
        if (duplicate) return res.status(400).json({ error: 'ይህ ሰሌዳ ቁጥር ለሌላ ተሽከርካሪ ተመዝግቧል' });

        if (req.file) {
            try { data.photo = await uploadFleetFile(req.file, 'fountain-fleet'); }
            catch (upErr) {
                logError('Fleet vehicle photo upload error:', upErr);
                return res.status(500).json({ error: 'የመኪናውን ፎቶ መጫን አልተቻለም' });
            }
        }
        const updated = await Vehicle.findByIdAndUpdate(req.params.id, data, { new: true });
        if (!updated) return res.status(404).json({ error: 'ተሽከርካሪው አልተገኘም' });
        res.json(updated);
    } catch (err) {
        logError('Fleet update vehicle error:', err);
        res.status(500).json({ error: 'ማሻሻል አልተቻለም' });
    }
});

app.delete('/api/fleet/vehicles/:id', requireAuth, requireModule('fleet_vehicles'), requirePermission('prepare'), async (req, res) => {
    try {
        const v = await Vehicle.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
        if (!v) return res.status(404).json({ error: 'ተሽከርካሪው አልተገኘም' });
        res.json({ message: 'ወደ ትራሽ ተልኳል' });
    } catch (err) {
        logError('Fleet delete vehicle error:', err);
        res.status(500).json({ error: 'ማጥፋት አልተቻለም' });
    }
});

app.post('/api/fleet/vehicles/:id/restore', requireAdmin, async (req, res) => {
    try {
        const v = await Vehicle.findByIdAndUpdate(req.params.id, { isDeleted: false, deletedAt: null }, { new: true });
        if (!v) return res.status(404).json({ error: 'ተሽከርካሪው አልተገኘም' });
        res.json(v);
    } catch (err) {
        logError('Fleet restore vehicle error:', err);
        res.status(500).json({ error: 'መመለስ አልተቻለም' });
    }
});

// ---------- Fuel price settings & departments ----------
app.get('/api/fleet/settings', requireAuth, requireModule('fleet_vehicles', 'fleet_trips', 'fleet_maintenance', 'fleet_fuel', 'fleet_report'), async (req, res) => {
    try {
        const s = await getFleetSettings();
        res.json({ dieselPricePerLiter: s.dieselPricePerLiter, benzinePricePerLiter: s.benzinePricePerLiter });
    } catch (err) {
        logError('Fleet get settings error:', err);
        res.status(500).json({ error: 'ቅንብር ማምጣት አልተቻለም' });
    }
});
app.put('/api/fleet/settings', requireAdmin, async (req, res) => {
    try {
        const diesel = toNum(req.body.dieselPricePerLiter, 0);
        const benzine = toNum(req.body.benzinePricePerLiter, 0);
        if (diesel < 0 || benzine < 0) return res.status(400).json({ error: 'ዋጋ አሉታዊ መሆን አይችልም' });
        const s = await FleetSettings.findOneAndUpdate(
            { key: 'main' },
            { dieselPricePerLiter: diesel, benzinePricePerLiter: benzine },
            { new: true, upsert: true }
        );
        res.json({ dieselPricePerLiter: s.dieselPricePerLiter, benzinePricePerLiter: s.benzinePricePerLiter });
    } catch (err) {
        logError('Fleet save settings error:', err);
        res.status(500).json({ error: 'ማስቀመጥ አልተቻለም' });
    }
});
app.get('/api/fleet/departments', requireAuth, requireModule('fleet_trips', 'fleet_report'), (req, res) => {
    res.json(FLEET_DEPARTMENTS);
});

// ---------- Trips (የአጠቃቀም ምዝገባ) ----------
app.get('/api/fleet/trips', requireAuth, requireModule('fleet_trips', 'fleet_report'), async (req, res) => {
    try {
        // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD — used by the weekly/range
        // report. Without them the list behaves exactly as before.
        const isoRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = isoRe.test(req.query.from || '') ? req.query.from : null;
        const to = isoRe.test(req.query.to || '') ? req.query.to : null;
        if (from || to) {
            const range = {};
            if (from) range.$gte = from;
            if (to) range.$lte = to;
            const ranged = await Trip.find({ ...fleetScope(req), tripDate: range }).sort({ tripDate: 1, createdAt: 1 }).limit(5000);
            return res.json(ranged);
        }
        const list = await Trip.find(fleetScope(req)).sort({ tripDate: -1, createdAt: -1 }).limit(500);
        res.json(list);
    } catch (err) {
        logError('Fleet get trips error:', err);
        res.status(500).json({ error: 'የአጠቃቀም ምዝገባ ማምጣት አልተቻለም' });
    }
});
app.post('/api/fleet/trips', requireAuth, requireModule('fleet_trips'), requirePermission('prepare'), async (req, res) => {
    try {
        const { department, vehicleId, destination, tripDate, departureTime } = req.body;
        const departureKm = toNum(req.body.departureKm, NaN);
        const returnKm = toNum(req.body.returnKm, NaN);
        if (!department || !vehicleId || !tripDate) return res.status(400).json({ error: 'ዲፓርትመንት፣ ተሽከርካሪ እና ቀን ያስፈልጋሉ' });
        if (isNaN(departureKm) || isNaN(returnKm)) return res.status(400).json({ error: 'የወጣበት እና የተመለሰበት ኪሎሜትር ያስፈልጋል' });
        if (returnKm < departureKm) return res.status(400).json({ error: 'የተመለሰበት ኪሜ ከወጣበት ኪሜ ያንሳል' });

        const vehicle = await Vehicle.findOne({ _id: vehicleId, isDeleted: { $ne: true } });
        if (!vehicle) return res.status(404).json({ error: 'ተሽከርካሪው አልተገኘም' });

        // The server always recomputes distance and fuel cost itself.
        const distanceKm = returnKm - departureKm;
        const settings = await getFleetSettings();
        const pricePerLiter = vehicle.fuelType === 'ቤንዚን' ? settings.benzinePricePerLiter : settings.dieselPricePerLiter;
        const estimatedFuelCost = vehicle.kmPerLiter > 0
            ? Math.round(distanceKm * (pricePerLiter / vehicle.kmPerLiter) * 100) / 100
            : 0;

        const trip = await Trip.create({
            userId: req.authUser.id,
            vehicleId: vehicle._id.toString(),
            vehiclePlate: vehicle.plateNumber,
            vehicleType: vehicle.vehicleType,
            department,
            destination: String(destination || '').trim() || '*',
            tripDate,
            departureTime: departureTime || '',
            departureKm, returnKm, distanceKm, estimatedFuelCost
        });

        if (returnKm > (vehicle.currentKm || 0)) {
            vehicle.currentKm = returnKm;
            await vehicle.save();
        }
        res.json(trip);
    } catch (err) {
        logError('Fleet add trip error:', err);
        res.status(500).json({ error: 'መመዝገብ አልተቻለም' });
    }
});
app.delete('/api/fleet/trips/:id', requireAuth, requireModule('fleet_trips'), requirePermission('prepare'), async (req, res) => {
    try {
        const trip = await Trip.findById(req.params.id);
        if (!trip) return res.status(404).json({ error: 'ምዝገባው አልተገኘም' });
        if (req.authUser.role !== 'Admin' && trip.userId !== req.authUser.id) {
            return res.status(403).json({ error: 'የሌላ ሰው ምዝገባ መሰረዝ አይችሉም' });
        }
        await trip.deleteOne();
        res.json({ message: 'ተሰርዟል' });
    } catch (err) {
        logError('Fleet delete trip error:', err);
        res.status(500).json({ error: 'ማጥፋት አልተቻለም' });
    }
});

// ---------- Maintenance (with prepare → send → approve workflow) ----------
app.get('/api/fleet/maintenance', requireAuth, requireModule('fleet_maintenance'), async (req, res) => {
    try {
        const list = await Maintenance.find(maintenanceScope(req)).sort({ date: -1, createdAt: -1 }).limit(500);
        res.json(list);
    } catch (err) {
        logError('Fleet get maintenance error:', err);
        res.status(500).json({ error: 'የጥገና ምዝገባ ማምጣት አልተቻለም' });
    }
});
app.post('/api/fleet/maintenance', requireAuth, requireModule('fleet_maintenance'), requirePermission('prepare'), upload.single('receipt'), async (req, res) => {
    try {
        const { vehicleId, date, maintenanceType, garage, description, nextServiceDate } = req.body;
        if (!vehicleId || !date) return res.status(400).json({ error: 'ተሽከርካሪ እና ቀን ያስፈልጋሉ' });
        const cost = toNum(req.body.cost, NaN);
        if (isNaN(cost) || cost < 0) return res.status(400).json({ error: 'ትክክለኛ ወጪ ያስገቡ' });

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ error: 'ተሽከርካሪው አልተገኘም' });

        let receipt = '';
        if (req.file) {
            try { receipt = await uploadFleetFile(req.file, 'fountain-fleet-receipts'); }
            catch (upErr) {
                logError('Fleet maintenance receipt upload error:', upErr);
                return res.status(500).json({ error: 'ደረሰኙን መጫን አልተቻለም' });
            }
        }
        const item = await Maintenance.create({
            userId: req.authUser.id,
            vehicleId: vehicle._id.toString(),
            vehiclePlate: vehicle.plateNumber,
            vehicleType: vehicle.vehicleType,
            date,
            odometerKm: toNum(req.body.odometerKm, 0),
            maintenanceType: ['routine', 'repair'].includes(maintenanceType) ? maintenanceType : 'routine',
            cost,
            garage: String(garage || '').trim(),
            description: String(description || '').trim(),
            nextServiceKm: toNum(req.body.nextServiceKm, null),
            nextServiceDate: nextServiceDate || '',
            receipt
        });
        res.json(item);
    } catch (err) {
        logError('Fleet add maintenance error:', err);
        res.status(500).json({ error: 'መመዝገብ አልተቻለም' });
    }
});
app.delete('/api/fleet/maintenance/:id', requireAuth, requireModule('fleet_maintenance'), requirePermission('prepare'), async (req, res) => {
    try {
        const item = await Maintenance.findById(req.params.id);
        if (!item) return res.status(404).json({ error: 'ምዝገባው አልተገኘም' });
        if (req.authUser.role !== 'Admin' && item.userId !== req.authUser.id) {
            return res.status(403).json({ error: 'የሌላ ሰው ምዝገባ መሰረዝ አይችሉም' });
        }
        if (item.preparedBy && item.preparedBy.userId) {
            return res.status(400).json({ error: 'የተፈረመበትን ምዝገባ መሰረዝ አይቻልም' });
        }
        await item.deleteOne();
        res.json({ message: 'ተሰርዟል' });
    } catch (err) {
        logError('Fleet delete maintenance error:', err);
        res.status(500).json({ error: 'ማጥፋት አልተቻለም' });
    }
});
// Same rules as POST /api/records/:id/sign: signature password every time,
// preparer must pick one approver, only that approver (or an Admin) approves.
app.post('/api/fleet/maintenance/:id/sign', requireAuth, requireModule('fleet_maintenance'), async (req, res) => {
    try {
        const { slot, signaturePassword, sendToApproverId } = req.body;
        if (!['prepared', 'approved'].includes(slot)) return res.status(400).json({ error: 'ልክ ያልሆነ የፊርማ ቦታ' });

        const requesterUser = await User.findById(req.authUser.id);
        if (!requesterUser) return res.status(401).json({ error: 'ተጠቃሚው አልተገኘም' });
        if (slot === 'prepared' && !hasPermission(requesterUser, 'prepare')) {
            return res.status(403).json({ error: 'ይህን ለማድረግ ተገቢው ኃላፊነት የለዎትም' });
        }
        if (slot === 'approved' && !hasPermission(requesterUser, 'approve')) {
            return res.status(403).json({ error: 'ይህን ለማጽደቅ ፈቃድ የለዎትም' });
        }

        const sig = await Signature.findOne({ userId: req.authUser.id });
        if (!sig) return res.status(400).json({ error: 'መጀመሪያ የራስዎን ፊርማ ይመዝገቡ' });
        const matches = await bcrypt.compare(signaturePassword || '', sig.signaturePasswordHash);
        if (!matches) return res.status(401).json({ error: 'የፊርማ ፓስወርድ ትክክል አይደለም' });

        const item = await Maintenance.findById(req.params.id);
        if (!item) return res.status(404).json({ error: 'ምዝገባው አልተገኘም' });
        if (slot === 'prepared' && requesterUser.role !== 'Admin' && item.userId !== req.authUser.id) {
            return res.status(403).json({ error: 'በሌላ ሰው የተመዘገበ ምዝገባ ላይ እንደ «ያዘጋጀው» መፈረም አይችሉም' });
        }

        const signaturePayload = {
            userId: sig.userId, fullName: sig.fullName, responsibility: sig.responsibility,
            signatureImage: sig.signatureImage, signedAt: new Date()
        };
        const update = {};
        let notifyApproverId = null;

        if (slot === 'prepared') {
            if (!sendToApproverId) return res.status(400).json({ error: 'እባክዎ ማጽደቅ ያለበትን ሰው ይምረጡ' });
            const approverUser = await User.findById(sendToApproverId);
            if (!approverUser || approverUser.status !== 'approved' || !hasPermission(approverUser, 'approve')) {
                return res.status(400).json({ error: 'የመረጡት ሰው ማጽደቅ የሚያስችል ኃላፊነት የለውም' });
            }
            const approverSig = await Signature.findOne({ userId: sendToApproverId });
            if (!approverSig) return res.status(400).json({ error: 'የመረጡት ሰው ገና ፊርማ አልመዘገበም' });
            update.preparedBy = signaturePayload;
            update.approval = { pendingApproverId: sendToApproverId, pendingApproverName: approverSig.fullName, requestedAt: new Date() };
            notifyApproverId = sendToApproverId;
        } else {
            const isAssigned = item.approval && item.approval.pendingApproverId === req.authUser.id;
            if (!isAssigned && requesterUser.role !== 'Admin') {
                return res.status(403).json({ error: 'ይህ ምዝገባ ለእርስዎ ማጽደቅ ገና አልተላከም' });
            }
            update.approvedBy = signaturePayload;
            update.approval = { pendingApproverId: null, pendingApproverName: null, requestedAt: item.approval ? item.approval.requestedAt : null };
        }

        const updated = await Maintenance.findByIdAndUpdate(req.params.id, update, { new: true });
        const label = `${updated.vehiclePlate} ጥገና`;
        try {
            if (notifyApproverId) {
                await Notification.create({
                    toUserId: notifyApproverId, type: 'approval_request', module: 'fleet_maintenance',
                    recordId: updated._id.toString(), recordName: label,
                    fromUserId: sig.userId, fromFullName: sig.fullName,
                    message: `${sig.fullName} "${label}" የተባለውን የጥገና ምዝገባ እንዲያጸድቁ ልከውልዎታል።`
                });
            } else if (slot === 'approved' && updated.userId) {
                await Notification.create({
                    toUserId: updated.userId, type: 'approved', module: 'fleet_maintenance',
                    recordId: updated._id.toString(), recordName: label,
                    fromUserId: sig.userId, fromFullName: sig.fullName,
                    message: `${sig.fullName} "${label}" የተባለውን የጥገና ምዝገባ አጽድቀዋል።`
                });
            }
        } catch (notifErr) {
            logError('Create fleet notification error:', notifErr);
        }
        res.json(updated);
    } catch (err) {
        logError('Sign maintenance error:', err);
        res.status(500).json({ error: 'ፊርማ ማድረግ አልተቻለም' });
    }
});

// ---------- Fuel log (actual receipts) ----------
app.get('/api/fleet/fuel-logs', requireAuth, requireModule('fleet_fuel'), async (req, res) => {
    try {
        const list = await FuelLog.find(fleetScope(req)).sort({ date: -1, createdAt: -1 }).limit(500);
        res.json(list);
    } catch (err) {
        logError('Fleet get fuel logs error:', err);
        res.status(500).json({ error: 'የነዳጅ ምዝገባ ማምጣት አልተቻለም' });
    }
});
app.post('/api/fleet/fuel-logs', requireAuth, requireModule('fleet_fuel'), requirePermission('prepare'), upload.single('receipt'), async (req, res) => {
    try {
        const { vehicleId, date, station } = req.body;
        if (!vehicleId || !date) return res.status(400).json({ error: 'ተሽከርካሪ እና ቀን ያስፈልጋሉ' });
        const liters = toNum(req.body.liters, NaN);
        const cost = toNum(req.body.cost, NaN);
        if (isNaN(liters) || liters <= 0) return res.status(400).json({ error: 'ትክክለኛ የሊትር መጠን ያስገቡ' });
        if (isNaN(cost) || cost < 0) return res.status(400).json({ error: 'ትክክለኛ ወጪ ያስገቡ' });

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ error: 'ተሽከርካሪው አልተገኘም' });

        let receipt = '';
        if (req.file) {
            try { receipt = await uploadFleetFile(req.file, 'fountain-fleet-receipts'); }
            catch (upErr) {
                logError('Fleet fuel receipt upload error:', upErr);
                return res.status(500).json({ error: 'ደረሰኙን መጫን አልተቻለም' });
            }
        }
        const log = await FuelLog.create({
            userId: req.authUser.id,
            vehicleId: vehicle._id.toString(),
            vehiclePlate: vehicle.plateNumber,
            vehicleType: vehicle.vehicleType,
            date,
            station: String(station || '').trim(),
            liters, cost,
            odometerKm: toNum(req.body.odometerKm, 0),
            receipt
        });
        res.json(log);
    } catch (err) {
        logError('Fleet add fuel log error:', err);
        res.status(500).json({ error: 'መመዝገብ አልተቻለም' });
    }
});
app.delete('/api/fleet/fuel-logs/:id', requireAuth, requireModule('fleet_fuel'), requirePermission('prepare'), async (req, res) => {
    try {
        const log = await FuelLog.findById(req.params.id);
        if (!log) return res.status(404).json({ error: 'ምዝገባው አልተገኘም' });
        if (req.authUser.role !== 'Admin' && log.userId !== req.authUser.id) {
            return res.status(403).json({ error: 'የሌላ ሰው ምዝገባ መሰረዝ አይችሉም' });
        }
        await log.deleteOne();
        res.json({ message: 'ተሰርዟል' });
    } catch (err) {
        logError('Fleet delete fuel log error:', err);
        res.status(500).json({ error: 'ማጥፋት አልተቻለም' });
    }
});

// Admin Account Initialization — creates the default admin ONLY if it does
// not exist yet. Previously this ran on every server restart and force-reset
// the admin's password back to "123" and role/status to defaults every time
// — meaning if an Admin ever changed their password through the app, the
// very next server restart silently threw that change away. Now an existing
// admin account is left completely untouched; only its role/status are kept
// sane (Admin/approved) so the account can never accidentally get locked out.
async function initAdmin() {
    try {
        const admin = await User.findOne({ username: 'admin' });
        if (!admin) {
            const defaultHashedPassword = await bcrypt.hash('123', SALT_ROUNDS);
            await User.create({ fullName: 'System Admin', username: 'admin', password: defaultHashedPassword, email: 'samuelmekonnentaye@gmail.com', role: 'Admin', status: 'approved' });
            console.log('Default Admin Account Created (username: admin / password: 123 — please change this immediately after first login)');
        } else if (admin.role !== 'Admin' || admin.status !== 'approved') {
            admin.role = 'Admin';
            admin.status = 'approved';
            await admin.save();
            console.log('Existing admin account role/status verified (password left untouched)');
        }
    } catch (err) {
        logError('Error initializing admin:', err);
    }
}
initAdmin();

// Catches multer errors (file too large, wrong file type) so they return a
// clean Amharic message instead of a raw stack trace / hung request.
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || (err && err.message && err.message.includes('አይነት ተቀባይነት'))) {
        return res.status(400).json({ error: err.message === 'File too large' ? 'ፋይሉ በጣም ትልቅ ነው' : err.message });
    }
    next(err);
});

// Prints every LAN address this machine has, so starting the server also
// tells you exactly what to type on your phone's browser — no need to run
// ipconfig/ifconfig separately to find it.
function printLanAddresses(port) {
    const nets = require('os').networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
        }
    }
    console.log(`Server running on http://localhost:${port}`);
    if (addresses.length) {
        console.log('On your phone (same Wi-Fi), open:');
        addresses.forEach(addr => console.log(`  http://${addr}:${port}/login.html`));
    } else {
        console.log('No LAN network address found — connect this computer to Wi-Fi/Ethernet to use it from a phone.');
    }
}
// Cloud hosts (Render, Railway, etc.) assign their own port at runtime via
// the PORT environment variable and route their public URL to it — hardcoding
// 3000 would make the app unreachable once deployed there. Locally, with no
// PORT set, this still falls back to 3000 exactly as before.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => printLanAddresses(PORT));