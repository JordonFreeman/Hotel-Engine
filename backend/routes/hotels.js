// routes/hotels.js
// READ-HEAVY path → MongoDB (AP, BASE)
// CAP justification: For amenity browsing, availability > consistency.
// A traveller seeing a slightly stale amenity list is acceptable; a
// 500ms search response is not. MongoDB's horizontal scaling and
// embedded-array queries make it the correct choice here.
const express = require('express');
const { HotelCatalog } = require('../config/mongodb');
const router = express.Router();

// GET /api/hotels?city=Ho+Chi+Minh+City&amenity=pool
router.get('/', async (req, res) => {
  try {
    const { city, amenity, q } = req.query;
    const filter = {};

    if (city)    filter.city = new RegExp(city, 'i');
    if (amenity) filter.amenities = amenity;  // exact match in amenities array
    if (q)       filter.$text = { $search: q }; // full-text search

    const hotels = await HotelCatalog.find(filter)
      .select('-__v')
      .sort({ star_rating: -1 })
      .lean();

    res.json({ success: true, count: hotels.length, data: hotels });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hotels/:hotel_id  — single hotel catalog entry
router.get('/:hotel_id', async (req, res) => {
  try {
    const hotel = await HotelCatalog.findOne({
      hotel_id: parseInt(req.params.hotel_id),
    }).lean();

    if (!hotel) return res.status(404).json({ success: false, message: 'Hotel not found in catalog' });
    res.json({ success: true, data: hotel });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/hotels/:hotel_id/amenities — hotel manager updates amenities
// MongoDB shines here: no ALTER TABLE needed when a resort adds a new amenity
router.patch('/:hotel_id/amenities', async (req, res) => {
  try {
    const { amenities } = req.body;
    const updated = await HotelCatalog.findOneAndUpdate(
      { hotel_id: parseInt(req.params.hotel_id) },
      { $set: { amenities, updated_at: new Date() } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Hotel not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
