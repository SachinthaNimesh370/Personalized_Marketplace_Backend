const express = require('express');
const router = express.Router();
const Listing = require('../models/Listing');
const { getImageUrl } = require('../services/s3Service');

// GET /api/listings - Get all listings (with image URLs resolved)
router.get('/', async (req, res) => {
  try {
    const listings = await Listing.find().lean();
    const withImages = await Promise.all(
      listings.map(async (l) => ({
        ...l,
        imageUrl: await getImageUrl(l.imageKey),
      }))
    );
    res.json(withImages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
