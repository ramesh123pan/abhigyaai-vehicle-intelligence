const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const mysql = require('mysql2/promise');

const root = path.resolve(__dirname, '..');
const envText = fs.readFileSync(path.join(root, '.env'), 'utf8');
for (const line of envText.split(/\r?\n/)) { const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); }
const target = process.env.LOAD_TEST_BASE_URL || 'http://127.0.0.1:4173';
const vehicle = String(process.env.LOAD_TEST_VEHICLE || '').toUpperCase().replace(/\s+/g, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost):4173$/.test(target)) throw new Error('Refusing bootstrap outside local port 4173');
if (!vehicle) throw new Error('Set LOAD_TEST_VEHICLE first');

async function main() {
  const pool = await mysql.createPool({ host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE || 'lorryinfo', connectionLimit: 2 });
  const [[cached]] = await pool.query('SELECT vehicle FROM vehicle_cache WHERE vehicle=? AND fetched_at>? LIMIT 1', [vehicle, Date.now() - 30 * 24 * 60 * 60 * 1000]);
  if (!cached) throw new Error(`Saved vehicle ${vehicle} is not present in the local cache; no load requests were sent.`);
  const email = `load-test-${Date.now()}@local.invalid`;
  const password = crypto.randomBytes(24).toString('base64url');
  const pepper = process.env.PASSWORD_PEPPER || '';
  const hash = await new Promise((resolve, reject) => crypto.scrypt(password, pepper, 64, (error, derived) => error ? reject(error) : resolve(derived.toString('hex'))));
  const [created] = await pool.query('INSERT INTO admins (name,email,phone,password_hash,role,active) VALUES (?,?,?,?,?,1)', ['Local Load Test', email, '9999999999', hash, 'admin']);
  const adminId = created.insertId;
  let exitCode = 1;
  try {
    exitCode = await new Promise(resolve => { const child = spawn(process.execPath, [path.join(__dirname, 'load-saved-vehicle.js')], { cwd: root, env: { ...process.env, TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password, LOAD_TEST_VEHICLE: vehicle, LOAD_TEST_BASE_URL: target }, stdio: 'inherit' }); child.on('close', code => resolve(code ?? 1)); });
  } finally {
    await pool.query('UPDATE admins SET active=0 WHERE id=?', [adminId]);
    await pool.end();
  }
  process.exitCode = exitCode;
}
main().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
