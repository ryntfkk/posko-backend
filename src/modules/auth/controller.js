// src/modules/auth/controller.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const User = require('../../models/User');
const Provider = require('../providers/model');

// [HELPER] Sanitize user object untuk response
function sanitizeUser(userDoc) {
  const user = userDoc.toObject();
  delete user.password;
  delete user.refreshTokens;
  return user;
}

// [HELPER] Generate JWT tokens (Updated with providerStatus)
function generateTokens(user, providerStatus = null) {
  const payload = {
    userId: user._id,
    email: user.email,
    roles: user.roles,
    activeRole: user.activeRole,
    role: user.activeRole, // Backward compatibility
    providerStatus: providerStatus // Masukkan status verifikasi ke token
  };

  const accessToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

// [HELPER] Set Cookies untuk Middleware Frontend
function setAuthCookies(res, accessToken, refreshToken) {
  const isProduction = env.nodeEnv === 'production';
  
  // Cookie untuk Access Token
  res.cookie('posko_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000 // 15 menit
  });

  // Cookie untuk Refresh Token
  res.cookie('posko_refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 hari
  });
}

// [HELPER] Clear Cookies saat Logout
function clearAuthCookies(res) {
  const isProduction = env.nodeEnv === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  };

  res.clearCookie('posko_token', cookieOptions);
  res.clearCookie('posko_refresh_token', cookieOptions);
}

// Helper untuk handling MongoDB duplicate key error
function isDuplicateKeyError(error) {
  return error.code === 11000 || error.name === 'MongoServerError' && error.message.includes('duplicate key');
}

// ===================
// REGISTER CUSTOMER
// ===================
async function register(req, res, next) {
  try {
    const {
      fullName, email, password,
      address, location, profilePictureUrl, bannerPictureUrl,
      bio, birthDate, phoneNumber, balance, status,
    } = req.body;

    // Cek email sudah terdaftar sebelum create
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      const messageKey = 'auth.email_already_exists';
      return res.status(409).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Email sudah terdaftar. Silakan gunakan email lain atau login.' 
      });
    }

    // Force role selalu 'customer' untuk pendaftaran publik
    const forcedRoles = ['customer'];
    const forcedActiveRole = 'customer';

    const user = new User({
      fullName, 
      email, 
      password, 
      roles: forcedRoles,
      activeRole: forcedActiveRole,
      address, 
      location, 
      profilePictureUrl, 
      bannerPictureUrl,
      bio, 
      birthDate, 
      phoneNumber, 
      balance, 
      status,
    });
    
    await user.save();
    
    const { accessToken, refreshToken } = generateTokens(user, null);
    
    user.refreshTokens = [refreshToken];
    await user.save();
    
    setAuthCookies(res, accessToken, refreshToken);

    const messageKey = 'auth.register_success';
    const safeUser = sanitizeUser(user);
    
    res.status(201).json({ 
      messageKey, 
      message: req.t ? req.t(messageKey) : 'Registrasi berhasil!', 
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser
      }
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern)[0];
      const messageKey = 'auth.duplicate_entry';
      return res.status(409).json({
        messageKey,
        message: req.t ? req.t(messageKey, { field }) : `${field} sudah terdaftar.`,
      });
    }
    next(error);
  }
}

// ===================
// LOGIN
// ===================
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    
    console.log(`Login attempt for: ${email}`);

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.warn(`Login failed: User not found (${email})`);
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Akun tidak ditemukan. Silakan daftar terlebih dahulu.' 
      });
    }

    if (user.status === 'inactive') {
      console.warn(`Login failed: Account inactive (${email})`);
      const messageKey = 'auth.account_inactive';
      return res.status(403).json({
        messageKey,
        message: req.t ? req.t(messageKey) : 'Akun Anda tidak aktif. Hubungi administrator.'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.warn(`Login failed: Invalid password (${email})`);
      const messageKey = 'auth.invalid_password';
      return res.status(401).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Password salah. Silakan coba lagi.' 
      });
    }

    // Cek data provider
    let providerStatus = null;
    const provider = await Provider.findOne({ userId: user._id });
    
    if (provider) {
      providerStatus = provider.verificationStatus;
      if (providerStatus === 'verified') {
         if (!user.roles.includes('provider')) {
            user.roles.push('provider');
            await user.save();
         }
      }
    }

    const { accessToken, refreshToken } = generateTokens(user, providerStatus);
    
    const MAX_REFRESH_TOKENS = 5;
    if (user.refreshTokens.length >= MAX_REFRESH_TOKENS) {
      user.refreshTokens = user.refreshTokens.slice(-MAX_REFRESH_TOKENS + 1);
    }
    user.refreshTokens.push(refreshToken);
    await user.save();
    
    setAuthCookies(res, accessToken, refreshToken);

    console.log(`Login success for: ${email}`);

    const safeUser = sanitizeUser(user);
    if (providerStatus) {
      safeUser.providerStatus = providerStatus;
    }
    
    res.json({
      messageKey: 'auth.login_success',
      message: req.t ? req.t('auth.login_success') : 'Login berhasil!',
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    next(error);
  }
}

// ===================
// REFRESH TOKEN
// ===================
async function refreshToken(req, res, next) {
  try {
    const refreshToken = req.body.refreshToken || req.cookies?.posko_refresh_token;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh Token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.jwtRefreshSecret);
    } catch (err) {
      const messageKey = 'auth.invalid_refresh_token';
      return res.status(401).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Refresh token tidak valid atau kadaluarsa.' 
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t ? req.t(messageKey) : 'User tidak ditemukan.' });
    }

    if (!user.refreshTokens.includes(refreshToken)) {
      const messageKey = 'auth.token_reuse_detected';
      return res.status(403).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Token tidak dikenali. Silakan login ulang.' 
      });
    }

    let providerStatus = null;
    const provider = await Provider.findOne({ userId: user._id });
    if (provider) {
      providerStatus = provider.verificationStatus;
    }

    const newTokens = generateTokens(user, providerStatus);

    const tokenIndex = user.refreshTokens.indexOf(refreshToken);
    if (tokenIndex !== -1) {
      user.refreshTokens[tokenIndex] = newTokens.refreshToken;
    } else {
      user.refreshTokens.push(newTokens.refreshToken);
    }
    
    if (user.refreshTokens.length > 10) {
        user.refreshTokens = user.refreshTokens.slice(-5);
    }

    await user.save();

    setAuthCookies(res, newTokens.accessToken, newTokens.refreshToken);

    res.json({
      messageKey: 'auth.token_refreshed',
      message: 'Token berhasil diperbarui.',
      data: {
        tokens: newTokens
      }
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// LOGOUT
// ===================
async function logout(req, res, next) {
  try {
    const refreshToken = req.body.refreshToken || req.cookies?.posko_refresh_token;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (user && refreshToken) {
      user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
      await user.save();
    }

    clearAuthCookies(res);

    res.json({
      messageKey: 'auth.logout_success',
      message: 'Logout berhasil.'
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// GET PROFILE
// ===================
async function getProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t ? req.t(messageKey) : 'User tidak ditemukan' });
    }

    const safeUser = sanitizeUser(user);

    const provider = await Provider.findOne({ userId: user._id }).select('verificationStatus');
    if (provider) {
        safeUser.providerStatus = provider.verificationStatus;
    }

    res.json({
      messageKey: 'auth.profile_success',
      message: 'Profile berhasil dimuat',
      data: {
        profile: safeUser
      },
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// UPDATE PROFILE
// ===================
async function updateProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    const updates = { ...req.body };

    // [MODIFIKASI S3] 
    // Jika ada file yang diupload melalui middleware S3 (via route), gunakan location-nya
    if (req.file && req.file.location) {
      updates.profilePictureUrl = req.file.location;
    }
    
    // Filter field yang tidak boleh diupdate manual
    const forbiddenFields = ['password', 'balance', 'roles', 'activeRole', 'email', 'status', 'refreshTokens'];
    forbiddenFields.forEach(field => delete updates[field]);

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    res.json({
      message: 'Profil berhasil diperbarui',
      data: {
        profile: sanitizeUser(user)
      }
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// SWITCH ROLE
// ===================
async function switchRole(req, res, next) {
  try {
    const userId = req.user.userId;
    const { role } = req.body;

    const allowedRoles = ['customer', 'provider'];
    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({ 
        message: 'Role tidak valid. Pilih customer atau provider.' 
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    if (!user.roles.includes(role)) {
      return res.status(403).json({ 
        message: `Anda belum terdaftar sebagai ${role}. Daftar terlebih dahulu.` 
      });
    }

    let providerStatus = null;

    if (role === 'provider') {
        const provider = await Provider.findOne({ userId });
        if (!provider) {
            return res.status(403).json({ message: 'Data mitra tidak ditemukan.' });
        }
        
        providerStatus = provider.verificationStatus;

        if (provider.verificationStatus === 'suspended') {
             return res.status(403).json({ message: 'Akun Mitra Anda ditangguhkan. Hubungi admin.' });
        }
    }

    user.activeRole = role;
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user, providerStatus);

    setAuthCookies(res, accessToken, refreshToken);

    const safeUser = sanitizeUser(user);
    if (providerStatus) {
        safeUser.providerStatus = providerStatus;
    }

    res.json({
      message: `Berhasil beralih ke mode ${role}`,
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser
      }
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// REGISTER PARTNER
// ===================
async function registerPartner(req, res, next) {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    const existingProvider = await Provider.findOne({ userId });
    
    if (existingProvider) {
        if (existingProvider.verificationStatus === 'pending') {
            return res.status(400).json({ message: 'Pendaftaran Anda sedang diproses. Mohon tunggu verifikasi admin.' });
        }
        if (existingProvider.verificationStatus === 'verified') {
             if (!user.roles.includes('provider')) {
                 user.roles.push('provider');
                 user.activeRole = 'provider';
                 await user.save();
             }
             return res.status(400).json({ message: 'Anda sudah terdaftar sebagai Mitra.' });
        }
        if (existingProvider.verificationStatus === 'suspended') {
            return res.status(403).json({ message: 'Akun Mitra Anda ditangguhkan. Hubungi admin.' });
        }
    }

    const { 
      experienceYears, description, serviceCategory, vehicleType,
      nik, dateOfBirth, gender, domicileAddress,
      bankName, bankAccountNumber, bankAccountHolder,
      emergencyName, emergencyRelation, emergencyPhone,
      selectedServices 
    } = req.body;

    const files = req.files || {};

    if (!files['ktp'] || !files['selfieKtp'] || !files['skck']) {
        return res.status(400).json({ message: 'Dokumen KTP, Selfie KTP, dan SKCK wajib diunggah.' });
    }

    // [UBAH LOGIKA S3] Mengambil URL absolut dari properti .location (bukan membuat path lokal)
    const docPaths = {
        ktpUrl: files['ktp'] ? files['ktp'][0].location : '',
        selfieKtpUrl: files['selfieKtp'] ? files['selfieKtp'][0].location : '',
        skckUrl: files['skck'] ? files['skck'][0].location : '',
        certificateUrl: files['certificate'] ? files['certificate'][0].location : ''
    };

    // Struktur Lokasi
    let providerLocation = {
        type: 'Point',
        coordinates: [0, 0],
        address: {
            fullAddress: domicileAddress || '',
            district: '',
            city: '',
            province: '',
            postalCode: ''
        }
    };

    if (user.location && user.location.coordinates && Array.isArray(user.location.coordinates)) {
        const [lng, lat] = user.location.coordinates;
        if (lng !== 0 || lat !== 0) {
            providerLocation.coordinates = [lng, lat];
        }
        if (!domicileAddress && user.address && user.address.detail) {
             providerLocation.address.fullAddress = user.address.detail;
        }
    }

    let parsedServices = [];
    if (selectedServices) {
        try {
            parsedServices = typeof selectedServices === 'string' 
                ? JSON.parse(selectedServices) 
                : selectedServices;
            
            if (!Array.isArray(parsedServices)) throw new Error();
        } catch (e) {
            return res.status(400).json({ message: 'Format layanan yang dipilih tidak valid.' });
        }
    }

    const providerData = {
        userId,
        verificationStatus: 'pending',
        documents: docPaths,
        location: providerLocation,
        personalInfo: {
            nik: nik || '',
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
            gender: gender || 'Laki-laki'
        },
        domicileAddress: domicileAddress || '', 
        bankAccount: {
            bankName: bankName || '',
            accountNumber: bankAccountNumber || '',
            accountHolderName: bankAccountHolder || ''
        },
        emergencyContact: {
            name: emergencyName || '',
            relationship: emergencyRelation || '',
            phoneNumber: emergencyPhone || ''
        },
        details: {
            experienceYears: experienceYears || 0,
            description: description || '',
            serviceCategory: serviceCategory || '',
            vehicleType: vehicleType || ''
        },
        services: parsedServices.map(s => ({
            serviceId: s.serviceId,
            price: Number(s.price),
            description: s.description || '',
            isActive: true
        })),
        rating: existingProvider ? existingProvider.rating : 0
    };

    if (existingProvider) {
        await Provider.updateOne({ userId }, providerData);
    } else {
        await Provider.create(providerData);
    }

    res.json({
      message: 'Pendaftaran lengkap berhasil dikirim! Admin akan memverifikasi data dan dokumen Anda segera.',
      data: {
        verificationStatus: 'pending'
      }
    });

  } catch (error) {
    next(error);
  }
}

// ===================
// ADMIN: LIST ALL USERS
// ===================
async function listAllUsers(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) {
      return res.status(403).json({ message: 'Akses ditolak. Hanya admin.' });
    }

    const { page = 1, limit = 20, search = '' } = req.query;
    
    const filter = {};
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const users = await User.find(filter)
      .select('-password -refreshTokens')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    res.json({
      message: 'Daftar user berhasil diambil',
      data: users,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// ADMIN: TOGGLE USER STATUS
// ===================
async function toggleUserStatus(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) {
      return res.status(403).json({ message: 'Akses ditolak.' });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Status harus active atau inactive' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    res.json({
      message: `Status user berhasil diubah menjadi ${status}`,
      data: user
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// ADMIN: UPDATE USER DATA
// ===================
async function updateUserByAdmin(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) {
      return res.status(403).json({ message: 'Akses ditolak. Hanya admin.' });
    }

    const { id } = req.params;
    const { fullName, email, phoneNumber, bio } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    if (email && email.toLowerCase() !== user.email) {
      const exist = await User.findOne({ email: email.toLowerCase() });
      if (exist) return res.status(400).json({ message: 'Email sudah digunakan user lain' });
      user.email = email.toLowerCase();
    }

    if (fullName) user.fullName = fullName;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (bio !== undefined) user.bio = bio;

    await user.save();

    res.json({
      message: 'Data user berhasil diperbarui',
      data: sanitizeUser(user)
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { 
  register, 
  login, 
  refreshToken, 
  logout,
  getProfile,
  updateProfile, 
  switchRole,
  registerPartner,
  listAllUsers,
  toggleUserStatus,
  updateUserByAdmin
};