const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Interaction = require('../models/Interaction');

// GET /api/users - List the predefined test users
router.get('/', async (req, res) => {
  try {
    const users = await User.find().lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/:id/interactions - Useful for debugging/demo
router.get('/:id/interactions', async (req, res) => {
  try {
    const { id } = req.params;
    const interactions = await Interaction.find({ userId: id }).sort({ createdAt: -1 }).lean();
    res.json(interactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
