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
  const origins = [];
  
  if (process.env.FRONTEND_CUSTOMER_URL) {
    origins.push(process.env.FRONTEND_CUSTOMER_URL.trim());
  }
  
  if (process.env.FRONTEND_PROVIDER_URL) {
    origins.push(process.env.FRONTEND_PROVIDER_URL.trim());
  }
  
  if (process.env.FRONTEND_ADMIN_URL) {
    origins.push(process.env.FRONTEND_ADMIN_URL.trim());
  }
  
  // Development fallback & Local IP Support
  if (process.env.NODE_ENV === 'development') {
    // Pastikan localhost ada
    if (!origins.includes('http://localhost:3000')) origins.push('http://localhost:3000');
    if (!origins.includes('http://localhost:3001')) origins.push('http://localhost:3001');
    if (!origins.includes('http://localhost:3002')) origins.push('http://localhost:3002');
    if (!origins.includes('http://localhost:5173')) origins.push('http://localhost:5173');
    // [UPDATED] IP Network Lokal Anda (PC)
    // Ini mengizinkan akses dari HP ke Frontend di port 3000, 3001, dan 3002
    const myIp = 'http://192.168.0.172';
    
    const localPorts = [3000, 3001, 3002, 5173];
    localPorts.forEach(port => {
      const origin = `${myIp}:${port}`;
      if (!origins.includes(origin)) {
        origins.push(origin);
      }
    });
  }
  
  return origins;
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  
  midtransKey: sanitizeKey(process.env.MIDTRANS_KEY),
  midtransClientKey: sanitizeKey(process.env.MIDTRANS_CLIENT_KEY),
  midtransMerchantId: sanitizeKey(process.env.MIDTRANS_MERCHANT_ID),
  
  // [NEW] Manual Override for Midtrans Environment
  // If this exists in .env, it takes precedence over everything else
  midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION !== undefined 
    ? process.env.MIDTRANS_IS_PRODUCTION === 'false' 
    : undefined,

  // [NEW] CORS Origins Configuration
  corsOrigins: getCorsOrigins(),
};

module.exports = config;