import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
  console.log(`[pid ${process.pid}] MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

// Makes the indexes in the database match the models (also removes indexes left over from older versions).
export async function syncAllIndexes() {
  for (const name of mongoose.modelNames()) {
    try {
      await mongoose.model(name).syncIndexes();
    } catch (e) {
      console.warn(`Could not sync indexes for ${name}: ${e.message}`);
    }
  }
}
