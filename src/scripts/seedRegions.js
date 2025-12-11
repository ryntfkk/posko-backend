// src/scripts/seedRegions.js
require('dotenv').config();
const mongoose = require('mongoose');
const Region = require('../modules/regions/model');
const env = require('../config/env');

// URL API External
const BASE_URL = 'https://www.emsifa.com/api-wilayah-indonesia/api';

// --- CONFIG ---
const MAX_RETRIES = 5;       // Coba ulang sampai 5x jika gagal
const RETRY_DELAY = 3000;    // Tunggu 3 detik sebelum retry

// Helper Fetch dengan Retry yang Kuat
async function fetchData(url, attempt = 1) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt <= MAX_RETRIES) {
      console.warn(`⚠️ Gagal ambil data (${url}). Percobaan ke-${attempt}/${MAX_RETRIES}...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      return fetchData(url, attempt + 1);
    }
    throw error;
  }
}

async function seedRegions() {
  console.log('🌱 MEMULAI SMART SEEDING (AUTO-RESUME)...');
  
  try {
    await mongoose.connect(env.mongoUri || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // 1. Fetch Provinces
    const provinces = await fetchData(`${BASE_URL}/provinces.json`);
    
    for (const prov of provinces) {
      // Cek apakah Provinsi ini sudah "selesai" (punya anak regency)?
      // Kita tetap cek ke dalam untuk memastikan tidak ada data bolong
      
      const provDoc = await Region.findOneAndUpdate(
        { id: prov.id },
        { name: prov.name, type: 'province', parentId: null },
        { upsert: true, new: true }
      );

      // 2. Fetch Regencies
      const regencies = await fetchData(`${BASE_URL}/regencies/${prov.id}.json`);
      
      let skippedDistrictsCount = 0; // Counter untuk log

      for (const reg of regencies) {
        await Region.findOneAndUpdate(
          { id: reg.id },
          { name: reg.name, type: 'regency', parentId: prov.id },
          { upsert: true, new: true }
        );

        // 3. Fetch Districts
        const districts = await fetchData(`${BASE_URL}/districts/${reg.id}.json`);
        
        for (const dist of districts) {
          // --- LOGIKA SMART RESUME ---
          // Cek apakah kecamatan ini SUDAH punya desa di database?
          const existingVillagesCount = await Region.countDocuments({ 
            type: 'village', 
            parentId: dist.id 
          });

          // Jika sudah ada isinya (misal > 5 desa), kita asumsikan sudah selesai. SKIP!
          if (existingVillagesCount > 0) {
            skippedDistrictsCount++;
            continue; // Lanjut ke kecamatan berikutnya tanpa fetch API (CEPAT!)
          }

          // Jika belum ada, baru kita simpan Kecamatan & Ambil Desanya
          await Region.findOneAndUpdate(
            { id: dist.id },
            { name: dist.name, type: 'district', parentId: reg.id },
            { upsert: true, new: true }
          );

          // 4. Fetch Villages (Hanya jika belum ada di DB)
          const villages = await fetchData(`${BASE_URL}/villages/${dist.id}.json`);
          
          if (villages.length > 0) {
            const villageOps = villages.map(v => ({
              updateOne: {
                filter: { id: v.id },
                update: { 
                  $set: { name: v.name, type: 'village', parentId: dist.id } 
                },
                upsert: true
              }
            }));
            await Region.bulkWrite(villageOps);
          }
          // Log kecil biar tau script jalan
          process.stdout.write('.'); 
        }
      }
      
      // Log per Provinsi
      console.log(`\n✅ ${prov.name} Selesai.`);
      if (skippedDistrictsCount > 0) {
        console.log(`   ⏩ Lewati ${skippedDistrictsCount} Kecamatan (Data sudah ada)`);
      }
    }

    console.log('\n✨ ALHAMDULILLAH! SEEDING SELESAI TOTAL!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error Fatal:', error);
    process.exit(1);
  }
}

seedRegions();