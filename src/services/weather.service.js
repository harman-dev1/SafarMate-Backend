import axios from 'axios';
import { ENV } from '../config/env.js';
import { cache, cacheKey } from '../utils/cache.js';

const KEY = ENV.GOOGLE_MAPS_KEY;
const WEATHER_BASE = ENV.GOOGLE_WEATHER_BASE;
const GEOCODING_BASE = ENV.GOOGLE_GEOCODING_BASE;

// ────────── Geometry helpers ──────────
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const distMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const samplePolyline = (coords, intervalMeters = 10000) => {
  if (!coords || coords.length < 2) return [];
  const samples = [];
  let cumDist = 0;
  let nextSampleAt = 0;

  samples.push({ lat: coords[0][1], lng: coords[0][0], distFromStart: 0 });

  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lat: coords[i][1], lng: coords[i][0] };
    const b = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const segLen = distMeters(a, b);

    while (nextSampleAt + intervalMeters <= cumDist + segLen) {
      nextSampleAt += intervalMeters;
      const t = (nextSampleAt - cumDist) / segLen;
      samples.push({
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
        distFromStart: nextSampleAt,
      });
    }
    cumDist += segLen;
  }

  const last = coords[coords.length - 1];
  samples.push({ lat: last[1], lng: last[0], distFromStart: cumDist });
  return samples;
};

const subsample = (arr, n) => {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
};

// ────────── Risk classifier ──────────
const classifyRisk = (forecast) => {
  if (!forecast) return { level: 'unknown', score: 0 };

  const precipProb = forecast.precipitationProbability || 0;
  const precipMm = forecast.precipitationMm || 0;
  const windKmh = forecast.windKmh || 0;
  const visibilityKm = forecast.visibilityKm || 999;
  const condition = (forecast.condition || '').toLowerCase();

  let score = 0;
  if (precipMm > 7.5 || precipProb > 80) score += 4;
  else if (precipMm > 2.5 || precipProb > 60) score += 2;
  else if (precipMm > 0.5 || precipProb > 40) score += 1;

  if (windKmh > 60) score += 3;
  else if (windKmh > 40) score += 1;

  if (visibilityKm < 1) score += 3;
  else if (visibilityKm < 4) score += 1;

  if (/thunder|storm|hurricane|tornado/.test(condition)) score += 4;
  if (/snow|ice|sleet/.test(condition)) score += 2;
  if (/fog|haze|mist/.test(condition)) score += 1;

  let level;
  if (score >= 5) level = 'severe';
  else if (score >= 2) level = 'moderate';
  else if (score >= 1) level = 'mild';
  else level = 'clear';

  return { level, score };
};

// ────────── Google Weather API ──────────
const fetchHourlyForecast = async ({ lat, lng, hours = 240 }) => {
  if (!KEY) throw new Error('GOOGLE_MAPS_KEY not configured');
  const key = cacheKey('gw-hours', lat.toFixed(2), lng.toFixed(2));
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const { data } = await axios.get(
      `${WEATHER_BASE}/v1/forecast/hours:lookup`,
      {
        params: {
          key: KEY,
          'location.latitude': lat,
          'location.longitude': lng,
          hours: Math.min(hours, 240),
          unitsSystem: 'METRIC',
        },
        timeout: 10000,
      }
    );

    const hourly = (data.forecastHours || []).map((h) => ({
      timeUtc: h.interval?.startTime,
      temperatureC: h.temperature?.degrees,
      feelsLikeC: h.feelsLikeTemperature?.degrees,
      condition: h.weatherCondition?.description?.text || '',
      conditionType: h.weatherCondition?.type || '',
      iconUri: h.weatherCondition?.iconBaseUri || '',
      precipitationProbability: h.precipitation?.probability?.percent || 0,
      precipitationType: h.precipitation?.probability?.type || '',
      precipitationMm: h.precipitation?.qpf?.quantity || 0,
      humidity: h.relativeHumidity || 0,
      windKmh: h.wind?.speed?.value || 0,
      windDirection: h.wind?.direction?.degrees,
      visibilityKm: h.visibility?.distance,
      uvIndex: h.uvIndex,
      cloudCover: h.cloudCover,
    }));

    cache.set(key, hourly, 900);
    return hourly;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.error?.message || err.message;
    console.error('Google Weather error:', status, detail);
    const e = new Error(`Weather lookup failed: ${detail}`);
    e.statusCode = status === 403 ? 403 : 502;
    throw e;
  }
};

// ────────── Reverse geocode → best available place name ──────────
const isGenericName = (name) => {
  if (!name) return true;
  if (name.length < 3) return true;
  // Filter out names like "Street 4", "Road 12", "Lane 5", "Block A"
  if (/^(unnamed|street|road|lane|block)\s*[\d\w]*$/i.test(name.trim())) return true;
  return false;
};

const reverseGeocodeShort = async (lat, lng) => {
  if (!KEY) return null;
  const key = cacheKey('rgc', lat.toFixed(2), lng.toFixed(2));
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  try {
    const { data } = await axios.get(`${GEOCODING_BASE}/json`, {
      params: { latlng: `${lat},${lng}`, key: KEY, language: 'en' },
      timeout: 8000,
    });

    if (!data.results?.length) {
      cache.set(key, null, 86400);
      return null;
    }

    // Use the most specific result (first one) — its components match this exact point
    const components = data.results[0]?.address_components || [];
    const findIn = (type) =>
      components.find((c) => c.types.includes(type))?.long_name;

    // Priority — most specific to most general:
    //   neighborhood/sublocality (Gulberg, DHA Phase 5)
    //   → route (Mall Road, GT Road, M-2 Motorway)
    //   → locality (Lahore — fallback for points in middle of nowhere)
    //   → admin areas
    const candidates = [
      findIn('neighborhood'),
      findIn('sublocality_level_1'),
      findIn('sublocality'),
      findIn('sublocality_level_2'),
      findIn('sublocality_level_3'),
      findIn('route'),
      findIn('locality'),
      findIn('administrative_area_level_3'),
      findIn('administrative_area_level_2'),
    ];

    // Also sweep through other results if the first doesn't yield anything useful
    if (candidates.every((c) => !c || isGenericName(c))) {
      for (const result of data.results.slice(1)) {
        for (const comp of result.address_components || []) {
          for (const wantedType of [
            'neighborhood', 'sublocality_level_1', 'sublocality',
            'route', 'locality', 'administrative_area_level_2',
          ]) {
            if (comp.types.includes(wantedType) && !isGenericName(comp.long_name)) {
              cache.set(key, comp.long_name, 86400);
              return comp.long_name;
            }
          }
        }
      }
    }

    for (const c of candidates) {
      if (c && !isGenericName(c)) {
        cache.set(key, c, 86400);
        return c;
      }
    }

    cache.set(key, null, 86400);
    return null;
  } catch (err) {
    console.warn('Reverse geocode failed:', err.message);
    return null;
  }
};

// ────────── Pick forecast hour matching arrival time ──────────
const pickHourly = (hourly, targetMs) => {
  if (!hourly?.length) return null;
  let best = hourly[0];
  let bestDelta = Math.abs(new Date(best.timeUtc).getTime() - targetMs);
  for (const h of hourly) {
    const delta = Math.abs(new Date(h.timeUtc).getTime() - targetMs);
    if (delta < bestDelta) { best = h; bestDelta = delta; }
  }
  return best;
};

// ────────── Public: weather along a route ──────────
export const getWeatherAlongRoute = async ({
  coordinates,
  totalDistance,
  totalDuration,
  startMs = Date.now(),
  intervalMeters,
}) => {
  if (!coordinates?.length) return { samples: [], summary: null };

  // Adaptive sampling: shorter routes get tighter intervals so locality
  // names actually differ between samples
  const interval = intervalMeters || (
    totalDistance < 30000 ? 3000 :
    totalDistance < 100000 ? 7000 :
    10000
  );

  const points = samplePolyline(coordinates, interval);
  const sampled = points.length > 12 ? subsample(points, 12) : points;

  const enriched = sampled.map((p) => {
    const fraction = totalDistance > 0 ? p.distFromStart / totalDistance : 0;
    const etaMs = startMs + fraction * totalDuration * 1000;
    return { ...p, etaMs };
  });

  const [hourlyResults, localities] = await Promise.all([
    Promise.all(
      enriched.map((p) =>
        fetchHourlyForecast({ lat: p.lat, lng: p.lng }).catch(() => null)
      )
    ),
    Promise.all(
      enriched.map((p) =>
        reverseGeocodeShort(p.lat, p.lng).catch(() => null)
      )
    ),
  ]);

  const samples = enriched.map((p, i) => {
    const forecast = pickHourly(hourlyResults[i], p.etaMs);
    const risk = classifyRisk(forecast);
    return {
      lat: p.lat,
      lng: p.lng,
      distFromStart: p.distFromStart,
      etaMs: p.etaMs,
      locality: localities[i] || null,
      forecast,
      risk: risk.level,
      riskScore: risk.score,
    };
  });

  const sortedByRisk = [...samples].sort((a, b) => b.riskScore - a.riskScore);
  const worstSample = sortedByRisk[0];

  const willRain = samples.some(
    (s) => (s.forecast?.precipitationProbability || 0) >= 50
  );
  const maxPrecipProb = Math.max(
    ...samples.map((s) => s.forecast?.precipitationProbability || 0)
  );
  const validTemps = samples
    .map((s) => s.forecast?.temperatureC)
    .filter((t) => t !== undefined);
  const avgTemp =
    validTemps.length > 0
      ? validTemps.reduce((a, t) => a + t, 0) / validTemps.length
      : null;

  const rainSamples = samples
    .filter((s) => (s.forecast?.precipitationProbability || 0) >= 40)
    .sort(
      (a, b) =>
        b.forecast.precipitationProbability - a.forecast.precipitationProbability
    );

  const summary = {
    overallRisk: worstSample?.risk || 'clear',
    worstAt: worstSample
      ? {
          distFromStart: worstSample.distFromStart,
          etaMs: worstSample.etaMs,
          locality: worstSample.locality,
          condition: worstSample.forecast?.condition,
          precipitationProbability: worstSample.forecast?.precipitationProbability,
        }
      : null,
    willRain,
    maxPrecipProb,
    avgTempC: avgTemp ? +avgTemp.toFixed(1) : null,
    rainSampleCount: rainSamples.length,
  };

  return { samples, summary };
};