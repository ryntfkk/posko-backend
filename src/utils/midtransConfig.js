const env = require('../config/env');

const MIDTRANS_CONFIG = {
  MIDTRANS_KEY: env.midtransKey,
  MIDTRANS_CLIENT_KEY: env.midtransClientKey,
  MIDTRANS_MERCHANT_ID: env.midtransMerchantId,
};

function checkMidtransConfig() {
  const missingKeys = Object.entries(MIDTRANS_CONFIG)
    .filter(([, value]) => !value || String(value).trim() === '')
    .map(([key]) => key);

  return {
    isConfigured: missingKeys.length === 0,
    missingKeys,
  };
}

module.exports = { checkMidtransConfig };