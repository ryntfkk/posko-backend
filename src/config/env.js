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

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  // [FIX] Trim keys to prevent accidental whitespace errors
  midtransKey: process.env.MIDTRANS_KEY ? process.env.MIDTRANS_KEY.trim() : undefined,
  midtransClientKey: process.env.MIDTRANS_CLIENT_KEY ? process.env.MIDTRANS_CLIENT_KEY.trim() : undefined,
  midtransMerchantId: process.env.MIDTRANS_MERCHANT_ID ? process.env.MIDTRANS_MERCHANT_ID.trim() : undefined,
};

module.exports = config;