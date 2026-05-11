const errorHandler = (err, req, res, _next) => {
  const status = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Always log full error in backend terminal
  console.error('───────────────────────────────────────────────');
  console.error(`❌ [${status}] ${req.method} ${req.originalUrl}`);
  console.error('Message:', message);
  if (err.response?.data) console.error('Upstream:', JSON.stringify(err.response.data).slice(0, 500));
  if (status === 500) console.error('Stack:', err.stack);
  console.error('───────────────────────────────────────────────');

  res.status(status).json({
    success: false,
    message,
    // In dev, surface upstream details so the frontend toast tells you what's wrong
    upstream:
      process.env.NODE_ENV !== 'production'
        ? err.response?.data || null
        : undefined,
    errors: err.errors || [],
  });
};

export default errorHandler;