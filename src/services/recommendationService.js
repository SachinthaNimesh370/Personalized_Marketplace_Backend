// server/src/services/recommendationService.js
// Pure ranking logic matching Section 8 of Developer Guide

const W = { view: 1, save: 4, contact: 8 };
const S = {
  category: 3.0,
  attribute: 2.0,
  location: 1.5,
  price: 1.0,
  popularity: 0.5,
};
const VIEWED_PENALTY = 0.3;

/**
 * Diminishing returns anti-spam formula:
 * signal(type, n) = weight[type] * (1 + ln(min(n, 20)))
 */
const signal = (type, n) => {
  const weight = W[type] || 0;
  if (n < 1) return 0;
  return weight * (1 + Math.log(Math.min(n, 20)));
};

const attrOf = (l) =>
  (l && l.attributes && (l.attributes.make || l.attributes.propertyType)) || 'general';

const band = (l) =>
  l.price < (l.category === 'vehicle' ? 5000000 : 20000000) ? 'low' : 'high';

function buildProfile(interactions, listingsById) {
  // 1. Count per (listingId, type)
  const counts = {};
  for (const i of interactions) {
    const k = `${i.listingId}|${i.type}`;
    counts[k] = (counts[k] || 0) + 1;
  }

  // 2. Accumulate signal into buckets
  const p = {
    category: {},
    attribute: {},
    location: {},
    price: {},
    seen: {},
  };

  for (const [k, n] of Object.entries(counts)) {
    const [listingId, type] = k.split('|');
    const l = listingsById[listingId];
    if (!l) continue;

    const s = signal(type, n);
    const add = (bucket, key) => {
      p[bucket][key] = (p[bucket][key] || 0) + s;
    };

    add('category', l.category);
    add('attribute', attrOf(l));
    add('location', l.location);
    add('price', `${l.category}:${band(l)}`);

    p.seen[listingId] = p.seen[listingId] || {};
    p.seen[listingId][type] = true;
  }

  return p;
}

const norm = (bucket, key) => {
  const values = Object.values(bucket);
  if (!values.length) return 0;
  const max = Math.max(0, ...values);
  return max ? (bucket[key] || 0) / max : 0;
};

function explain(l, parts) {
  const labels = {
    category: `You like ${l.category} listings`,
    attribute: `Similar to ${attrOf(l)} you showed interest in`,
    location: `Matches your interest in ${l.location}`,
    price: 'In your usual price range',
  };

  return Object.entries(parts)
    .filter(([k, v]) => k !== 'popularity' && v > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => labels[k]);
}

function coldStart(listings) {
  const sorted = [...listings].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const props = sorted.filter((l) => l.category === 'property');
  const vehs = sorted.filter((l) => l.category === 'vehicle');
  const out = [];

  while (props.length || vehs.length) {
    if (props.length) out.push(props.shift());
    if (vehs.length) out.push(vehs.shift());
  }

  return out.map((l) => ({
    listing: l,
    score: (l.popularity || 50) / 100,
    reasons: ['Popular right now'],
  }));
}

/**
 * Pure recommendation ranking function.
 *
 * @param {Array} listings - Array of all listing objects
 * @param {Array} interactions - Array of interaction objects for the target user
 * @returns {Array<{ listing: Object, score: number, reasons: string[] }>}
 */
function rank(listings, interactions) {
  if (!interactions || !interactions.length) {
    return coldStart(listings);
  }

  const byId = Object.fromEntries(listings.map((l) => [l.listingId, l]));
  const p = buildProfile(interactions, byId);

  // Filter out contacted or saved listings
  const candidates = listings.filter(
    (l) => !(p.seen[l.listingId] && (p.seen[l.listingId].contact || p.seen[l.listingId].save))
  );

  return candidates
    .map((l) => {
      const parts = {
        category: S.category * norm(p.category, l.category),
        attribute: S.attribute * norm(p.attribute, attrOf(l)),
        location: S.location * norm(p.location, l.location),
        price: S.price * norm(p.price, `${l.category}:${band(l)}`),
        popularity: S.popularity * ((l.popularity || 50) / 100),
      };

      let score = Object.values(parts).reduce((a, b) => a + b, 0);

      // Penalize viewed items
      if (p.seen[l.listingId] && p.seen[l.listingId].view) {
        score *= VIEWED_PENALTY;
      }

      return {
        listing: l,
        score: Number(score.toFixed(4)),
        reasons: explain(l, parts),
      };
    })
    .sort((a, b) => b.score - a.score || a.listing.listingId.localeCompare(b.listing.listingId));
}

module.exports = {
  rank,
  signal,
  coldStart,
  buildProfile,
  W,
  S,
  VIEWED_PENALTY,
};
