const AuthUser = require('./model');

async function register(req, res, next) {
  try {
    const { fullName, email, password, roles = ['customer'] } = req.body;
    const user = new AuthUser({ fullName, email, password, roles });
    await user.save();
    res.status(201).json({ message: 'Registrasi berhasil', data: user });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email } = req.body;
    const user = await AuthUser.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    res.json({ message: 'Login berhasil (dummy)', data: { userId: user._id } });
  } catch (error) {
    next(error);
  }
}

module.exports = { register, login };