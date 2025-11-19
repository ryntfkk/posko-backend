const dotenv = require('dotenv');

dotenv.config();

const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'MIDTRANS_KEY'];

const missingEnvVars = requiredEnvVars.filter(
  (key) => !process.env[key] || process.env[key].trim() === ''
);

if (missingEnvVars.length > 0) {
  const message = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
  console.error(message);
  throw new Error(message);
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  midtransKey: process.env.MIDTRANS_KEY,
  midtransClientKey: process.env.MIDTRANS_CLIENT_KEY,
  midtransMerchantId: process.env.MIDTRANS_MERCHANT_ID,
};

module.exports = config;