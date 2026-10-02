function createAdminController({ pool, readJson, emailDnsError, validPhone, hashPassword, normalizeEmail, audit, send }) {
  return {
    async create(req, res) {
      try { const p = await readJson(req), emailError = await emailDnsError(p.email); if (!p.name || emailError || !validPhone(p.phone) || !p.password) return send(res, 400, JSON.stringify({ message: emailError || 'Name, valid email, phone number, and password are required' })); const hash = await hashPassword(String(p.password)); await pool.query('INSERT INTO admins (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)', [p.name, normalizeEmail(p.email), p.phone, hash, p.role || 'admin']); send(res, 201, JSON.stringify({ created: true })); }
      catch (error) { send(res, 400, JSON.stringify({ message: error.code === 'ER_DUP_ENTRY' ? 'Email already exists' : error.message })); }
    },
    async list(req, res) { const [rows] = await pool.query('SELECT id,name,email,phone,role,active,created_at FROM admins ORDER BY created_at DESC'); send(res, 200, JSON.stringify({ admins: rows })); }
    ,async update(req, res, id) { try { const p=await readJson(req); if(p.email){const emailError=await emailDnsError(p.email);if(emailError)return send(res,400,JSON.stringify({message:emailError}));} const passwordHash=String(p.password||'').trim()?await hashPassword(String(p.password)):null; await pool.query('UPDATE admins SET name=COALESCE(?,name),email=COALESCE(?,email),phone=COALESCE(?,phone),role=COALESCE(?,role),active=COALESCE(?,active),password_hash=COALESCE(?,password_hash) WHERE id=?',[p.name||null,p.email?normalizeEmail(p.email):null,p.phone||null,p.role||null,p.active===undefined?null:p.active,passwordHash,id]); await audit(req,'admin_updated',null,{adminId:id,passwordChanged:Boolean(passwordHash)}); send(res,200,JSON.stringify({updated:true,passwordChanged:Boolean(passwordHash)})); } catch(error){send(res,400,JSON.stringify({message:error.code==='ER_DUP_ENTRY'?'Email already exists':error.message}));} }
    ,async deactivate(req, res, id) { const [result]=await pool.query('UPDATE admins SET active=0 WHERE id=?',[id]); await audit(req,'admin_deactivated',null,{adminId:id}); send(res,200,JSON.stringify({updated:true,affectedRows:result.affectedRows})); }
  };
}
module.exports = { createAdminController };
