export const registerSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Future: incident broadcast, live location, traffic updates
    socket.on('user:location', (payload) => {
      socket.broadcast.emit('user:location:update', { socketId: socket.id, ...payload });
    });

    socket.on('disconnect', () => console.log(`🔌 Disconnected: ${socket.id}`));
  });
};