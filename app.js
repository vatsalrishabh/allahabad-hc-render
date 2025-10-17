require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('./utils/logger');

const app = express();

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files from /public with index.html as default
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// Health and status endpoints
app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    env: {
      node: process.version,
      port: process.env.PORT || 3001,
    },
  });
});

// API routes
const usersRouter = require('./routes/users');
const adminRouter = require('./routes/admin');
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);

// API index route for discoverability
app.get('/api', (req, res) => {
  res.json({
    success: true,
    endpoints: [
      { method: 'GET', path: '/api' },
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/api/status' },
      { method: 'GET', path: '/api/admin/users' },
      { method: 'GET', path: '/api/admin/users/:id' },
      { method: 'POST', path: '/api/admin/users' },
      { method: 'PUT', path: '/api/admin/users/:id' },
      { method: 'DELETE', path: '/api/admin/users/:id' },
      { method: 'GET', path: '/api/admin/cases' },
      { method: 'GET', path: '/api/admin/cases/:id' },
      { method: 'POST', path: '/api/admin/cases' },
      { method: 'PUT', path: '/api/admin/cases/:id/refresh' },
      { method: 'DELETE', path: '/api/admin/cases/:id' },
      { method: 'GET', path: '/api/admin/subscriptions' },
      { method: 'POST', path: '/api/admin/subscriptions' },
      { method: 'DELETE', path: '/api/admin/subscriptions/:id' },
      { method: 'GET', path: '/api/admin/cino-numbers' },
      { method: 'GET', path: '/api/admin/cino-numbers/:cino' },
      { method: 'POST', path: '/api/admin/cino-numbers' },
      { method: 'PUT', path: '/api/admin/cino-numbers/:cino' },
      { method: 'DELETE', path: '/api/admin/cino-numbers/:cino' },
      { method: 'POST', path: '/api/admin/cino-numbers/:cino/numbers' },
      { method: 'PUT', path: '/api/admin/cino-numbers/:cino/numbers' },
      { method: 'DELETE', path: '/api/admin/cino-numbers/:cino/numbers' },
      { method: 'POST', path: '/api/admin/cino-numbers/:cino/send' },
    ],
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: 'Route not found', path: req.originalUrl });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ success: false, message: 'Internal Server Error', error: err?.message || 'Unknown error' });
});

// Server startup
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ahc-updates';

async function start() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
    logger.info('MongoDB connected');
  } catch (err) {
    logger.warn(`MongoDB connection failed: ${err.message}`);
  }

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}/`);
  });
}

start();

process.on('SIGINT', () => {
  console.log('Shutting down...');
  mongoose.connection.close().catch(() => {});
  process.exit(0);
});