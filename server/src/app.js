import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

const app = express();
app.disable('x-powered-by');
// Online (Render) the API sits behind a proxy: needed so rate limiting sees each visitor's real address.
if (env.isProd) app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.clientUrls, credentials: true, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '1mb' }));
if (!env.isProd) app.use(morgan('dev'));

// Opening the API address in a browser shows that it is alive.
app.get('/', (_req, res) => res.json({ name: env.company.en, service: 'work-plan-api', status: 'ok' }));

app.use('/api', apiLimiter, routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
