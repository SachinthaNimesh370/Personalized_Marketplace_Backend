// server/src/seed/seed.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Interaction = require('../models/Interaction');

const usersData = require('./users.json');
const listingsData = require('./listings.json');

async function seedDatabase(uri = process.env.MONGODB_URI) {
  try {
    if (!mongoose.connection.readyState) {
      await mongoose.connect(uri);
      console.log('Connected to MongoDB for seeding');
    }

    // 1. Clear existing users and listings (and optional clean interactions)
    await User.deleteMany({});
    await Listing.deleteMany({});
    await Interaction.deleteMany({});

    // 2. Insert predefined test users
    await User.insertMany(usersData);
    console.log(`Seeded ${usersData.length} users.`);

    // 3. Insert listings
    await Listing.insertMany(listingsData);
    console.log(`Seeded ${listingsData.length} listings.`);

    console.log('Database seeded successfully!');
  } catch (error) {
    console.error('Seeding error:', error);
    throw error;
  }
}

if (require.main === module) {
  seedDatabase()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await mongoose.disconnect();
      process.exit(1);
    });
}

module.exports = seedDatabase;
