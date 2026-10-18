const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, ref: 'User' },
    listingId: { type: String, required: true },
    type: { type: String, enum: ['view', 'save', 'contact'], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Indexes specified in Developer Guide section 6
interactionSchema.index({ userId: 1, listingId: 1 });
interactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Interaction', interactionSchema);
