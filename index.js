require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB Atlas
connectDB();

// Middleware
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'PrimeMarket Backend is running', dbConnected: true });
});

// Placeholder API routes
app.get('/api/users', (req, res) => {
  res.json([]);
});

app.get('/api/listings', (req, res) => {
  res.json([]);
});

app.get('/api/recommendations', (req, res) => {
  res.json([]);
});

app.post('/api/interactions', (req, res) => {
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
