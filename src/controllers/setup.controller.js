function createSetupController({ pool, readJson, emailDnsError, validPhone, hashPassword, normalizeEmail, send }) {
  return {
    async create(req, res) {
      try {
        const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM admins');
        if (Number(count.total) !== 0) return send(res, 403, JSON.stringify({ message: 'Initial setup is already complete' }));
        const payload = await readJson(req);
        const emailError = await emailDnsError(payload.email);
        if (!payload.name || emailError || !validPhone(payload.phone) || !payload.password) return send(res, 400, JSON.stringify({ message: emailError || 'Name, valid email, phone number, and password are required' }));
        await pool.query('INSERT INTO admins (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)', [payload.name, normalizeEmail(payload.email), payload.phone, await hashPassword(String(payload.password)), 'admin']);
        return send(res, 201, JSON.stringify({ created: true }));
      } catch (error) {
        return send(res, 400, JSON.stringify({ message: error.code === 'ER_DUP_ENTRY' ? 'Email already exists' : error.message }));
      }
    }
  };
}

module.exports = { createSetupController };
