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

const midtransKeys = ['MIDTRANS_KEY', 'MIDTRANS_CLIENT_KEY', 'MIDTRANS_MERCHANT_ID'];
const missingMidtransKeys = midtransKeys.filter(
  (key) => !process.env[key] || process.env[key].trim() === ''
);

if (missingMidtransKeys.length > 0) {
  console.warn(
    `Midtrans configuration is incomplete. Missing keys: ${missingMidtransKeys.join(
      ', '
    )}. Payment features may be disabled.`
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
    ? process.env.MIDTRANS_IS_PRODUCTION === 'true' 
    : undefined,
};

module.exports = config;