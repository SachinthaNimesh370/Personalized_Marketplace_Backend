const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Listing = require('../models/Listing');
const Interaction = require('../models/Interaction');
const { rank } = require('../services/recommendationService');
const { getImageUrl } = require('../services/s3Service');

// GET /api/recommendations?userId=... - Ranked personalized feed with reasons and presigned images
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'valid userId required' });
    }

    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({ error: `User with id "${userId}" not found` });
    }

    const [listings, interactions] = await Promise.all([
      Listing.find().lean(),
      Interaction.find({ userId }).lean(),
    ]);

    const ranked = rank(listings, interactions).slice(0, 20);

    const savedListingIds = new Set(
      interactions.filter((i) => i.type === 'save').map((i) => i.listingId)
    );

    const feed = await Promise.all(
      ranked.map(async (r) => ({
        ...r.listing,
        score: r.score,
        reasons: r.reasons,
        imageUrl: await getImageUrl(r.listing.imageKey),
        isSaved: savedListingIds.has(r.listing.listingId),
      }))
    );

    res.json(feed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
