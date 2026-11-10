import { env } from './config/env.js';
import mongoose from 'mongoose';
import app from './app.js';
import { connectDB, syncAllIndexes } from './config/db.js';
import { startReminders } from './services/reminders.js';
import { startMeetingReminders } from './services/meetingReminders.js';

async function main() {
  // Safety net: never start twice in the same process (and show who called it).
  if (globalThis.__fitApiStarted) {
    console.warn(`[pid ${process.pid}] main() was called a second time - ignored. Caller:`, new Error().stack);
    return;
  }
  globalThis.__fitApiStarted = true;

  try {
    await connectDB();
  } catch (e) {
    console.error('\nCould not connect to MongoDB at', env.mongoUri);
    console.error('Make sure MongoDB is installed and running (or put your Atlas URL in server/.env as MONGO_URI).\n');
    console.error(e.message);
    process.exit(1);
  }
  await syncAllIndexes();
  const server = app.listen(env.port, () => {
    console.log(`[pid ${process.pid}] ${env.company.en} - API listening on http://localhost:${env.port}`);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `[pid ${process.pid}] Port ${env.port} is already in use (another copy of the API is running, or another program uses it).` : e);
    process.exit(1);
  });
  startReminders();
  startMeetingReminders();

  const stop = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main();
