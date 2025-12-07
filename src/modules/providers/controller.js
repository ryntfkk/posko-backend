// src/modules/providers/controller.js
const ProviderService = require('./service');

async function listProviders(req, res, next) {
  try {
    const result = await ProviderService.listProviders(req.user, req.query);

    res.json({
      messageKey: 'providers.list',
      message: 'Berhasil memuat data mitra',
      meta: result.meta,
      data: result.data
    });
  } catch (error) {
    console.error('[PROVIDERS ERROR]', error);
    next(error);
  }
}

async function getProviderById(req, res, next) {
  try {
    const provider = await ProviderService.getProviderById(req.params.id);

    if (!provider) {
      return res.status(404).json({ message: 'Mitra tidak ditemukan' });
    }

    res.json({
      messageKey: 'providers.detail',
      message: 'Detail mitra ditemukan',
      data: provider
    });
  } catch (error) {
    next(error);
  }
}

async function getProviderMe(req, res, next) {
  try {
    const provider = await ProviderService.getProviderMe(req.user.userId);

    if (!provider) {
      return res.status(404).json({ message: 'Profil Mitra belum dibuat' });
    }

    res.json({
      messageKey: 'providers.me',
      message: 'Profil mitra ditemukan',
      data: provider
    });
  } catch (error) {
    next(error);
  }
}

async function createProvider(req, res, next) {
  try {
    const provider = await ProviderService.createProvider(req.body.userId, req.body.services);

    res.status(201).json({
      messageKey: 'providers.created',
      message: 'Provider berhasil didaftarkan',
      data: provider
    });
  } catch (error) {
    // Handle specific error message for existing provider
    if (error.message === 'User ini sudah terdaftar sebagai provider') {
        return res.status(400).json({ message: error.message });
    }
    next(error);
  }
}

async function updateAvailability(req, res, next) {
  try {
    const blockedDates = await ProviderService.updateAvailability(req.user.userId, req.body.blockedDates);

    res.json({
      messageKey: 'providers.availability.updated',
      message: 'Ketersediaan berhasil diperbarui',
      data: blockedDates
    });
  } catch (error) {
    if (error.message === 'Profil mitra tidak ditemukan') return res.status(404).json({ message: error.message });
    next(error);
  }
}

async function updatePortfolio(req, res, next) {
  try {
    const provider = await ProviderService.updatePortfolio(req.user.userId, req.body.portfolioImages);

    res.json({
      messageKey: 'providers.portfolio.updated',
      message: 'Portfolio berhasil diperbarui',
      data: provider
    });
  } catch (error) {
    if (error.message === 'Format portfolio tidak valid') return res.status(400).json({ message: error.message });
    if (error.message === 'Profil mitra tidak ditemukan') return res.status(404).json({ message: error.message });
    next(error);
  }
}

async function updateProviderServices(req, res, next) {
  try {
    const updatedProvider = await ProviderService.updateProviderServices(req.user.userId, req.body.services);

    res.json({
      messageKey: 'providers.services.updated',
      message: 'Layanan berhasil diperbarui',
      data: updatedProvider
    });
  } catch (error) {
    if (error.message === 'Format layanan tidak valid') return res.status(400).json({ message: error.message });
    if (error.message === 'Profil mitra tidak ditemukan') return res.status(404).json({ message: error.message });
    next(error);
  }
}

async function toggleOnlineStatus(req, res, next) {
  try {
    const isOnline = await ProviderService.toggleOnlineStatus(req.user.userId, req.body.isOnline);

    res.json({
      messageKey: 'providers.status.updated',
      message: `Status berhasil diubah menjadi ${isOnline ? 'Online' : 'Offline'}`,
      data: { isOnline }
    });
  } catch (error) {
    if (error.message === 'Profil mitra tidak ditemukan') return res.status(404).json({ message: error.message });
    next(error);
  }
}

async function updateProviderProfile(req, res, next) {
  try {
    const provider = await ProviderService.updateProviderProfile(req.user.userId, req.body);

    res.json({
      messageKey: 'providers.profile.updated',
      message: 'Profil operasional berhasil diperbarui',
      data: provider
    });
  } catch (error) {
    if (error.message === 'Profil mitra tidak ditemukan') return res.status(404).json({ message: error.message });
    next(error);
  }
}

async function verifyProvider(req, res, next) {
  try {
    const provider = await ProviderService.verifyProvider(req.params.id, req.body.status, req.body.rejectionReason);

    res.json({
      message: `Status mitra berhasil diubah menjadi ${req.body.status}`,
      data: provider
    });
  } catch (error) {
    if (error.message.includes('Status harus')) return res.status(400).json({ message: error.message });
    if (error.message === 'Mitra tidak ditemukan') return res.status(404).json({ message: error.message });
    next(error);
  }
}

module.exports = {
  listProviders,
  getProviderById,
  getProviderMe,
  createProvider,
  updateAvailability,
  updatePortfolio,
  updateProviderServices,
  toggleOnlineStatus,
  updateProviderProfile,
  verifyProvider
};