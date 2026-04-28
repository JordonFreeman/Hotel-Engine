// scripts/seed.js — Populate MongoDB Hotel Catalog
// Run: node scripts/seed.js
require('dotenv').config();
const { connectMongo, HotelCatalog } = require('../config/mongodb');

const seedData = [
  {
    hotel_id: 1,
    name: 'Grand Saigon Palace',
    city: 'Ho Chi Minh City',
    description: 'A 5-star landmark in the heart of District 1, blending colonial architecture with modern luxury. Panoramic rooftop views of the Saigon River.',
    star_rating: 5,
    amenities: ['pool', 'wifi', 'gym', 'spa', 'restaurant', 'bar', 'concierge', 'valet', 'airport-shuttle'],
    images: [
      'https://cdn.example.com/hotels/1/lobby.jpg',
      'https://cdn.example.com/hotels/1/pool.jpg',
      'https://cdn.example.com/hotels/1/rooftop.jpg',
    ],
    location: { lat: 10.7769, lng: 106.7009, address: '123 Dong Khoi St, District 1' },
    age_policy: {
      children_allowed: true,
      min_age: 0,
      child_free_under: 6,
      notes: 'Children under 6 stay free. Extra bed available on request for children 6–12.',
      pricing: {
        child_rate_pct: 50,   // children 6+ pay 50% of adult nightly rate per child
        senior_age: 60,
        senior_discount_pct: 10, // guests 60+ get 10% off the base rate
      },
    },
  },
  {
    hotel_id: 2,
    name: 'Hanoi Heritage Hotel',
    city: 'Hanoi',
    description: 'Nestled in the Old Quarter, this boutique hotel preserves Vietnamese heritage with handcrafted interiors and traditional cuisine.',
    star_rating: 4,
    amenities: ['wifi', 'restaurant', 'bar', 'bicycle-rental', 'tour-desk'],
    images: [
      'https://cdn.example.com/hotels/2/facade.jpg',
      'https://cdn.example.com/hotels/2/room.jpg',
    ],
    location: { lat: 21.0285, lng: 105.8542, address: '45 Hang Bac St, Hoan Kiem' },
    age_policy: {
      children_allowed: false,
      min_age: 12,
      child_free_under: null,
      notes: 'Guests must be 12 years or older. This is a quiet heritage property not suitable for young children.',
      pricing: {
        child_rate_pct: 0,    // no children accepted
        senior_age: 65,
        senior_discount_pct: 15, // seniors 65+ receive 15% discount
      },
    },
  },
  {
    hotel_id: 3,
    name: 'Da Nang Beach Resort',
    city: 'Da Nang',
    description: 'Beachfront paradise on My Khe Beach with direct ocean access, water sports centre, and stunning Marble Mountains backdrop.',
    star_rating: 5,
    amenities: ['beach-access', 'pool', 'wifi', 'gym', 'spa', 'restaurant', 'water-sports', 'kids-club', 'tennis'],
    images: [
      'https://cdn.example.com/hotels/3/beach.jpg',
      'https://cdn.example.com/hotels/3/pool.jpg',
      'https://cdn.example.com/hotels/3/suite.jpg',
    ],
    location: { lat: 16.0678, lng: 108.2208, address: '90 Vo Nguyen Giap, Son Tra' },
    age_policy: {
      children_allowed: true,
      min_age: 0,
      child_free_under: 12,
      notes: 'Family-friendly resort with dedicated Kids Club. Children under 12 stay free. Supervised kids activities daily.',
      pricing: {
        child_rate_pct: 0,    // children under 12 always free; 12+ full rate
        senior_age: 60,
        senior_discount_pct: 10,
      },
    },
  },
];

(async () => {
  await connectMongo();
  await HotelCatalog.deleteMany({});
  await HotelCatalog.insertMany(seedData);
  console.log('[Seed] MongoDB catalog seeded with', seedData.length, 'hotels');
  process.exit(0);
})();
