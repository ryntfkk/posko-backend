const express = require('express');
const cors = require('cors');
const http = require('http'); // Tetap butuh untuk local dev
const env = require('./config/env');
const { i18nMiddleware } = require('./config/i18n');
// Socket tetap diimport supaya tidak error, walau tidak jalan di Vercel
const { initSocket } = require('./modules/chat/socket'); 

// Import database utilities
const { connectDB, getConnectionStatus } = require('./utils/db');
const requireDbConnection = require('./middlewares/dbHealth');

// Import Routes
const reviewRoutes = require('./modules/reviews/routes');
const serviceRoutes = require('./modules/services/routes');
const authRoutes = require('./modules/auth/routes');
const orderRoutes = require('./modules/orders/routes');
const providerRoutes = require('./modules/providers/routes');
const paymentRoutes = require('./modules/payments/routes');
const chatRoutes = require('./modules/chat/routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Konfigurasi CORS (Penting agar Frontend Vercel bisa akses)
app.use(cors({
  origin: '*', // Di production sebaiknya ganti dengan URL Frontend
  credentials: true
}));

app.use(i18nMiddleware);
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.status(200).send('Posko Backend Vercel is Running!');
});

// Database Health Check Endpoint
app.get('/api/health', (req, res) => {
  const dbStatus = getConnectionStatus();
  const statusCode = dbStatus.isConnected ? 200 : 503;
  
  res.status(statusCode).json({
    status: dbStatus.isConnected ? 'healthy' : 'unhealthy',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// Apply database health check middleware to all API routes that need database
app.use('/api/auth', requireDbConnection, authRoutes);
app.use('/api/orders', requireDbConnection, orderRoutes);
app.use('/api/providers', requireDbConnection, providerRoutes);
app.use('/api/payments', requireDbConnection, paymentRoutes);
app.use('/api/chat', requireDbConnection, chatRoutes);
app.use('/api/reviews', requireDbConnection, reviewRoutes);
app.use('/api/services', requireDbConnection, serviceRoutes);

app.use(errorHandler);

// --- DATABASE CONNECTION (SERVERLESS FRIENDLY) ---
// Initialize database connection at startup
// This is called but not blocking - the middleware will ensure connection per request
connectDB().catch((err) => {
  console.error('❌ Initial database connection failed:', err.message);
});

// --- EKSPOR APLIKASI UNTUK VERCEL ---
module.exports = app;

// --- JALANKAN SERVER UNTUK LOCALHOST SAJA ---
// Kode di bawah ini HANYA jalan kalau dijalankan di laptop (node src/index.js)
// Di Vercel, kode di bawah ini akan diabaikan (karena require.main !== module)
if (require.main === module) {
  const server = http.createServer(app);
  const PORT = process.env.PORT || 3000;
  
  // Socket hanya jalan di local
  initSocket(server);

  server.listen(PORT, () => {
    console.log(`🚀 Server Local berjalan di port ${PORT}`);
  });
}