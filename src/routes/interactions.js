const express = require('express');
const router = express.Router();
const Interaction = require('../models/Interaction');
const User = require('../models/User');
const Listing = require('../models/Listing');

const VALID_TYPES = ['view', 'save', 'contact'];

// POST /api/interactions - Record a user interaction (view, save, contact)
router.post('/', async (req, res) => {
  try {
    const { userId, listingId, type } = req.body;

    if (!userId || !listingId || !type) {
      return res.status(400).json({ error: 'userId, listingId, and type are all required' });
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        error: `Invalid interaction type: "${type}". Must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    // Validate that user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({ error: `User with id "${userId}" not found` });
    }

    // Validate that listing exists
    const listingExists = await Listing.exists({ listingId });
    if (!listingExists) {
      return res.status(404).json({ error: `Listing with listingId "${listingId}" not found` });
    }

    // Prevent duplicate SAVE records for the same user and listing
    if (type === 'save') {
      const existing = await Interaction.findOne({ userId, listingId, type: 'save' });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'Listing already saved',
          interaction: existing,
          alreadySaved: true,
        });
      }
    }

    const interaction = await Interaction.create({
      userId,
      listingId,
      type,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Interaction recorded',
      interaction,
    });
  } catch (error) {
    if (error.code === 11000 && req.body && req.body.type === 'save') {
      const existing = await Interaction.findOne({
        userId: req.body.userId,
        listingId: req.body.listingId,
        type: 'save',
      });
      return res.status(200).json({
        success: true,
        message: 'Listing already saved',
        interaction: existing,
        alreadySaved: true,
      });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
