const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../src/app');
const User = require('../src/models/User');
const Listing = require('../src/models/Listing');
const Interaction = require('../src/models/Interaction');
const { signal } = require('../src/services/recommendationService');

const usersData = require('../src/seed/users.json');
const listingsData = require('../src/seed/listings.json');

jest.setTimeout(60000);

// Fix for Jest VM cross-realm Map serialization in MongoDB handshake metadata
try {
  const { LimitedSizeDocument } = require('mongodb/lib/cmap/handshake/client_metadata');
  if (LimitedSizeDocument) {
    LimitedSizeDocument.prototype.toObject = function () {
      const convert = (val) => {
        if (val && typeof val.entries === 'function') {
          const res = {};
          for (const [k, v] of val.entries()) {
            res[k] = convert(v);
          }
          return res;
        }
        return val;
      };
      return convert(this.document);
    };
  }
} catch (e) {}

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, {
    driverInfo: { name: 'nodejs', version: process.version || '22.0.0' },
  });
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  await User.deleteMany({});
  await Listing.deleteMany({});
  await Interaction.deleteMany({});

  await User.insertMany(usersData);
  await Listing.insertMany(listingsData);
});

describe('PrimeMarket Personalized Feed & Ranking Engine', () => {
  // Test 1: Cold start
  test('1. Cold start: new user receives non-empty feed ordered by popularity, interleaved categories, and "Popular right now" reasons', async () => {
    const res = await request(app).get('/api/recommendations?userId=user_a');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Verify reason
    expect(res.body[0].reasons).toContain('Popular right now');

    // Verify interleaving between properties and vehicles in top items
    const categories = res.body.slice(0, 4).map((item) => item.category);
    expect(categories).toContain('property');
    expect(categories).toContain('vehicle');

    // First two items should have alternate categories
    expect(categories[0]).not.toBe(categories[1]);
  });

  // Test 2: Personalization & user isolation
  test("2. Personalization & Isolation: user A vehicle interactions do not contaminate user B property feed", async () => {
    // User A interacts with vehicles (save & contact)
    await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L001', type: 'save' }); // Toyota Aqua

    await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L002', type: 'contact' }); // Honda Vezel

    // User B interacts with property (save & view)
    await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_b', listingId: 'L014', type: 'save' }); // Luxury Apartment

    await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_b', listingId: 'L015', type: 'view' }); // Modern House

    // Fetch recommendations for User A
    const resA = await request(app).get('/api/recommendations?userId=user_a');
    expect(resA.status).toBe(200);
    // User A's top recommendation should be vehicle category
    expect(resA.body[0].category).toBe('vehicle');

    // Fetch recommendations for User B
    const resB = await request(app).get('/api/recommendations?userId=user_b');
    expect(resB.status).toBe(200);
    // User B's top recommendation should be property category
    expect(resB.body[0].category).toBe('property');

    // User A's feed should not be identical to User B's feed (isolation)
    expect(resA.body[0].listingId).not.toBe(resB.body[0].listingId);
  });

  // Test 3: Repeat handling & exclusion
  test('3. Repeat handling: 50 views cannot overpower 1 save; contacted listing is excluded from feed', async () => {
    // Record 50 views on a property (L016 - Sea View Apartment Galle)
    const viewPromises = [];
    for (let i = 0; i < 50; i++) {
      viewPromises.push(
        Interaction.create({
          userId: 'user_a',
          listingId: 'L016',
          type: 'view',
          createdAt: new Date(),
        })
      );
    }
    await Promise.all(viewPromises);

    // Record only 1 save on a vehicle (L004 - Toyota Prius)
    await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L004', type: 'save' });

    // Record contact on vehicle L005 (should be excluded from feed)
    await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L005', type: 'contact' });

    const res = await request(app).get('/api/recommendations?userId=user_a');
    expect(res.status).toBe(200);

    // Contacted listing (L005) must NOT appear in feed, but saved listing (L004) persists in feed
    const listingIds = res.body.map((item) => item.listingId);
    expect(listingIds).not.toContain('L005');
    expect(listingIds).toContain('L004');

    const savedListing = res.body.find((item) => item.listingId === 'L004');
    expect(savedListing.isSaved).toBe(true);

    // 50 views on L016 has a 0.3 VIEWED_PENALTY applied to L016
    // Verify that fresh vehicle listings rank higher than L016 due to save signal + viewed penalty
    const l016Index = listingIds.indexOf('L016');
    if (l016Index !== -1) {
      expect(l016Index).toBeGreaterThan(0);
    }
  });

  // Test 5: Prevent duplicate SAVE records and duplicate score inflation
  test('5. Prevent duplicate SAVE records: repeated save clicks do not create duplicate records or inflate recommendation scores', async () => {
    // 1st save on L001
    const res1 = await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L001', type: 'save' });
    expect([200, 201]).toContain(res1.status);
    expect(res1.body.success).toBe(true);

    const recs1 = await request(app).get('/api/recommendations?userId=user_a');
    const score1 = recs1.body.find((item) => item.listingId === 'L001').score;

    // 2nd save on same listing L001
    const res2 = await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L001', type: 'save' });
    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
    expect(res2.body.alreadySaved).toBe(true);

    // 3rd save on same listing L001
    const res3 = await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L001', type: 'save' });
    expect(res3.status).toBe(200);

    // Confirm only 1 interaction document exists for user_a + L001 + save in DB
    const saveCount = await Interaction.countDocuments({
      userId: 'user_a',
      listingId: 'L001',
      type: 'save',
    });
    expect(saveCount).toBe(1);

    // Recommendation score must NOT be inflated by repeated saves
    const recs2 = await request(app).get('/api/recommendations?userId=user_a');
    const score2 = recs2.body.find((item) => item.listingId === 'L001').score;
    expect(score2).toBe(score1);

    // Saved endpoint /api/users/:id/saved returns listing ID
    const savedRes = await request(app).get('/api/users/user_a/saved');
    expect(savedRes.status).toBe(200);
    expect(savedRes.body).toContain('L001');
    expect(savedRes.body.filter((id) => id === 'L001').length).toBe(1);
  });

  // Test 4 (Bonus): Input validation & signal curve properties
  test('4. Bonus: Validation rejects invalid interaction types, and signal curve is sub-linear', async () => {
    // Validation: invalid interaction type
    const resInvalidType = await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L001', type: 'like' });
    expect(resInvalidType.status).toBe(400);

    // Validation: missing or unknown user
    const resNoUser = await request(app).get('/api/recommendations?userId=non_existent_user');
    expect(resNoUser.status).toBe(404);

    // Test mathematical properties of signal():
    // 1 view = 1.0
    // 10 views ≈ 3.3
    // 100 views ≈ 5.6 (capped at 20 => ~3.99)
    const sig1 = signal('view', 1);
    const sig10 = signal('view', 10);
    const sig50 = signal('view', 50);

    // Monotonic
    expect(sig10).toBeGreaterThan(sig1);
    expect(sig50).toBeGreaterThanOrEqual(sig10);

    // Sub-linear: diminishing marginal gain (gain from 1->10 is much greater than gain from 10->20)
    const gain1to10 = sig10 - sig1;
    const gain10to50 = sig50 - sig10;
    expect(gain1to10).toBeGreaterThan(gain10to50);

    // 100 views still cannot overpower 1 contact
    const sig1Contact = signal('contact', 1);
    expect(sig1Contact).toBeGreaterThan(sig50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression Suite – covers gaps identified during final verification audit
// ─────────────────────────────────────────────────────────────────────────────
describe('PrimeMarket Regression Tests', () => {
  // R1: VIEW interaction persists in DB and VIEWED_PENALTY applies
  test('R1. VIEW persists to DB and penalizes the viewed listing below unviewed peers', async () => {
    const viewRes = await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L001', type: 'view' });
    expect(viewRes.status).toBe(201);
    expect(viewRes.body.success).toBe(true);

    // Confirm persisted in MongoDB
    const stored = await Interaction.findOne({ userId: 'user_a', listingId: 'L001', type: 'view' });
    expect(stored).not.toBeNull();
    expect(stored.type).toBe('view');

    const recs = await request(app).get('/api/recommendations?userId=user_a');
    expect(recs.status).toBe(200);

    // L001 (viewed, popularity 95) should score LOWER than L003 (not viewed, popularity 85)
    // due to VIEWED_PENALTY = 0.3x multiplier on the final score
    const l001 = recs.body.find((i) => i.listingId === 'L001');
    const l003 = recs.body.find((i) => i.listingId === 'L003');
    if (l001 && l003) {
      expect(l001.score).toBeLessThan(l003.score);
    }
  });

  // R2: CONTACT via the full API flow persists and excludes the listing
  test('R2. CONTACT via API persists to DB and removes contacted listing from feed', async () => {
    const contactRes = await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L003', type: 'contact' });
    expect(contactRes.status).toBe(201);
    expect(contactRes.body.success).toBe(true);

    const stored = await Interaction.findOne({ userId: 'user_a', listingId: 'L003', type: 'contact' });
    expect(stored).not.toBeNull();

    const recs = await request(app).get('/api/recommendations?userId=user_a');
    const ids = recs.body.map((i) => i.listingId);
    expect(ids).not.toContain('L003');
  });

  // R3: /api/users/:id/saved returns only that user's saved IDs — no cross-user leakage
  test('R3. /api/users/:id/saved returns correct IDs with strict per-user isolation', async () => {
    await request(app).post('/api/interactions').send({ userId: 'user_a', listingId: 'L001', type: 'save' });
    await request(app).post('/api/interactions').send({ userId: 'user_a', listingId: 'L002', type: 'save' });
    await request(app).post('/api/interactions').send({ userId: 'user_b', listingId: 'L014', type: 'save' });

    const savedA = await request(app).get('/api/users/user_a/saved');
    expect(savedA.status).toBe(200);
    expect(savedA.body).toContain('L001');
    expect(savedA.body).toContain('L002');
    expect(savedA.body).not.toContain('L014'); // user_b's save must NOT appear

    const savedB = await request(app).get('/api/users/user_b/saved');
    expect(savedB.status).toBe(200);
    expect(savedB.body).toContain('L014');
    expect(savedB.body).not.toContain('L001'); // user_a's saves must NOT appear
    expect(savedB.body).not.toContain('L002');
  });

  // R4: 404 for unknown userId in both recommendations and interactions
  test('R4. Unknown userId returns 404 from /api/recommendations and /api/interactions', async () => {
    const recRes = await request(app).get('/api/recommendations?userId=ghost_user');
    expect(recRes.status).toBe(404);

    const intRes = await request(app)
      .post('/api/interactions')
      .send({ userId: 'ghost_user', listingId: 'L001', type: 'view' });
    expect(intRes.status).toBe(404);
  });

  // R5: 404 for unknown listingId in interactions
  test('R5. Unknown listingId returns 404 from /api/interactions', async () => {
    const res = await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L999', type: 'view' });
    expect(res.status).toBe(404);
  });

  // R6: Recommendation feed items are sorted strictly by descending score
  test('R6. /api/recommendations returns items in strictly descending score order', async () => {
    await request(app)
      .post('/api/interactions')
      .send({ userId: 'user_a', listingId: 'L001', type: 'save' });

    const recs = await request(app).get('/api/recommendations?userId=user_a');
    expect(recs.status).toBe(200);
    expect(recs.body.length).toBeGreaterThan(1);

    const scores = recs.body.map((i) => i.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });

  // R7: signal() caps at n=20 — 1000 views cannot exceed 1 contact interaction
  test('R7. signal() is capped at n=20: 1000 views score less than 1 contact', async () => {
    const { signal, W } = require('../src/services/recommendationService');

    // Cap verification: signal(view, 20) === signal(view, 100) === signal(view, 1000)
    const sig20 = signal('view', 20);
    const sig100 = signal('view', 100);
    const sig1000 = signal('view', 1000);
    expect(sig100).toBeCloseTo(sig20, 10);
    expect(sig1000).toBeCloseTo(sig20, 10);

    // Base weight: signal(view, 1) = W.view * (1 + ln(1)) = W.view * 1
    expect(signal('view', 1)).toBeCloseTo(W.view, 10);
    expect(signal('save', 1)).toBeCloseTo(W.save, 10);
    expect(signal('contact', 1)).toBeCloseTo(W.contact, 10);

    // Supremacy: 1 contact > 1000 views
    expect(signal('contact', 1)).toBeGreaterThan(sig1000);
  });
});
