const midtransClient = require('midtrans-client');
const env = require('../config/env');

const serverKey = env.midtransKey || '';
const isSandboxKey = serverKey.startsWith('SB-');

// [FIXED LOGIC]
// Priority 1: Manual Override (MIDTRANS_IS_PRODUCTION)
// Priority 2: Auto-detect based on 'SB-' prefix
// Priority 3: Default to Node Environment (Production on Vercel)

let useProduction;

if (env.midtransIsProduction !== undefined) {
  // User explicitly set the variable
  useProduction = env.midtransIsProduction;
  console.log(`⚠️ Midtrans Mode FORCED by MIDTRANS_IS_PRODUCTION to: ${useProduction ? 'PRODUCTION' : 'SANDBOX'}`);
} else {
  // Fallback to auto-detection
  useProduction = !isSandboxKey && env.nodeEnv === 'production';
}

console.log('--- [Midtrans Configuration Analysis] ---');
if (serverKey) {
  const maskedKey = serverKey.length > 8 ? `${serverKey.substring(0, 8)}...` : '***';
  console.log(`🔑 Server Key Prefix: ${maskedKey}`);
  console.log(`🌍 Effective API Mode: ${useProduction ? 'PRODUCTION' : 'SANDBOX'}`);
  
  if (useProduction && !env.midtransIsProduction && isSandboxKey) {
     console.error('❌ WARNING: Sandbox key detected, but Production Mode was auto-selected. This will fail.');
  }
} else {
  console.error('❌ ERROR: MIDTRANS_KEY is missing!');
}
console.log('-----------------------------------------');

const snap = new midtransClient.Snap({
  isProduction: useProduction,
  serverKey: env.midtransKey,
  clientKey: env.midtransClientKey
});

module.exports = snap;