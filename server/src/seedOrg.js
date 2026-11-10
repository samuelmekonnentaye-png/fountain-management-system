// Loads the company's organisation chart only (no demo people). Safe for the online database.
//   npm run seed:org
import './config/env.js';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { importOrg } from './services/orgImport.js';

await connectDB();
const r = await importOrg();
console.log(`\nOrganisation chart loaded: ${r.unitsCreated} of ${r.unitsTotal} units and ${r.positionsCreated} of ${r.positionsTotal} positions were new.\n`);
await mongoose.disconnect();
