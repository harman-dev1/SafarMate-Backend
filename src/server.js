import http from 'http';
import { Server as SocketServer } from 'socket.io';
import app from './app.js';
import { ENV } from './config/env.js';
import { connectDB } from './database/connect.js';
import { registerSocketHandlers } from './sockets/index.js';

const server = http.createServer(app);

const io = new SocketServer(server, {
  cors: { origin: ENV.CLIENT_URL, credentials: true },
});

registerSocketHandlers(io);
app.set('io', io);

const start = async () => {
  await connectDB();
  server.listen(ENV.PORT, () => {
    console.log(`🚀 SafarMate API running on http://localhost:${ENV.PORT}`);
  });
};

start();

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});