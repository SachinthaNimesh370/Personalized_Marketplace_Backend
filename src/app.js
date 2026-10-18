const express = require('express');
const cors = require('cors');

// Import routes
const usersRouter = require('./routes/users');
const listingsRouter = require('./routes/listings');
const interactionsRouter = require('./routes/interactions');
const recommendationsRouter = require('./routes/recommendations');

const path = require('path');

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || '*',
    credentials: true,
  })
);
app.use(express.json());
app.use('/static/images', express.static(path.join(__dirname, '../scripts/sample-images')));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'PrimeMarket Backend is running',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/users', usersRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/interactions', interactionsRouter);
app.use('/api/recommendations', recommendationsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

module.exports = app;
