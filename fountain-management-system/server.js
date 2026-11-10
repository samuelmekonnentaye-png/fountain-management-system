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
app.use(express.json());
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
    if (!payload) {
        return res.status(401).json({ error: 'እባክዎ እንደገና ይግቡ (session ጊዜው አልቆ ወይም ልክ ያልሆነ ነው)።' });
    }
    req.authUser = payload;
    next();
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
    // "Forgot password" flow: a short-lived 6-digit code emailed to the
    // account's address. Only its hash is stored (same idea as a password),
    // and it expires after RESET_CODE_TTL_MS so an old email can't be reused.
    resetCodeHash: { type: String, default: null },
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
            const user = await User.findById(req.authUser.id);
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

        const records = await Record.find();

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
                                <p>ሰላም <strong>${user.fullName || user.username}</strong>፣</p>
                                <p>የተመዘገበው <strong>[${record.category}] ${record.name}</strong> ${isOverdue ? `የማብቂያ ቀኑ ካለፈ <strong>${Math.abs(diffDays)} ቀናት</strong> ሆኖታል፣ እባክዎ በአስቸኳይ ያድሱት።` : `የሚያበቃበት ቀን በ<strong>${diffDays} ቀናት</strong> ውስጥ ስለሆነ አስፈላጊውን ክትትል እንዲያደርጉ እናስታውሳለን።`}</p>
                                <hr />
                                <ul>
                                    <li><strong>ስም/መግለጫ፦</strong> ${record.name}</li>
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

// API 1: Login with Status Check (የተስተካከለ የሎጊን ክፍል)
app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
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
            return res.status(401).json({ error: 'የተሳሳተ የባለቤት ስም ወይም የይለፍ ቃል!' });
        }
        if (user.status === 'pending') {
            return res.status(403).json({ error: 'አካውንትዎ ገና በአድሚን አልተፈቀደም (Pending)! እባክዎ በትዕግስት ይጠብቁ።' });
        }
        if (user.status === 'rejected') {
            return res.status(403).json({ error: 'ይህ አካውንት ተቀባይነት አላገኘም (Rejected)።' });
        }
        const token = signToken({ id: user._id.toString(), role: user.role, exp: Date.now() + TOKEN_TTL_MS });
        res.json({ id: user._id, fullName: user.fullName, username: user.username, email: user.email, role: user.role, token });
    } catch (err) {
        // Logged so the real cause (DB connection drop, bad data, etc.) is
        // visible in the server console instead of only showing a generic
        // message to the user.
        logError('Login error:', err);
        res.status(500).json({ error: 'የሰርቨር ስህተት አጋጥሟል' });
    }
});

// API 1.1: Forgot password — request a reset code by username or email.
// Always responds with the same generic message whether or not an account
// was found, so this endpoint can't be used to check which usernames/emails
// exist. If an account IS found, a 6-digit code is emailed to the address
// already on file (never to an address supplied in the request).
app.post('/api/users/forgot-password', async (req, res) => {
    const identifier = (req.body.identifier || '').trim();
    const genericResponse = { message: 'መለያ ካለ ወደ ኢሜይልዎ የማረጋገጫ ኮድ ተልኳል። እባክዎ ኢሜይልዎን ያረጋግጡ።' };
    try {
        if (!identifier) return res.json(genericResponse);

        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        if (!user || !user.email) return res.json(genericResponse);

        const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
        user.resetCodeHash = await bcrypt.hash(code, SALT_ROUNDS);
        user.resetCodeExpires = new Date(Date.now() + RESET_CODE_TTL_MS);
        await user.save();

        try {
            await transporter.sendMail({
                from: `"Fountain International Trading" <${EMAIL_USER}>`,
                to: user.email,
                subject: '🔑 የይለፍ ቃል መቀየሪያ ኮድ (Password Reset Code)',
                html: `
                    <p>ሰላም ${user.fullName || user.username},</p>
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
    const identifier = (req.body.identifier || '').trim();
    const code = (req.body.code || '').trim();
    try {
        if (!identifier || !code) {
            return res.status(400).json({ error: 'እባክዎ ኮዱን ያስገቡ' });
        }
        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
            return res.status(400).json({ error: 'ልክ ያልሆነ ወይም ጊዜው ያለፈበት ኮድ' });
        }
        if (user.resetCodeExpires.getTime() < Date.now()) {
            return res.status(400).json({ error: 'የኮዱ ጊዜ አልቋል፣ አዲስ ኮድ ይጠይቁ' });
        }
        const matches = await bcrypt.compare(code, user.resetCodeHash);
        if (!matches) {
            return res.status(400).json({ error: 'ልክ ያልሆነ ኮድ' });
        }
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
        if (!identifier || !code || !newPassword) {
            return res.status(400).json({ error: 'እባክዎ ሁሉንም መስኮች ይሙሉ' });
        }
        if (newPassword.length < 4) {
            return res.status(400).json({ error: 'አዲሱ የይለፍ ቃል ቢያንስ 4 ፊደል/ቁጥር ሊኖረው ይገባል' });
        }

        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
        if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
            return res.status(400).json({ error: 'ልክ ያልሆነ ወይም ጊዜው ያለፈበት ኮድ' });
        }
        if (user.resetCodeExpires.getTime() < Date.now()) {
            return res.status(400).json({ error: 'የኮዱ ጊዜ አልቋል፣ አዲስ ኮድ ይጠይቁ' });
        }
        const matches = await bcrypt.compare(code, user.resetCodeHash);
        if (!matches) {
            return res.status(400).json({ error: 'ልክ ያልሆነ ኮድ' });
        }

        user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
        user.resetCodeHash = null;
        user.resetCodeExpires = null;
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
    const { fullName, username, password, email, role, status, permissions } = req.body;
    try {
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ error: 'ይህ የተጠቃሚ ስም አስቀድሞ ተይዟል!' });

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const payload = verifyToken(token);
        const requesterIsAdmin = !!(payload && payload.role === 'Admin');

        // Only an Admin sets responsibilities directly at registration time —
        // a public self-signup always starts as a plain 'prepare' account
        // until an Admin deliberately grants anything more.
        let finalPermissions = ['prepare'];
        if (requesterIsAdmin && Array.isArray(permissions)) {
            finalPermissions = permissions.filter(p => VALID_PERMISSIONS.includes(p));
            if (finalPermissions.length === 0) finalPermissions = ['prepare'];
        }

        const newUser = new User({ 
            fullName, 
            username, 
            password: hashedPassword, 
            email, 
            role: requesterIsAdmin ? (role || 'Employee') : 'Employee',
            status: (status === 'approved' && requesterIsAdmin) ? 'approved' : 'pending',
            permissions: finalPermissions
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
        const users = await User.find({}, '-password');
        res.json(users);
    } catch (err) {
        logError('Get users error:', err);
        res.status(500).json({ error: 'ተጠቃሚዎችን ማምጣት አልተቻለም!' });
    }
});

// API 3.1: Update User Status (Approve or Reject by Admin)
app.put('/api/users/status/:id', requireAdmin, async (req, res) => {
    const { status } = req.body; 
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
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
        const user = await User.findByIdAndUpdate(req.params.id, { permissions }, { new: true, fields: '-password' });
        if (!user) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም!' });
        res.json(user);
    } catch (err) {
        logError('Update permissions error:', err);
        res.status(500).json({ error: 'ኃላፊነቶችን ማዘመን አልተቻለም' });
    }
});

// API 3.2: Delete User (Admin only) — was missing; the "ሰርዝ" button in the dashboard already relies on this.
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
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
        res.json(records);
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
        res.json(records);
    } catch (err) {
        logError('Get trash error:', err);
        res.status(500).json({ error: 'ትራሽን ማምጣት አልተቻለም' });
    }
});

// API 5.2: Restore a soft-deleted record — brings it back into every normal
// list and back into financial totals, exactly as it was before deletion.
app.post('/api/trash/:id/restore', requireAuth, requirePermission('prepare'), async (req, res) => {
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
        res.json(events);
    } catch (err) {
        logError('Get financial events error:', err);
        res.status(500).json({ error: 'የፋይናንስ መረጃ ማምጣት አልተቻለም' });
    }
});

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
app.post('/api/records', requireAuth, requirePermission('prepare'), upload.single('file'), async (req, res) => {
    try {
        const validationError = validateRecordInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        const recordData = req.body;
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
app.put('/api/records/:id', requireAuth, requirePermission('prepare'), upload.single('file'), async (req, res) => {
    try {
        const validationError = validateRecordInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        // Archive the record exactly as it was before this update, so
        // renewing a contract/payment no longer permanently erases its
        // previous due date, amount, or history.
        const existing = await Record.findById(req.params.id);
        if (existing) {
            await RecordHistory.create({ recordId: req.params.id, snapshot: existing.toObject() });
        }

        const recordData = req.body;
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
app.get('/api/records/:id/history', requireAuth, async (req, res) => {
    try {
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