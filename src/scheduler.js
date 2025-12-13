const cron = require('node-cron');
const OrderService = require('./modules/orders/service');
const env = require('./config/env');

const initScheduler = () => {
  console.log('⏰ Scheduler System Initialized...');

  // Jadwal: Jalankan setiap hari jam 02:00 pagi (WIB)
  // Format Cron: Minute Hour Day Month DayOfWeek
  cron.schedule('0 2 * * *', async () => {
    console.log('[CRON] Running daily auto-complete for stuck orders...');
    try {
      // Menggunakan cronSecret dari env untuk validasi keamanan internal
      const result = await OrderService.autoCompleteStuckOrders(env.cronSecret);
      console.log(`[CRON] Success. Processed: ${result.found}, Completed: ${result.success}, Failed: ${result.failed}`);
    } catch (error) {
      console.error('[CRON] Failed to execute auto-complete:', error.message);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Jakarta" // Penting: Agar berjalan sesuai jam Indonesia
  });
};

module.exports = { initScheduler };