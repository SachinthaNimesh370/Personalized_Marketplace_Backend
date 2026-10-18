const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    category: { type: String, enum: ['property', 'vehicle'], required: true, index: true },
    location: { type: String, required: true, index: true },
    price: { type: Number, required: true },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      // For property: { propertyType: "apartment" | "house" | "land", bedrooms: Number }
      // For vehicle: { make: "Toyota" | "Honda" | "Suzuki" | ..., model: String, year: Number }
    },
    imageKey: { type: String, default: null },
    popularity: { type: Number, min: 0, max: 100, default: 50 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Listing', listingSchema);
