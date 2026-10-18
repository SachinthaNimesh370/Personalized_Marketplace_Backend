# PrimeMarket.lk - Personalized Marketplace Backend

Backend service for **PrimeMarket.lk Personalized Feed**, implementing intelligent candidate ranking, user activity persistence via MongoDB Atlas, and private AWS S3 image delivery via short-lived presigned URLs.

---

## 1. Quick Setup & Run

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB Atlas cluster URI
- AWS S3 bucket (or `S3_MODE=mock` approved fallback)

### Installation
```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Fill in your MONGODB_URI and AWS credentials in .env
```

### Seeding & Asset Upload
```bash
# Seed 25 realistic listings (properties & vehicles) and 2 predefined users into MongoDB
npm run seed

# Upload the 5 sample listing images to your private S3 bucket
npm run upload-images
```

### Run Server
```bash
# Start backend server on http://localhost:5000
npm start
# or development mode:
npm run dev
```

### Run Automated Tests
```bash
npm test
```
*Tests use an isolated in-memory MongoDB server (`mongodb-memory-server`) and do not touch the live Atlas cluster.*

---

## 2. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check & service status |
| `GET` | `/api/users` | List predefined test users (`user_a` & `user_b`) |
| `GET` | `/api/listings` | Retrieve all 25 listings with resolved presigned image URLs |
| `GET` | `/api/recommendations?userId=<id>` | Get personalized ranked feed (top 20) with score & reasons |
| `POST` | `/api/interactions` | Record user activity: body `{ userId, listingId, type }` |
| `GET` | `/api/users/:id/interactions` | Debug/demo endpoint to view all recorded actions for a user |

---

## 3. Recommendation & Ranking Architecture

### 3.1 Interaction Weights
Explicit intent actions carry exponentially more weight than passive browsing:
- **`view`**: `1.0` (passive interest)
- **`save`**: `4.0` (clear interest/intent)
- **`contact`**: `8.0` (highest intent, seller contact)

### 3.2 Anti-Spam Diminishing Returns
To prevent click spamming on a single listing from distorting the feed, signal uses a sub-linear logarithmic curve capped at 20 repeats:
$$\text{signal}(\text{type}, n) = W[\text{type}] \times (1 + \ln(\min(n, 20)))$$

- 1 view = `1.0`
- 10 views ≈ `3.3`
- 100 views ≈ `3.99` (capped)
- 1 contact (`8.0`) or 1 save (`4.0`) easily outweighs repeated views.

### 3.3 Multi-Dimensional Affinity Scoring
User profile aggregates accumulated signal across 4 dimensions:
1. **Category Affinity**: `3.0` weight
2. **Attribute Affinity**: `2.0` weight (vehicle `make` / property `propertyType`)
3. **Location Affinity**: `1.5` weight
4. **Price Band Affinity**: `1.0` weight (`low` vs `high` segmented per category)
5. **Popularity**: `0.5 * (popularity / 100)` (tie-breaker & baseline)

### 3.4 Already-Interacted Listings Policy
- **Contacted Listings**: Excluded from feed (user already completed conversion).
- **Saved Listings**: Excluded from recommendation feed (shown with saved badge in UI).
- **Viewed Listings**: Retained but penalized with `VIEWED_PENALTY = 0.3` to prioritize novel items while keeping strongly relevant items discoverable.

### 3.5 Cold-Start Handling
When a user has no prior interactions:
- Listings are ranked by popularity score descending.
- Categories are interleaved (`property`, `vehicle`, `property`, `vehicle`...) to present a balanced initial feed.
- Reasons labeled as `["Popular right now"]`.

### 3.6 Explainability
Each recommended candidate listing returns human-readable `reasons` explaining why it ranks high (e.g., `"You like vehicle listings"`, `"Similar to Toyota you showed interest in"`, `"Matches your interest in Colombo"`).

---

## 4. AWS S3 Integration & Security

1. **Private Bucket**: `Block all public access` is **ON**. Images cannot be accessed directly via public URLs.
2. **Backend-Only Credentials**: Access keys are stored exclusively in backend `.env` (never committed to git, verified in `.gitignore`).
3. **Presigned URLs**: Images are served using secure, short-lived presigned URLs (expires in 5 minutes).
4. **Least-Privilege IAM Policy**: The IAM user is strictly limited to `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::YOUR_BUCKET/listings/*`.
5. **Mock Mode Fallback**: Setting `S3_MODE=mock` serves local images from `/static/images/` without requiring AWS credentials.

---

## 5. Architectural Trade-Offs

- **Append-Only Interaction Log vs. Pre-aggregated Profiles**: Read-time aggregation was chosen because it allows tuning ranking formulas and weights retroactively without database migrations. For large-scale production, user profile vectors would be updated incrementally on write and cached in Redis.
- **Rule-Based Affinity vs. Collaborative Filtering**: Rule-based scoring provides full explainability, predictable deterministic ranking, and zero cold-start delay for new items.

---

## 6. Automated Test Coverage

Run tests:
```bash
npm test
```
The test suite in `tests/recommendations.test.js` covers:
1. **Cold Start**: Verifies default feed is non-empty, popularity ordered, interleaved by category, and labeled `"Popular right now"`.
2. **Personalization & Isolation**: Demonstrates User A vehicle interactions do not contaminate User B property recommendations.
3. **Repeat Handling & Exclusion**: Demonstrates 50 views cannot overpower a single save, and contacted items are excluded.
4. **Bonus Validations**: Validates input rejection for invalid interaction types (400) and proves mathematical sub-linearity of `signal()`.
