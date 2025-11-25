const Service = require('./model');
const User = require('../../models/User');
const Provider = require('../providers/model');

// GET /api/services (Public)
async function listServices(req, res, next) {
  try {
    const { category } = req.query;
    let filter = { isActive: true };

    if (category) {
      filter.category = { $regex: category.replace(/-/g, ' '), $options: 'i' };
    }

    const services = await Service.find(filter);
    res.json({ message: 'Daftar layanan berhasil diambil', data: services });
  } catch (error) {
    next(error);
  }
}

// POST /api/services (Admin Only)
async function createService(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) {
      return res.status(403).json({ message: 'Akses ditolak. Hanya admin.' });
    }

    const service = new Service(req.body);
    await service.save();

    res.status(201).json({ message: 'Layanan berhasil dibuat', data: service });
  } catch (error) {
    next(error);
  }
}

// --- SEEDING FUNCTION (REALISTIC DATA) ---
async function seedServices(req, res) {
  try {
    // 1. Data Layanan (Service Catalog)
    const servicesData = [
      { key: 'videographer', name: 'Jasa Videographer Pro', category: 'Creative', price: 1500000, icon: '/icons/videographer.png' },
      { key: 'car-inspector', name: 'Inspeksi Mobil Bekas', category: 'Otomotif', price: 300000, icon: '/icons/car-inspector.png' },
      { key: 'car-wash', name: 'Cuci Mobil Panggilan', category: 'Otomotif', price: 60000, icon: '/icons/car-wash.png' },
      { key: 'flat-tire', name: 'Tambal Ban Darurat', category: 'Otomotif', price: 50000, icon: '/icons/flat-tire.png' },
      { key: 'hauling', name: 'Jasa Angkut Barang', category: 'Moving', price: 400000, icon: '/icons/hauling.png' },
      { key: 'janitor', name: 'Daily Cleaning Service', category: 'Cleaning', price: 75000, icon: '/icons/janitor.png' },
      { key: 'locksmith', name: 'Ahli Kunci (Locksmith)', category: 'Home', price: 150000, icon: '/icons/locksmith.png' },
      { key: 'make-up', name: 'Make Up Artist (MUA)', category: 'Beauty', price: 500000, icon: '/icons/make-up.png' },
      { key: 'mc', name: 'Master of Ceremony (MC)', category: 'Event', price: 1000000, icon: '/icons/mc.png' },
      { key: 'moving', name: 'Pindahan Rumah (Full)', category: 'Moving', price: 1200000, icon: '/icons/moving.png' },
      { key: 'nail-art', name: 'Nail Art Home Service', category: 'Beauty', price: 150000, icon: '/icons/nail-art.png' },
      { key: 'photographer', name: 'Fotografer Event', category: 'Creative', price: 1000000, icon: '/icons/photographer.png' },
      { key: 'teknisi-ac', name: 'Service AC Cuci + Freon', category: 'AC', price: 150000, icon: '/icons/air-conditioner.png' },
    ];

    // 2. Data Orang Sungguhan (Real People Dummy Data)
    // Kita mapping manual agar nama dan gender foto sesuai
    const realProviders = [
      { serviceKey: 'videographer', name: 'Raka Aditya', gender: 'men', photoId: 32, address: 'Jl. Pleburan Barat No. 15', dist: 'Semarang Selatan', lat: -6.9932, lng: 110.4203 },
      { serviceKey: 'car-inspector', name: 'Budi Santoso', gender: 'men', photoId: 45, address: 'Jl. Majapahit No. 205', dist: 'Pedurungan', lat: -7.0064, lng: 110.4712 },
      { serviceKey: 'car-wash', name: 'Joko Susilo', gender: 'men', photoId: 12, address: 'Jl. Menoreh Raya No. 8', dist: 'Sampangan', lat: -7.0175, lng: 110.3939 },
      { serviceKey: 'flat-tire', name: 'Bengkel Pak Slamet', gender: 'men', photoId: 67, address: 'Jl. Setiabudi No. 99', dist: 'Banyumanik', lat: -7.0678, lng: 110.4145 },
      { serviceKey: 'hauling', name: 'Hendra Kurniawan', gender: 'men', photoId: 22, address: 'Jl. Arteri Soekarno Hatta', dist: 'Pedurungan', lat: -6.9798, lng: 110.4589 },
      { serviceKey: 'janitor', name: 'Siti Aminah', gender: 'women', photoId: 44, address: 'Jl. Pandanaran No. 30', dist: 'Semarang Tengah', lat: -6.9895, lng: 110.4132 },
      { serviceKey: 'locksmith', name: 'Agus Kunci', gender: 'men', photoId: 55, address: 'Jl. Gajah Mada No. 55', dist: 'Semarang Tengah', lat: -6.9823, lng: 110.4198 },
      { serviceKey: 'make-up', name: 'Dewi Lestari MUA', gender: 'women', photoId: 68, address: 'Jl. Ngesrep Timur V', dist: 'Tembalang', lat: -7.0521, lng: 110.4356 },
      { serviceKey: 'mc', name: 'Choky Sitohang KW', gender: 'men', photoId: 11, address: 'Jl. Pahlawan No. 10', dist: 'Semarang Selatan', lat: -6.9967, lng: 110.4211 },
      { serviceKey: 'moving', name: 'CV. Angkut Jaya', gender: 'men', photoId: 88, address: 'Jl. Kaligawe Raya', dist: 'Genuk', lat: -6.9556, lng: 110.4654 },
      { serviceKey: 'nail-art', name: 'Rina Beauty', gender: 'women', photoId: 33, address: 'Jl. Thamrin No. 25', dist: 'Semarang Tengah', lat: -6.9845, lng: 110.4156 },
      { serviceKey: 'photographer', name: 'Dimas Anggara', gender: 'men', photoId: 29, address: 'Jl. Dr. Wahidin', dist: 'Candi', lat: -7.0156, lng: 110.4256 },
      { serviceKey: 'teknisi-ac', name: 'Teknisi Handal Semarang', gender: 'men', photoId: 76, address: 'Jl. Kedungmundu Raya', dist: 'Tembalang', lat: -7.0234, lng: 110.4567 },
    ];

    const createdProviders = [];

    // Loop untuk membuat Data
    for (const person of realProviders) {
      
      // A. TEMUKAN SERVICE YANG COCOK
      let serviceData = servicesData.find(s => s.key === person.serviceKey);
      
      // Buat Service jika belum ada
      let service = await Service.findOne({ name: serviceData.name });
      if (!service) {
        service = await Service.create({
          name: serviceData.name,
          category: serviceData.category,
          basePrice: serviceData.price,
          description: serviceData.key === 'teknisi-ac' ? 'Cuci AC Split 0.5-2PK + Cek Freon' : `Layanan profesional ${serviceData.name} terpercaya.`,
          iconUrl: serviceData.icon,
          isActive: true
        });
      }

      // B. BUAT USER REALISTIS
      const email = `mitra.${person.serviceKey}@posko.id`;
      let user = await User.findOne({ email });
      
      // Acak sedikit koordinatnya agar tidak menumpuk 100% jika dijalankan ulang
      const latRandom = person.lat + (Math.random() * 0.001);
      const lngRandom = person.lng + (Math.random() * 0.001);

      if (!user) {
        user = await User.create({
          fullName: person.name,
          email: email,
          password: 'password123',
          phoneNumber: '08' + Math.floor(1000000000 + Math.random() * 9000000000),
          roles: ['customer', 'provider'],
          activeRole: 'provider',
          status: 'active',
          // FOTO PROFIL DARI RANDOMUSER.ME
          profilePictureUrl: `https://randomuser.me/api/portraits/${person.gender}/${person.photoId}.jpg`,
          bio: `Halo warga Semarang! Saya ${person.name}, penyedia jasa ${serviceData.name} yang berdomisili di ${person.dist}. Siap melayani dengan sepenuh hati.`,
          address: {
            province: 'Jawa Tengah',
            city: 'Semarang',
            district: person.dist,
            postalCode: '50000',
            detail: person.address
          },
          location: {
            type: 'Point',
            coordinates: [lngRandom, latRandom] // [Lng, Lat]
          }
        });
      }

      // C. JADIKAN PROVIDER
      let provider = await Provider.findOne({ userId: user._id });
      
      if (!provider) {
        provider = await Provider.create({
          userId: user._id,
          rating: (4.2 + Math.random() * 0.8).toFixed(1), // Rating 4.2 - 5.0
          isOnline: true,
          services: [
            {
              serviceId: service._id,
              price: serviceData.price,
              isActive: true
            }
          ]
        });
      } else {
        // Update services jika provider sudah ada
        const hasService = provider.services.some(s => s.serviceId.equals(service._id));
        if (!hasService) {
          provider.services.push({
            serviceId: service._id,
            price: serviceData.price,
            isActive: true
          });
          await provider.save();
        }
      }

      createdProviders.push({
        name: user.fullName,
        service: service.name,
        location: person.dist
      });
    }

    res.json({
      message: '✅ Data Mitra Warga Semarang Berhasil Dibuat!',
      details: 'Nama asli, Foto profil wajah asli, Alamat real Semarang.',
      total: createdProviders.length,
      data: createdProviders
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { listServices, createService, seedServices };