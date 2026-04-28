// config/mongodb.js
// MongoDB handles the Hotel Catalog (BASE model, AP in CAP theorem):
//   - Flexible amenity arrays that change as resorts upgrade
//   - Fast read-heavy searches (availability prioritised over strict consistency)
//   - Embedded arrays avoid expensive JOINs for amenity lookups
const mongoose = require('mongoose');
require('dotenv').config();

async function connectMongo() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotelCatalog');
  console.log('[MongoDB] Connected to MongoDB (BASE/AP catalog store)');
}

// Schema — intentionally flexible (no rigid FK constraints like SQL)
// Amenities and age_policy are embedded because they are always read with the
// hotel document. Embedding avoids a join and is the right document-model choice.
// age_policy lives here (not SQL) because it is descriptive catalog content:
// it changes when hotel policy changes (rare), is read on every hotel page view
// (frequent), and has no transactional integrity requirement — BASE/AP is fine.
const HotelCatalogSchema = new mongoose.Schema({
  hotel_id:    { type: Number, required: true, unique: true }, // FK mirror to SQL Hotels.ID
  name:        { type: String, required: true },
  city:        { type: String, required: true, index: true },
  description: { type: String },
  star_rating: { type: Number, min: 1, max: 5 },
  amenities:   [String],           // e.g. ["pool","wifi","gym","spa"]
  images:      [String],           // CDN URLs
  location: {
    lat: Number,
    lng: Number,
    address: String,
  },
  // Age/guest policy — flexible per hotel, no SQL schema migration needed
  // children_allowed: false means adults-only property
  // min_age: minimum age of any guest (0 = no restriction)
  // child_free_under: age below which children stay at no extra charge
  // notes: free-text policy description shown to guests on the hotel page
  age_policy: {
    children_allowed:    { type: Boolean, default: true },
    min_age:             { type: Number,  default: 0 },
    child_free_under:    { type: Number,  default: null },
    notes:               { type: String },
    // Pricing modifiers applied at booking time (client-side calculation)
    // child_rate_pct: % of base nightly rate charged per child per night
    // senior_age / senior_discount_pct: age threshold and % discount for seniors
    pricing: {
      child_rate_pct:      { type: Number, default: 0 },
      senior_age:          { type: Number, default: null },
      senior_discount_pct: { type: Number, default: 0 },
    },
  },
  updated_at: { type: Date, default: Date.now },
}, { collection: 'hotels' });

// Text index for amenity & description search (read-heavy path)
HotelCatalogSchema.index({ name: 'text', description: 'text', amenities: 'text' });

const HotelCatalog = mongoose.model('HotelCatalog', HotelCatalogSchema);

module.exports = { connectMongo, HotelCatalog };
