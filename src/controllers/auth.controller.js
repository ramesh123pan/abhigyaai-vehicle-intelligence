function createAuthController({ pool, readJson, normalizeEmail, validEmail, verifyPassword, createSessionCookie, sessionTtl, currentSession, audit, send }) {
  return {
    async session(req, res) {
      const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM admins');
      send(res, 200, JSON.stringify({ authenticated: Boolean(currentSession(req)), setupRequired: Number(count.total) === 0, access: 'admin' }));
    },
    async login(req, res) {
      try {
        const payload = await readJson(req), email = normalizeEmail(payload.email);
        if (!validEmail(email)) return send(res, 400, JSON.stringify({ message: 'Enter a valid email address' }));
        const [[admin]] = await pool.query('SELECT id,name,email,phone,role,password_hash FROM admins WHERE email=? AND active=1 LIMIT 1', [email]);
        if (!admin || !await verifyPassword(String(payload.password || ''), admin.password_hash)) {
          await pool.query('INSERT INTO audit_logs (admin_id,action,details) VALUES (NULL,?,?)', ['login_failed', JSON.stringify({ email })]);
          return send(res, 401, JSON.stringify({ message: 'Invalid email or password' }));
        }
        const token = createSessionCookie({ adminId: admin.id, role: admin.role });
        await pool.query('INSERT INTO audit_logs (admin_id,action,details) VALUES (?,?,?)', [admin.id, 'login', JSON.stringify({ email })]);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `rc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTtl / 1000}` });
        res.end(JSON.stringify({ authenticated: true, access: admin.role, name: admin.name }));
      } catch { send(res, 400, JSON.stringify({ message: 'Invalid login request' })); }
    },
    async logout(req, res) {
      const session = currentSession(req);
      if (session) await pool.query('INSERT INTO audit_logs (admin_id,action) VALUES (?,?)', [session.adminId, 'logout']);
      res.writeHead(200, { 'Set-Cookie': 'rc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0', 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ authenticated: false }));
    }
  };
}

module.exports = { createAuthController };
