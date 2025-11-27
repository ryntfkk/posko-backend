const {
  addError,
  respondValidationErrors,
  normalizeString,
  normalizeEmail,
} = require('../../utils/validation');

const allowedRoles = ['customer', 'provider', 'admin'];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\+?[0-9]{10,15}$/;

// [IMPROVEMENT] Pisahkan validasi password strength
function isStrongPassword(password) {
  if (typeof password !== 'string') return false;

  const hasMinLength = password.length >= 8;
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/. test(password);

  return hasMinLength && hasLowercase && hasUppercase && hasNumber;
}

// [IMPROVEMENT] Helper untuk mendapatkan detail kekurangan password
function getPasswordStrengthErrors(password) {
  const errors = [];
  if (password.length < 8) errors.push('minimal 8 karakter');
  if (!/[a-z]/.test(password)) errors.push('huruf kecil');
  if (!/[A-Z]/.test(password)) errors. push('huruf besar');
  if (!/[0-9]/.test(password)) errors.push('angka');
  return errors;
}

function validateCredentials(body, errors, { enforceStrength = true } = {}) {
  const sanitizedEmail = normalizeEmail(body.email);

  if (!sanitizedEmail) {
    addError(errors, 'email', 'validation.email_required', 'Email wajib diisi');
  } else if (!emailRegex.test(sanitizedEmail)) {
    addError(errors, 'email', 'validation.invalid_email', 'Format email tidak valid');
  }

  const password = normalizeString(body. password) || '';
  if (!password) {
    addError(errors, 'password', 'validation.password_required', 'Password wajib diisi');
  } else if (enforceStrength && ! isStrongPassword(password)) {
    // [IMPROVEMENT] Pesan error lebih spesifik
    const missing = getPasswordStrengthErrors(password);
    addError(
      errors,
      'password',
      'validation.password_requirement',
      `Password harus mengandung: ${missing.join(', ')}`
    );
  }

  return { email: sanitizedEmail, password };
}

function validateRegister(req, res, next) {
  const errors = [];
  const body = req.body || {};

  const fullName = normalizeString(body.fullName);
  if (!fullName) {
    addError(errors, 'fullName', 'validation.full_name_required', 'Nama lengkap wajib diisi');
  } else if (fullName.length < 3) {
    addError(errors, 'fullName', 'validation.full_name_too_short', 'Nama lengkap minimal 3 karakter');
  }

  // Validasi credentials dengan strength check
  const credentials = validateCredentials(body, errors, { enforceStrength: true });

  // Validasi roles
  const rolesInput = body.roles ??  ['customer'];
  const roles = (Array.isArray(rolesInput) ?  rolesInput : [rolesInput])
    .map(normalizeString)
    .filter(Boolean);
  const sanitizedRoles = roles.length ?  roles : ['customer'];
  const invalidRoles = sanitizedRoles.filter((role) => !allowedRoles.includes(role));
  if (invalidRoles. length) {
    addError(errors, 'roles', 'validation.role_invalid', 'Role tidak valid', {
      roles: invalidRoles. join(', '),
    });
  }

  const activeRole = normalizeString(body. activeRole);
  if (activeRole && !sanitizedRoles.includes(activeRole)) {
    addError(
      errors,
      'activeRole',
      'validation.active_role_invalid',
      'activeRole harus salah satu dari roles'
    );
  }

  // Validasi phone number
  const phoneNumber = normalizeString(body.phoneNumber) || '';
  if (phoneNumber && !phoneRegex.test(phoneNumber)) {
    addError(errors, 'phoneNumber', 'validation. phone_invalid', 'Format nomor telepon tidak valid (10-15 digit)');
  }

  // Validasi coordinates
  const coordinates = body?. location?.coordinates;
  const hasCoordinates = Array.isArray(coordinates) && coordinates.length === 2;
  const numericCoordinates = hasCoordinates ?  coordinates. map(Number) : [];
  const coordinatesAreValid = numericCoordinates.every(Number.isFinite);

  if (coordinates && !hasCoordinates) {
    addError(
      errors,
      'location. coordinates',
      'validation.invalid_coordinates',
      'Lokasi harus berupa [longitude, latitude]'
    );
  } else if (hasCoordinates && ! coordinatesAreValid) {
    addError(
      errors,
      'location.coordinates',
      'validation.invalid_coordinates',
      'Koordinat harus berupa angka [longitude, latitude]'
    );
  } else if (hasCoordinates) {
    // [FIX] Validasi rentang koordinat
    const [lng, lat] = numericCoordinates;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      addError(
        errors,
        'location.coordinates',
        'validation.coordinates_out_of_range',
        'Koordinat di luar rentang yang valid'
      );
    }
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  // Susun ulang body
  req.body = {
    ...body,
    fullName,
    email: credentials.email,
    password: credentials.password,
    roles: sanitizedRoles,
    activeRole: activeRole || sanitizedRoles[0],
    address: {
      province: normalizeString(body?. address?.province) || '',
      district: normalizeString(body?.address?.district) || '',
      city: normalizeString(body?.address?. city) || '',
      village: normalizeString(body?.address?.village) || '',
      postalCode: normalizeString(body?.address?.postalCode) || '',
      detail: normalizeString(body?.address?.detail) || '',
    },
    location: hasCoordinates
      ? {
          type: normalizeString(body?. location?.type) || 'Point',
          coordinates: numericCoordinates,
        }
      : undefined,
    profilePictureUrl: normalizeString(body. profilePictureUrl) || '',
    bannerPictureUrl: normalizeString(body.bannerPictureUrl) || '',
    bio: normalizeString(body.bio) || '',
    birthDate: body.birthDate ? new Date(body.birthDate) : undefined,
    phoneNumber,
    balance: typeof body.balance === 'number' ? body.balance : undefined,
    status: normalizeString(body.status) || undefined,
  };

  return next();
}

// [FIX] Tidak enforce strength saat login untuk backward compatibility
function validateLogin(req, res, next) {
  const errors = [];
  // enforceStrength: false agar user dengan password lama bisa login
  const credentials = validateCredentials(req.body || {}, errors, { enforceStrength: false });

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  req.body. email = credentials.email;
  req.body.password = credentials. password;
  return next();
}

// [NEW] Validasi untuk refresh token
function validateRefreshToken(req, res, next) {
  const errors = [];
  const refreshToken = normalizeString(req. body?. refreshToken);
  
  if (!refreshToken) {
    addError(errors, 'refreshToken', 'validation.refresh_token_required', 'Refresh token wajib diisi');
  }

  if (errors.length) {
    return respondValidationErrors(req, res, errors);
  }

  return next();
}

module.exports = { validateRegister, validateLogin, validateRefreshToken };