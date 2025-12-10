const dotenv = require('dotenv');

dotenv.config();

const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

const missingEnvVars = requiredEnvVars.filter(
  (key) => !process.env[key] || process.env[key].trim() === ''
);

if (missingEnvVars.length > 0) {
  const message = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
  console.error(message);
  throw new Error(message);
}

// Removed MIDTRANS_MERCHANT_ID from required check list
const midtransKeys = ['MIDTRANS_KEY', 'MIDTRANS_CLIENT_KEY']; 
const missingMidtransKeys = midtransKeys.filter(
  (key) => !process.env[key] || process.env[key].trim() === ''
);

if (missingMidtransKeys.length > 0) {
  console.warn(
    `Midtrans configuration is incomplete.Missing keys: ${missingMidtransKeys.join(
      ', '
    )}.Payment features may be disabled.`
  );
}

// Helper: Removes whitespace AND quotes (common Vercel env var issues)
function sanitizeKey(key) {
  if (!key) return undefined;
  let clean = key.trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1);
  }
  return clean;
}

// Build CORS origins array from environment variables
function getCorsOrigins() {
  // Gunakan Set untuk mencegah duplikasi otomatis
  const origins = new Set();
  
  // Fungsi helper untuk menambahkan domain beserta variasi www-nya
  const addDomainWithWWW = (url) => {
    if (!url || url.trim() === '') return;
    
    let cleanUrl = url.trim();
    // Hapus trailing slash jika ada
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }

    // Tambahkan URL asli
    origins.add(cleanUrl);

    try {
      // Parse URL untuk manipulasi host
      const urlObj = new URL(cleanUrl);
      const protocol = urlObj.protocol; // http: atau https:
      const host = urlObj.hostname;

      if (host.startsWith('www.')) {
        // Jika input sudah pakai www, tambahkan versi tanpa www
        const rootDomain = host.replace('www.', '');
        origins.add(`${protocol}//${rootDomain}`);
      } else {
        // Jika input tanpa www, tambahkan versi pakai www
        origins.add(`${protocol}//www.${host}`);
      }
    } catch (e) {
      console.warn(`⚠️ Skipping invalid URL in CORS config: ${cleanUrl}`);
    }
  };

  // Tambahkan URL dari Environment Variables
  addDomainWithWWW(process.env.FRONTEND_CUSTOMER_URL);
  addDomainWithWWW(process.env.FRONTEND_PROVIDER_URL);
  addDomainWithWWW(process.env.FRONTEND_ADMIN_URL);
  
  // Development fallback & Local IP Support
  if (process.env.NODE_ENV === 'development') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3001');
    origins.add('http://localhost:3002');
    origins.add('http://localhost:5173');
    
    // IP Network Lokal Anda (PC)
    const myIp = 'http://192.168.0.172';
    const localPorts = [3000, 3001, 3002, 5173];
    
    localPorts.forEach(port => {
      origins.add(`${myIp}:${port}`);
    });
  }
  
  // Konversi Set kembali ke Array
  return Array.from(origins);
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  
  midtransKey: sanitizeKey(process.env.MIDTRANS_KEY),
  midtransClientKey: sanitizeKey(process.env.MIDTRANS_CLIENT_KEY),
  midtransMerchantId: sanitizeKey(process.env.MIDTRANS_MERCHANT_ID),
  
  // [NEW] Manual Override for Midtrans Environment
  midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION !== undefined 
    ? process.env.MIDTRANS_IS_PRODUCTION === 'false' 
    : undefined,

  // [UPDATED] CORS Origins Configuration (Auto www support)
  corsOrigins: getCorsOrigins(),

  // [NEW] Secret for Cron Jobs
  cronSecret: process.env.CRON_SECRET || 'default_secret_please_change',
};

module.exports = config;