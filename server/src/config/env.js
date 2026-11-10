import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a long random value (32+ characters) in production.');
}

export const env = {
  isProd,
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fountain_work_plan',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  // allowed web addresses (comma separated); a trailing slash is ignored
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  allowRegistration: String(process.env.ALLOW_REGISTRATION ?? 'true') !== 'false',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'FOUNTAIN INTERNATIONAL TRADING PLC <no-reply@fountain.local>',
  },
  company: {
    en: 'FOUNTAIN INTERNATIONAL TRADING PLC',
    am: 'ፋውንቴን ኢንተርናሽናል ትሬዲንግ ኃ/የተ/የግ/ማህበር',
  },
};
