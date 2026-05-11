import { Server } from 'socket.io';
import { ENV } from '../config/env.js';

let io = null;

// Main initializer — accepts an HTTP server instance
export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: ENV.CLIENT_URL, credentials: true },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 socket connected: ${socket.id}`);

    // Client tells us their location so we know which region they're in
    socket.on('user:location', ({ lat, lng }) => {
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        socket.data.lat = lat;
        socket.data.lng = lng;
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 socket disconnected: ${socket.id}`);
    });
  });

  console.log('✓ Socket.IO initialized');
  return io;
};

// Backwards-compatible alias — matches the name your existing server.js uses
export const registerSocketHandlers = initSocket;

// ──────────── Broadcasting helpers ────────────
const NEARBY_RADIUS_METERS = 20000; // 20 km

const isNear = (a, b) => {
  if (!Number.isFinite(a?.lat) || !Number.isFinite(a?.lng)) return true;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) <= NEARBY_RADIUS_METERS;
};

export const broadcastIncident = (incident) => {
  if (!io) return;
  const [lng, lat] = incident.location.coordinates;
  const incidentLoc = { lat, lng };
  for (const [, socket] of io.sockets.sockets) {
    const userLoc = { lat: socket.data.lat, lng: socket.data.lng };
    if (isNear(userLoc, incidentLoc)) {
      socket.emit('incident:new', incident);
    }
  }
};

export const broadcastIncidentUpdate = (incident) => {
  if (!io) return;
  const [lng, lat] = incident.location.coordinates;
  const incidentLoc = { lat, lng };
  for (const [, socket] of io.sockets.sockets) {
    const userLoc = { lat: socket.data.lat, lng: socket.data.lng };
    if (isNear(userLoc, incidentLoc)) {
      socket.emit('incident:update', incident);
    }
  }
};

export const broadcastIncidentRemoved = (incidentId) => {
  if (!io) return;
  io.emit('incident:removed', { id: incidentId });
};