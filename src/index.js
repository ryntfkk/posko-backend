// src/index.js
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
const settingsRoutes = require('./modules/settings/routes');
const voucherRoutes = require('./modules/vouchers/routes');
const earningsRoutes = require('./modules/earnings/routes'); 
const uploadRoutes = require('./modules/upload/routes'); // [PENTING] Import route upload
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Konfigurasi CORS dengan multiple origins yang aman
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = env.corsOrigins;
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(i18nMiddleware);
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.status(200).send('Posko Backend Vercel is Running! ');
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
app.use('/api/settings', requireDbConnection, settingsRoutes);
app.use('/api/vouchers', requireDbConnection, voucherRoutes);
app.use('/api/earnings', requireDbConnection, earningsRoutes); 
app.use('/api/upload', requireDbConnection, uploadRoutes); // [PENTING] Endpoint upload didaftarkan

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
// Di Vercel, kode di bawah ini akan diabaikan (karena require. main !== module)
if (require.main === module) {
  const server = http.createServer(app);
  const PORT = process.env.PORT || 4000;
  
  // Socket hanya jalan di local
  initSocket(server);

  server.listen(PORT, () => {
    console.log(`🚀 Server Local berjalan di port ${PORT}`);
    console.log(`✅ CORS Origins diizinkan: ${env.corsOrigins.join(', ')}`);
  });
}