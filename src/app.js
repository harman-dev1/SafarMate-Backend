import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { ENV } from './config/env.js';
import errorHandler from './middleware/errorHandler.js';

import authRoutes from './routes/auth.routes.js';
import searchRoutes from './routes/search.routes.js';
import routeRoutes from './routes/route.routes.js';
import nearbyRoutes from './routes/nearby.routes.js';
import userRoutes from './routes/user.routes.js';
import weatherRoutes from './routes/weather.routes.js';
import incidentRoutes from './routes/incident.routes.js';

const app = express();

app.use(helmet());
app.use(compression());
app.use(cors({ origin: ENV.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (ENV.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use(
  '/api',
  rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false })
);

app.get('/api/health', (_, res) =>
  res.json({ ok: true, service: 'safarmate-api', time: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/nearby', nearbyRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/incidents', incidentRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use(errorHandler);

export default app;