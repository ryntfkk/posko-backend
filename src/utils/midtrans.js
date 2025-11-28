const midtransClient = require('midtrans-client');
const env = require('../config/env');

// [FIX] Smart Detection for Midtrans Environment
// Midtrans Sandbox keys always start with "SB-Mid-server-..."
// If the key implies Sandbox, we FORCE sandbox mode, even if NODE_ENV is production (like in Vercel)
const isSandboxKey = env.midtransKey && env.midtransKey.startsWith('SB-');
const useProduction = !isSandboxKey && env.nodeEnv === 'production';

if (env.midtransKey) {
  console.log(`💳 Initializing Midtrans in ${useProduction ? 'PRODUCTION' : 'SANDBOX'} mode`);
}

// Inisialisasi Core Snap
const snap = new midtransClient.Snap({
  isProduction: useProduction,
  serverKey: env.midtransKey,
  clientKey: env.midtransClientKey
});

module.exports = snap;