import admin from 'firebase-admin';
import { ENV } from './env.js';

let initialized = false;

export const initFirebase = () => {
  if (initialized) return admin;
  if (!ENV.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('⚠️  Firebase Admin not initialized — FIREBASE_SERVICE_ACCOUNT missing');
    return admin;
  }
  try {
    let raw = ENV.FIREBASE_SERVICE_ACCOUNT;
    // Auto-detect base64 encoding
    if (!raw.trim().startsWith('{')) {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf-8');
        if (decoded.startsWith('{')) raw = decoded;
      } catch {}
    }
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log('✅ Firebase Admin initialized');
  } catch (err) {
    console.error('❌ Firebase Admin init failed:', err.message);
  }
  return admin;
};

initFirebase();
export default admin;