import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import leadsRouter from './routes/leads.js';
import oauthRouter from './routes/oauth.js';
import campaignsRouter from './routes/campaigns.js';
import schedulerRouter from './routes/scheduler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Serve frontend static files
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// API Routes
app.use('/leads', leadsRouter);
app.use('/oauth', oauthRouter);
app.use('/campaigns', campaignsRouter);
app.use('/scheduler', schedulerRouter);

// Basic health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fallback to index.html for single page app routing (if needed)
app.get('*', (req, res, next) => {
  if (req.url.startsWith('/leads') || req.url.startsWith('/health') || req.url.startsWith('/oauth')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);

  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'A lead with this phone number already exists under the specified tenant.'
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred.'
  });
});

export default app;
