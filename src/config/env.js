import 'dotenv/config';

const trim = (s) => (typeof s === 'string' ? s.trim() : s);

export const ENV = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_URL: trim(process.env.CLIENT_URL) || 'http://localhost:5173',
  MONGO_URI: trim(process.env.MONGO_URI),
  JWT_SECRET: trim(process.env.JWT_SECRET),
  JWT_EXPIRES_IN: trim(process.env.JWT_EXPIRES_IN) || '7d',
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,

  // Google Maps Platform
  GOOGLE_MAPS_KEY: trim(process.env.GOOGLE_MAPS_KEY) || '',
  GOOGLE_PLACES_BASE: 'https://places.googleapis.com',
  GOOGLE_ROUTES_BASE: 'https://routes.googleapis.com',
  GOOGLE_GEOCODING_BASE: 'https://maps.googleapis.com/maps/api/geocode',
  GOOGLE_WEATHER_BASE: trim(process.env.GOOGLE_WEATHER_BASE) || 'https://weather.googleapis.com',
};

const required = { MONGO_URI: ENV.MONGO_URI, JWT_SECRET: ENV.JWT_SECRET };
const optional = {
  GOOGLE_MAPS_KEY: ENV.GOOGLE_MAPS_KEY,
  FIREBASE_SERVICE_ACCOUNT: ENV.FIREBASE_SERVICE_ACCOUNT,
};

for (const [k, v] of Object.entries(required)) {
  if (!v) console.error(`❌ Missing required env var: ${k}`);
}
for (const [k, v] of Object.entries(optional)) {
  if (!v) console.warn(`⚠️  Optional env var not set: ${k} — related features will fail`);
  else console.log(`✓ ${k} loaded (${String(v).slice(0, 8)}…)`);
}