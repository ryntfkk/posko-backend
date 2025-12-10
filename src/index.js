const express = require('express');
const cors = require('cors');
const http = require('http'); // Tetap butuh untuk local dev dan EC2
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
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// [UPDATED] Konfigurasi CORS yang lebih informatif untuk debugging
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = env.corsOrigins || [];
    
    // Allow requests with no origin (like mobile apps, curl requests, or server-to-server)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Log peringatan tapi jangan crash, membantu debug jika frontend deploy URL berubah
      console.warn(`⚠️ CORS blocked request from origin: ${origin}`);
      callback(new Error(`Not allowed by CORS policy: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 200
};

// Middleware: Logger untuk setiap request (PENTING untuk debug 502)
// Ini akan mencatat setiap request yang berhasil masuk ke server EC2
app.use((req, res, next) => {
  const start = Date.now();
  const { method, url } = req;
  
  // Event listener saat response selesai dikirim
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    
    // Log format: [WAKTU] METHOD URL STATUS - DURASI
    console.log(`[${new Date().toISOString()}] ${method} ${url} ${status} - ${duration}ms`);
    
    // Jika status 500 ke atas, beri highlight warning
    if (status >= 500) {
      console.error(`❌ Server Error on ${method} ${url}`);
    }
  });
  
  next();
});

app.use(cors(corsOptions));
app.use(i18nMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Tambahan untuk parsing form data standar

// Health Check Root (Tanpa DB check agar Load Balancer bisa ping cepat)
app.get('/', (req, res) => {
  res.status(200).send('Posko Backend is Running on EC2! ');
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
app.use('/api/upload', requireDbConnection, uploadRoutes);

// Global Error Handler
app.use(errorHandler);

// Global Uncaught Exception Handler (Mencegah server mati mendadak)
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION! Server tetap berjalan, tapi periksa ini:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION! Server tetap berjalan, tapi periksa ini:', reason);
});

// --- DATABASE CONNECTION ---
// Initialize database connection at startup
connectDB().catch((err) => {
  console.error('❌ Initial database connection failed:', err.message);
  // Jangan process.exit(1) di sini agar server HTTP tetap bisa jalan untuk health check log
});

// --- EKSPOR APLIKASI ---
module.exports = app;

// --- JALANKAN SERVER (EC2 / Localhost) ---
// Kode ini akan dieksekusi saat dijalankan dengan `node src/index.js` atau PM2
if (require.main === module) {
  const server = http.createServer(app);
  const PORT = process.env.PORT || 4000; // Pastikan port ini terbuka di Security Group AWS
  
  // Inisialisasi Socket.io
  initSocket(server);

  server.listen(PORT, '0.0.0.0', () => { // Bind ke 0.0.0.0 agar bisa diakses publik (penting untuk EC2)
    console.log(`🚀 Server berjalan di port ${PORT}`);
    console.log(`📡 Menunggu request dari origins: ${env.corsOrigins ? env.corsOrigins.join(', ') : 'All'}`);
  });
}