import axios from 'axios';
import { ENV } from '../config/env.js';
import { cache, cacheKey } from '../utils/cache.js';

const PLACES_BASE = ENV.GOOGLE_PLACES_BASE;
const KEY = ENV.GOOGLE_MAPS_KEY;

const requireKey = () => {
  if (!KEY) {
    const e = new Error('GOOGLE_MAPS_KEY not configured. Add it to backend/.env and restart.');
    e.statusCode = 500;
    throw e;
  }
};

// ────────── Autocomplete (used by SearchBar / LocationPickerInput) ──────────
export const searchPlaces = async (query, opts = {}) => {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  requireKey();

  const key = cacheKey(
    'g-search',
    q,
    opts.lat ? (+opts.lat).toFixed(2) : '',
    opts.lng ? (+opts.lng).toFixed(2) : ''
  );
  const hit = cache.get(key);
  if (hit) return hit;

  const body = {
    input: q,
    languageCode: 'en',
  };

  // Bias results toward user's location (within ~50 km)
  if (opts.lat && opts.lng) {
    body.locationBias = {
      circle: {
        center: { latitude: +opts.lat, longitude: +opts.lng },
        radius: 50000,
      },
    };
  }

  try {
    const { data } = await axios.post(
      `${PLACES_BASE}/v1/places:autocomplete`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': KEY,
        },
        timeout: 8000,
      }
    );

    const suggestions = data.suggestions || [];
    // Each suggestion has only IDs; we need to fetch lat/lng for each
    const places = await Promise.all(
      suggestions.slice(0, opts.limit || 8).map(async (s) => {
        const placeId = s.placePrediction?.placeId;
        if (!placeId) return null;
        try {
          const detail = await getPlaceDetails(placeId);
          if (!detail) return null;
          return {
            id: `g-${placeId}`,
            source: 'google',
            name: s.placePrediction?.structuredFormat?.mainText?.text || detail.name,
            address:
              s.placePrediction?.structuredFormat?.secondaryText?.text ||
              detail.address,
            lat: detail.lat,
            lng: detail.lng,
            placeId,
            types: detail.types || [],
          };
        } catch {
          return null;
        }
      })
    );

    const out = places.filter(Boolean);
    cache.set(key, out, 300);
    console.log(`🔎 search "${q}" → google: ${out.length} results`);
    return out;
  } catch (err) {
    console.error(
      'Google Places autocomplete error:',
      err.response?.status,
      err.response?.data?.error?.message || err.message
    );
    const e = new Error(
      `Google Places search failed: ${
        err.response?.data?.error?.message || err.message
      }`
    );
    e.statusCode = err.response?.status === 403 ? 403 : 502;
    throw e;
  }
};

// ────────── Place details (id → coordinates + name) ──────────
const getPlaceDetails = async (placeId) => {
  const key = cacheKey('g-detail', placeId);
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const { data } = await axios.get(
      `${PLACES_BASE}/v1/places/${encodeURIComponent(placeId)}`,
      {
        params: { languageCode: 'en' },
        headers: {
          'X-Goog-Api-Key': KEY,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,location,types,nationalPhoneNumber,websiteUri',
        },
        timeout: 6000,
      }
    );

    const out = {
      placeId: data.id,
      name: data.displayName?.text || 'Unknown',
      address: data.formattedAddress || '',
      lat: data.location?.latitude,
      lng: data.location?.longitude,
      types: data.types || [],
      phone: data.nationalPhoneNumber || null,
      website: data.websiteUri || null,
    };
    cache.set(key, out, 600);
    return out;
  } catch (err) {
    console.warn(
      'Place details error:',
      err.response?.status,
      err.response?.data?.error?.message || err.message
    );
    return null;
  }
};

// ────────── Reverse geocoding ──────────
export const reverseGeocode = async (lat, lng) => {
  requireKey();

  const key = cacheKey('g-rev', (+lat).toFixed(5), (+lng).toFixed(5));
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const { data } = await axios.get(`${ENV.GOOGLE_GEOCODING_BASE}/json`, {
      params: { latlng: `${lat},${lng}`, key: KEY, language: 'en' },
      timeout: 6000,
    });

    const result = data.results?.[0];
    if (!result) return null;

    const out = {
      name: result.address_components?.[0]?.long_name || 'Unknown',
      address: result.formatted_address,
      lat: result.geometry?.location?.lat,
      lng: result.geometry?.location?.lng,
      placeId: result.place_id,
    };
    cache.set(key, out, 600);
    return out;
  } catch (err) {
    console.warn('Geocoding error:', err.message);
    return null;
  }
};