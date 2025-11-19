# Posko - Backend API

Repository ini berisi source code backend untuk aplikasi **Posko**, sebuah platform web dan mobile yang menghubungkan penyedia jasa (service provider) dengan pelanggan [1]. Backend ini dibangun menggunakan **Node.js** dan **MongoDB** [1].

## 🚀 Teknologi yang Digunakan

Berdasarkan blueprint arsitektur, proyek ini menggunakan teknologi berikut:

* **Runtime:** Node.js
* **Framework:** Express.js (untuk REST API) [3]
* **Database:** MongoDB (Cloud Atlas) dengan Mongoose ODM [5, 6]
* **Autentikasi:** JSON Web Token (JWT) & Bcrypt [7, 19]
* **Real-time:** Socket.io (untuk fitur Chat) [9]
* **Payment Gateway:** Midtrans (Snap API) [13]
* **Bahasa Pemrograman:** JavaScript

## 📋 Fitur Utama (Roadmap)

Backend ini dirancang untuk mendukung fitur-fitur berikut:

1.  **Manajemen Pengguna (Auth):** Registrasi, Login, dan pembagian role (Customer & Provider) [18].
2.  **Profil Provider:** Upgrade akun menjadi provider, manajemen layanan, area, dan jadwal [21, 22].
3.  **Pencarian & Kategori:** Filter provider berdasarkan kategori layanan dan lokasi [25].
4.  **Sistem Pemesanan (Order):**
    * *Basic Order:* Mencari provider secara otomatis [30].
    * *Direct Order:* Memilih provider spesifik [32].
5.  **Pembayaran Online:** Integrasi penuh dengan Midtrans [35].
6.  **Chat Real-time:** Komunikasi langsung antara customer dan provider setelah order diterima [51].
7.  **Ulasan & Rating:** Sistem review setelah layanan selesai [60].

## 🧾 Skema User & Contoh Payload

Model `User` menyimpan data profil pelanggan/provider dengan struktur sebagai berikut:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "password": "password-teracak",
  "roles": ["customer"],
  "activeRole": "customer",
  "profilePictureUrl": "https://cdn.example.com/profile/jane.png",
  "bannerPictureUrl": "https://cdn.example.com/banner/jane.png",
  "bio": "Penyedia jasa kebersihan rumah dengan pengalaman 5 tahun.",
  "birthDate": "1995-06-12",
  "phoneNumber": "+6281234567890",
  "address": {
    "province": "Jawa Barat",
    "district": "Bandung",
    "city": "Bandung",
    "detail": "Jl. Merdeka No. 10"
  },
  "location": {
    "type": "Point",
    "coordinates": [107.6098, -6.9147]
  },
  "balance": 0,
  "status": "active"
}
```

Catatan validasi utama:

* `activeRole` harus salah satu dari nilai di `roles` (customer, provider, atau admin).
* `bio` maksimal 500 karakter.
* `phoneNumber` harus 10–15 digit dan boleh diawali tanda `+`.
* `location` menggunakan koordinat `[longitude, latitude]` dengan indeks geospasial `2dsphere` untuk pencarian lokasi.

## 🛠️ Cara Instalasi & Menjalankan (Local Development)

Ikuti langkah ini untuk menjalankan server di komputer Anda:

### 1. Prasyarat
Pastikan Anda sudah menginstal:
* [Node.js](https://nodejs.org/)
* [Git](https://git-scm.com/)

### 2. Clone Repository
```bash
git clone [https://github.com/USERNAME_ANDA/posko-backend.git](https://github.com/USERNAME_ANDA/posko-backend.git)
cd posko-backend