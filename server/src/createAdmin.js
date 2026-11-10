// Creates the first System Admin. Use it on a NEW or ONLINE database instead of the demo data:
//
//   npm run create-admin -- "Full Name" admin@yourcompany.com "StrongPassword123"
//
// To run it against the online database (MongoDB Atlas) from your own computer, set MONGO_URI first:
//   $env:MONGO_URI = 'mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/fountain_work_plan'
import './config/env.js';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import { ROLES } from './config/roles.js';

const [fullName, emailRaw, password] = process.argv.slice(2);
const fail = (msg) => {
  console.error(`\n${msg}\n`);
  console.error('Usage:  npm run create-admin -- "Full Name" admin@yourcompany.com "StrongPassword123"\n');
  process.exit(1);
};

if (!fullName || !emailRaw || !password) fail('Please give the full name, the e-mail and the password.');
const email = emailRaw.trim().toLowerCase();
if (fullName.trim().length < 3) fail('The full name is too short.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('That does not look like an e-mail address.');
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  fail('The password must have at least 10 characters, with letters and numbers.');
}

await connectDB();
if (await User.exists({ email })) {
  console.log(`\nAn account with ${email} already exists. Nothing was changed.\n`);
} else {
  await User.create({ fullName: fullName.trim(), email, password, roles: [ROLES.ADMIN] });
  console.log(`\nSystem Admin created: ${email}\nYou can sign in now. Change the password after the first sign-in.\n`);
}
await mongoose.disconnect();
