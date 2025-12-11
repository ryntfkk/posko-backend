const express = require('express');
const cors = require('cors');
const http = require('http');
const env = require('./config/env');
const { i18nMiddleware } = require('./config/i18n');
// Socket diimport untuk inisialisasi
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
const uploadRoutes = require('./modules/upload/routes');
// [BARU] Import Region Routes
const regionRoutes = require('./modules/regions/routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// --- 1. SETUP LOGGING (PENTING UNTUK DEBUGGING 502) ---
// Middleware ini akan mencatat setiap request yang masuk ke EC2
app.use((req, res, next) => {
  const start = Date.now();
  // Tangkap saat response selesai dikirim
  res.on('finish', () => {
    const duration = Date.now() - start;
    const time = new Date().toISOString();
    // Format Log: [WAKTU] METHOD URL STATUS - DURASI
    const logMessage = `[${time}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`;
    
    // Warna log sederhana untuk membedakan error (Status >= 400)
    if (res.statusCode >= 400) {
      console.error('❌ ' + logMessage);
    } else {
      console.log('✅ ' + logMessage);
    }
  });
  next();
});

// --- 2. SETUP CORS YANG LEBIH ROBUST ---
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = env.corsOrigins || [];
    
    // Izinkan request tanpa origin (seperti dari Postman, Mobile App, atau Server-to-Server request)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Log warning tapi jangan crash app, berikan pesan error jelas
      console.warn(`⚠️  CORS Blocked request from origin: ${origin}`);
      callback(new Error(`CORS policy blocked access from origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(i18nMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Tambahan agar bisa parse form-data standar

// --- 3. HEALTH CHECK ROUTES ---
// Route root sederhana untuk cek server hidup (tanpa cek DB)
app.get('/', (req, res) => {
  res.status(200).send('Posko Backend is Running on EC2!');
});

// Database Health Check Endpoint (Detail)
app.get('/api/health', (req, res) => {
  const dbStatus = getConnectionStatus();
  const statusCode = dbStatus.isConnected ? 200 : 503;
  
  res.status(statusCode).json({
    status: dbStatus.isConnected ? 'healthy' : 'unhealthy',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// --- 4. ROUTES APLIKASI ---
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
app.use('/api/upload', requireDbConnection, uploadRoutes);
// [BARU] Daftarkan Region Route
app.use('/api/regions', requireDbConnection, regionRoutes);

// Global Error Handler
app.use(errorHandler);

// --- 5. DB CONNECTION & SERVER STARTUP ---
// Initialize database connection at startup
connectDB().catch((err) => {
  console.error('❌ Critical: Initial database connection failed:', err.message);
  // Kita tidak exit process disini agar server HTTP tetap bisa jalan untuk debugging health check
});

// Menangani error yang tidak tertangkap agar server tidak mati mendadak
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION! Server tetap berjalan. Error:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION! Server tetap berjalan. Reason:', reason);
});

module.exports = app;

// --- EKSKEKUSI SERVER ---
if (require.main === module) {
  const server = http.createServer(app);
  const PORT = process.env.PORT || 4000;
  
  // Inisialisasi Socket.io
  initSocket(server);

  // PENTING: Listen ke '0.0.0.0' agar bisa diakses dari Public IP EC2
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`📡 Menunggu request... (CORS Origins: ${env.corsOrigins ? env.corsOrigins.join(', ') : 'All'})`);
  });
}