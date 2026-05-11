import NodeCache from 'node-cache';

// stdTTL = 5 minutes; checkperiod = 60s
export const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

export const cacheKey = (...parts) => parts.filter(Boolean).join('::').toLowerCase();