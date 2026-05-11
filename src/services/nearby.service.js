import axios from 'axios';
import { ENV } from '../config/env.js';
import { cache, cacheKey } from '../utils/cache.js';

const PLACES_BASE = ENV.GOOGLE_PLACES_BASE;
const KEY = ENV.GOOGLE_MAPS_KEY;

// Map our category keys to Google Places "primary types"
const CATEGORY_TYPES = {
  hospital: ['hospital', 'doctor', 'medical_lab'],
  fuel: ['gas_station'],
  restaurant: ['restaurant', 'cafe', 'meal_takeaway', 'fast_food_restaurant'],
  police: ['police'],
  parking: ['parking'],
  ev_charging: ['electric_vehicle_charging_station'],
  pharmacy: ['pharmacy', 'drugstore'],
  atm: ['atm', 'bank'],
};

export const findNearby = async ({ lat, lng, category, radius = 5000 }) => {
  const types = CATEGORY_TYPES[category];
  if (!types) {
    const e = new Error('Unsupported category: ' + category);
    e.statusCode = 400;
    throw e;
  }

  if (!KEY) {
    const e = new Error('GOOGLE_MAPS_KEY not configured. Add it to backend/.env and restart.');
    e.statusCode = 500;
    throw e;
  }

  const key = cacheKey(
    'g-nearby',
    category,
    (+lat).toFixed(3),
    (+lng).toFixed(3),
    radius
  );
  const hit = cache.get(key);
  if (hit) {
    console.log(`📍 nearby ${category} (cached): ${hit.length}`);
    return hit;
  }

  const body = {
    includedTypes: types,
    maxResultCount: 20,
    languageCode: 'en',
    locationRestriction: {
      circle: {
        center: { latitude: +lat, longitude: +lng },
        radius: Math.min(Math.max(+radius, 500), 50000),
      },
    },
    rankPreference: 'DISTANCE',
  };

  console.log(`📍 nearby: ${category} around (${lat}, ${lng}) r=${radius}m`);

  try {
    const { data } = await axios.post(
      `${PLACES_BASE}/v1/places:searchNearby`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types',
        },
        timeout: 10000,
      }
    );

    const places = (data.places || []).map((p) => ({
      id: `g-${p.id}`,
      name: p.displayName?.text || category.replace('_', ' '),
      category,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      address: p.formattedAddress || '',
      phone: p.nationalPhoneNumber || null,
      website: p.websiteUri || null,
      rating: p.rating || null,
      ratingCount: p.userRatingCount || null,
      placeId: p.id,
    }));

    console.log(`📍 nearby ${category}: ${places.length} results`);
    cache.set(key, places, 600);
    return places;
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Google Places nearby error:', status, msg);
    const e = new Error(`Nearby search failed: ${msg}`);
    e.statusCode = status === 403 ? 403 : 502;
    throw e;
  }
};