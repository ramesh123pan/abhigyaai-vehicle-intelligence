const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const runtime = require('./src/config/runtime');
const { createDatabasePool, healthCheck } = require('./src/infrastructure/database');
const { parseCookies, createSessionCookie, readSession } = require('./src/security/session');
const { validRegistration: validateRegistration, expiryLabel: vehicleExpiryLabel, addExpiryStatuses: addVehicleExpiryStatuses } = require('./src/services/vehicle.service');
const { createProviderWorker } = require('./src/workers/provider-worker');
const { readJson: readJsonBody, applyRequestTimeout } = require('./src/middleware/request');
const { createAuthMiddleware } = require('./src/middleware/auth');
const { createSystemRoutes } = require('./src/routes/system.routes');
const { createVehicleRepository } = require('./src/repositories/vehicle.repository');
const { createUsageRepository } = require('./src/repositories/usage.repository');
const { createVehicleController } = require('./src/controllers/vehicle.controller');
const { createAuthController } = require('./src/controllers/auth.controller');
const { createAdminController } = require('./src/controllers/admin.controller');
const { createPlanController } = require('./src/controllers/plan.controller');
const { createProfileController } = require('./src/controllers/profile.controller');
const { createSettingsController } = require('./src/controllers/settings.controller');
const { createApiKeyController } = require('./src/controllers/api-key.controller');
const { createUsageController } = require('./src/controllers/usage.controller');
const { createAuditController } = require('./src/controllers/audit.controller');
const { createExternalLookupController } = require('./src/controllers/external-lookup.controller');
const { createUsageDetailController } = require('./src/controllers/usage-detail.controller');
const { createSetupController } = require('./src/controllers/setup.controller');
const { createLookupController } = require('./src/controllers/lookup.controller');

const root = __dirname;
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const port = runtime.port;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const CACHE_TTL_MS = runtime.cacheTtlMs;
const REFRESH_COOLDOWN_MS = runtime.refreshCooldownMs;
const sessions = new Map();
const apiRateWindows = new Map();
const sessionTtl = runtime.sessionTtlMs;
const pool = createDatabasePool(runtime.mysql);
const queueEnabled = runtime.queueEnabled;
const redisUrl = runtime.redisUrl;
const queueWaitMs = runtime.queueWaitMs;
const queueDeadlineMs = runtime.queueDeadlineMs;
const queueMaxWaiting = runtime.queueMaxWaiting;
const requestTimeoutMs = runtime.requestTimeoutMs;
const bodyLimitBytes = runtime.bodyLimitBytes;
const sessionSecret = runtime.sessionSecret;
let externalQueue = null, externalWorker = null, externalQueueEvents = null, redisConnection = null;
const localFlights = new Map();
let shuttingDown = false;

async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS vehicle_cache (
    vehicle VARCHAR(20) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    response_json LONGTEXT NOT NULL,
    fetched_at BIGINT NOT NULL,
    last_refresh_at BIGINT NOT NULL,
    INDEX idx_fetched_at (fetched_at),
    PRIMARY KEY (vehicle, provider)
  )`);
  const [columns] = await pool.query('SHOW COLUMNS FROM vehicle_cache LIKE \'provider\'');
  if (!columns.length) {
    await pool.query("ALTER TABLE vehicle_cache ADD COLUMN provider VARCHAR(20) NOT NULL DEFAULT 'lorryinfo' AFTER vehicle");
    await pool.query('ALTER TABLE vehicle_cache DROP PRIMARY KEY, ADD PRIMARY KEY (vehicle, provider)');
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'admin',
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_admin_email (email)
  )`);
  const [adminCols]=await pool.query('SHOW COLUMNS FROM admins'); if(!adminCols.some(x=>x.Field==='avatar_url'))await pool.query('ALTER TABLE admins ADD COLUMN avatar_url LONGTEXT NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, admin_id BIGINT UNSIGNED NULL, action VARCHAR(80) NOT NULL,
    vehicle VARCHAR(20) NULL, details TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), INDEX idx_audit_created (created_at), INDEX idx_audit_admin (admin_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (setting_key VARCHAR(80) NOT NULL PRIMARY KEY, setting_value TEXT NULL, updated_by BIGINT UNSIGNED NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await pool.query("INSERT IGNORE INTO app_settings(setting_key,setting_value) VALUES ('puccRefreshDays','7'),('insuranceRefreshDays','7'),('registrationRefreshDays','7'),('responseMessageOverrides',?)", [JSON.stringify({ OK:'Vehicle details are ready.', INVALID_INPUT:'Please check the vehicle registration number and try again.', REQUEST_FAILED:'We could not complete this request right now. Please try again shortly.', PROVIDER_UNAVAILABLE:'Vehicle information is temporarily unavailable. Please try again shortly.', INTERNAL_ERROR:'We could not complete this request right now. Please try again shortly.', VERIFICATION_FAILED:'Vehicle verification could not be completed.', NO_RECORD_FOUND:'No vehicle record was found for this registration.', SOURCE_UNAVAILABLE:'Vehicle information is temporarily unavailable. Please try again later.', LOOKUP_QUEUED:'Your request is being processed. Please try again shortly.', QUEUE_FULL:'Too many requests are being processed. Please try again shortly.', INVALID_API_KEY:'The supplied access key is not valid.', MISSING_API_KEY:'An access key is required.', RATE_LIMITED:'Request limit reached. Please try again later.' })]);
  await pool.query(`CREATE TABLE IF NOT EXISTS api_plans (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(100) NOT NULL, monthly_call_limit INT NOT NULL DEFAULT 1000, rate_limit_per_minute INT NOT NULL DEFAULT 60, price DECIMAL(12,2) NOT NULL DEFAULT 0, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id), UNIQUE KEY uq_api_plan_name(name))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS api_usage_logs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, api_key_id BIGINT UNSIGNED NULL, plan_id BIGINT UNSIGNED NULL, vehicle VARCHAR(20) NULL, endpoint VARCHAR(160) NOT NULL, source VARCHAR(30) NULL, status_code INT NULL, cache_hit TINYINT(1) NOT NULL DEFAULT 0, client_ip VARCHAR(120) NULL, forwarded_for TEXT NULL, user_agent TEXT NULL, device_type VARCHAR(30) NULL, accept_language VARCHAR(255) NULL, referer VARCHAR(500) NULL, request_host VARCHAR(255) NULL, location_status VARCHAR(80) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id), INDEX idx_usage_created(created_at), INDEX idx_usage_key_month(api_key_id,created_at), INDEX idx_usage_plan_month(plan_id,created_at))`);
  const [usageCols]=await pool.query('SHOW COLUMNS FROM api_usage_logs'); const usageNames=new Set(usageCols.map(x=>x.Field));
  for(const [name,type] of [['client_ip','VARCHAR(120) NULL'],['forwarded_for','TEXT NULL'],['user_agent','TEXT NULL'],['device_type','VARCHAR(30) NULL'],['accept_language','VARCHAR(255) NULL'],['referer','VARCHAR(500) NULL'],['request_host','VARCHAR(255) NULL'],['location_status','VARCHAR(80) NULL']]) if(!usageNames.has(name)) await pool.query(`ALTER TABLE api_usage_logs ADD COLUMN ${name} ${type}`);
  await pool.query(`INSERT IGNORE INTO api_plans(name,monthly_call_limit,rate_limit_per_minute,price) VALUES('Default',1000,60,0)`);
  await pool.query(`INSERT IGNORE INTO api_plans(name,monthly_call_limit,rate_limit_per_minute,price) VALUES
    ('Starter',1000,30,499),
    ('Growth',5000,120,1499),
    ('Business',25000,300,3999),
    ('Enterprise',100000,1000,9999)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS external_api_keys (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(120) NOT NULL, key_hash CHAR(64) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1, rate_limit_per_minute INT NOT NULL DEFAULT 60, daily_limit INT NOT NULL DEFAULT 1000,
    expires_at DATETIME NULL, allowed_ips TEXT NULL, created_by BIGINT UNSIGNED NULL, last_used_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id), UNIQUE KEY uq_external_key_hash(key_hash)
  )`);
  const [apiCols]=await pool.query('SHOW COLUMNS FROM external_api_keys'); const colNames=new Set(apiCols.map(x=>x.Field));
  if(!colNames.has('rate_limit_per_minute'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN rate_limit_per_minute INT NOT NULL DEFAULT 60');
  if(!colNames.has('daily_limit'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN daily_limit INT NOT NULL DEFAULT 1000');
  if(!colNames.has('expires_at'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN expires_at DATETIME NULL');
  if(!colNames.has('allowed_ips'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN allowed_ips TEXT NULL');
  if(!colNames.has('application_url'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN application_url VARCHAR(500) NULL');
  if(!colNames.has('application_address'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN application_address TEXT NULL');
  if(!colNames.has('plan_id'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN plan_id BIGINT UNSIGNED NULL');
  if(!colNames.has('topup_credits'))await pool.query('ALTER TABLE external_api_keys ADD COLUMN topup_credits INT NOT NULL DEFAULT 0');
  await pool.query(`CREATE TABLE IF NOT EXISTS api_topup_ledger (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, api_key_id BIGINT UNSIGNED NOT NULL, credits INT NOT NULL, balance_after INT NOT NULL, action VARCHAR(30) NOT NULL DEFAULT 'credit', reference VARCHAR(120) NULL, created_by BIGINT UNSIGNED NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id), INDEX idx_topup_key_created(api_key_id,created_at))`);
  const [topupCols]=await pool.query('SHOW COLUMNS FROM api_topup_ledger'); const topupNames=new Set(topupCols.map(x=>x.Field));
  if(!topupNames.has('package_name'))await pool.query('ALTER TABLE api_topup_ledger ADD COLUMN package_name VARCHAR(100) NULL AFTER api_key_id');
  if(!topupNames.has('amount'))await pool.query('ALTER TABLE api_topup_ledger ADD COLUMN amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER credits');
  await pool.query(`CREATE TABLE IF NOT EXISTS api_topup_packages (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(100) NOT NULL, credits INT NOT NULL, price DECIMAL(12,2) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id), UNIQUE KEY uq_topup_package_name(name))`);
  await pool.query(`INSERT IGNORE INTO api_topup_packages(name,credits,price) VALUES ('100 calls',100,99),('500 calls',500,399),('1,000 calls',1000,699),('5,000 calls',5000,2999)`);
  await pool.query("UPDATE external_api_keys k JOIN api_plans p ON p.name='Default' SET k.plan_id=p.id WHERE k.plan_id IS NULL");
}
function send(res, status, body, type = 'application/json; charset=utf-8') { if(type.startsWith('application/json')){try{const payload=JSON.parse(body);if(payload&&payload.data&&(payload.data.result||payload.data.rc_number)){body=JSON.stringify(addExpiryStatuses(payload));}if(payload&&payload.charged===true&&payload.success===false&&Number(payload.status_code)>=400)status=Number(payload.status_code)}catch{}}res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); res.end(body); }
function jsonError(res, status, message, code) { return send(res, status, JSON.stringify({ success: false, message, ...(code ? { message_code: code } : {}) })); }
const nativeFetch=globalThis.fetch;
async function fetchWay2ApiWithRetry(url, options, maxRetries=2) { let last; for(let attempt=0;attempt<=maxRetries;attempt++){ try { const response=await nativeFetch(url,options),text=await response.text(); let payload; try{payload=JSON.parse(text)}catch{} const retryable=payload?.charged===false&&(payload?.message_code==='REQUEST_FAILED'||payload?.data?.error_code==='backend_down'); last={response,text,payload,attempt}; if(!retryable||attempt===maxRetries)return last; await new Promise(resolve=>setTimeout(resolve,250*(attempt+1))); } catch(error){throw error} } return last; }
globalThis.fetch=async(url,options)=>{if(String(url).includes('way2api.com')){const result=await fetchWay2ApiWithRetry(url,options);if(result.payload?.charged===false&&(result.payload?.message_code==='REQUEST_FAILED'||result.payload?.data?.error_code==='backend_down')){const error=new Error('Way2API transient backend failure after retry');error.code='WAY2API_REQUEST_FAILED';throw error}return new Response(result.text,{status:result.response.status,statusText:result.response.statusText,headers:result.response.headers})}return nativeFetch(url,options)};
function cookies(req) { return parseCookies(req); }
function sessionCookie(session) { return createSessionCookie(session, sessionSecret, sessionTtl); }
function readSessionFromRequest(req) { return readSession(req, sessionSecret); }
function authenticated(req) { return Boolean(readSessionFromRequest(req)); }
function currentSession(req) { return readSessionFromRequest(req); }
async function audit(req, action, vehicle, details) { const s=currentSession(req); if(s) await pool.query('INSERT INTO audit_logs (admin_id,action,vehicle,details) VALUES (?,?,?,?)',[s.adminId||null,action,vehicle||null,details?JSON.stringify(details):null]); }
function requestMetadata(req){const forwarded=String(req.headers['x-forwarded-for']||'').trim(),ip=(forwarded.split(',')[0].trim()||String(req.socket.remoteAddress||'')).replace(/^::ffff:/,'');const ua=String(req.headers['user-agent']||'').slice(0,2000),device=/mobile|android|iphone|ipad/i.test(ua)?'Mobile':/tablet/i.test(ua)?'Tablet':ua?'Desktop/API client':'Unknown';const privateIp=/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|127\.|::1$)/.test(ip);return {clientIp:ip||null,forwardedFor:forwarded||null,userAgent:ua||null,deviceType:device,acceptLanguage:String(req.headers['accept-language']||'').slice(0,255)||null,referer:String(req.headers.referer||'').slice(0,500)||null,requestHost:String(req.headers.host||'').slice(0,255)||null,locationStatus:privateIp?'Private/local IP; geographic location unavailable':'IP captured; geographic lookup not configured'};}
async function auditExternal(req,key,action,vehicle,details) { if(key.id) await pool.query('UPDATE api_usage_logs SET vehicle=?,source=?,status_code=?,cache_hit=? WHERE id=?',[vehicle,details?.source||null,details?.statusCode??200,details?.source==='mysql'?1:0,details.usageId]); try{await pool.query('INSERT INTO audit_logs (admin_id,action,vehicle,details) VALUES (NULL,?,?,?)',[action,vehicle,JSON.stringify({...details,client:key.name})])}catch(error){console.error('Audit log write failed:',error.code||'ERROR',error.message)} }
async function finalizeUsage(usageId,fields){if(!usageId)return;try{await pool.query('UPDATE api_usage_logs SET vehicle=COALESCE(?,vehicle),source=COALESCE(?,source),status_code=COALESCE(?,status_code),cache_hit=COALESCE(?,cache_hit) WHERE id=?',[fields.vehicle??null,fields.source??null,fields.statusCode??null,fields.cacheHit??null,usageId])}catch(error){console.error('Usage row finalization failed:',error.code||'ERROR',error.message)}}
const authMiddleware = createAuthMiddleware({ readSession: readSessionFromRequest, unauthorized: res => send(res, 401, JSON.stringify({ message: 'Authentication required' })) });
function protectedApi(req, res) { return authMiddleware.requireAuthentication(req, res); }
function hashPassword(password) { return new Promise((resolve, reject) => crypto.scrypt(password, process.env.PASSWORD_PEPPER || '', 64, (error, derived) => error ? reject(error) : resolve(derived.toString('hex')))); }
async function verifyPassword(password, stored) { const actual = await hashPassword(password); return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(stored, 'hex')); }
const readJson = req => readJsonBody(req, bodyLimitBytes);
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function validEmail(value) { const email=normalizeEmail(value); if(email.length<5||email.length>190||/\s/.test(email)||email.includes('..')) return false; const parts=email.split('@'); if(parts.length!==2||!parts[0]||!parts[1]||parts[0].length>64||parts[1].length>253) return false; return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) && /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(parts[1]); }
function validPhone(value) { return /^\+?[1-9]\d{9,14}$/.test(String(value||'').replace(/[\s()-]/g,'')); }
function hashApiKey(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
async function consumeRateLimit(key, limit, windowSeconds) {
  if (redisConnection && redisConnection.status === 'ready') {
    const count = await redisConnection.incr(`vdesk:ratelimit:${key}`);
    if (count === 1) await redisConnection.expire(`vdesk:ratelimit:${key}`, windowSeconds);
    return count <= limit;
  }
  const now = Date.now(), state = apiRateWindows.get(key) || { count: 0, expires: now + windowSeconds * 1000 };
  if (state.expires <= now) { state.count = 0; state.expires = now + windowSeconds * 1000; }
  state.count++;
  apiRateWindows.set(key, state);
  return state.count <= limit;
}
const validRegistration = validateRegistration;
const expiryLabel = vehicleExpiryLabel;
const addExpiryStatuses = addVehicleExpiryStatuses;
async function externalKey(req) { const raw=req.headers['x-api-key'] || String(req.headers.authorization||'').replace(/^Bearer\s+/i,''); if(!raw)return {error:'Missing API key'}; const [[row]]=await pool.query('SELECT * FROM external_api_keys WHERE key_hash=? AND active=1 LIMIT 1',[hashApiKey(raw)]); if(!row)return {error:'Invalid API key'}; if(row.expires_at&&new Date(row.expires_at)<new Date())return {error:'API key expired'}; const metadata=requestMetadata(req),allowed=String(row.allowed_ips||'').split(',').map(x=>x.trim()).filter(Boolean);if(allowed.length&&!allowed.includes(metadata.clientIp))return {error:'IP address is not allowed'};const now=Date.now(),day=new Date().toISOString().slice(0,10),minute=Math.floor(now/60000),minuteAllowed=await consumeRateLimit(`${row.id}:${day}:${minute}`,Number(row.rate_limit_per_minute),60);if(!minuteAllowed)return {error:'Per-minute rate limit exceeded',status:429};const dailyAllowed=await consumeRateLimit(`${row.id}:${day}:daily`,Number(row.daily_limit),86400);if(!dailyAllowed)return {error:'Daily API quota exceeded',status:429};await pool.query('UPDATE external_api_keys SET last_used_at=NOW() WHERE id=?',[row.id]);return {row,metadata}; }
async function externalKeyIdentity(req) { const raw=req.headers['x-api-key'] || String(req.headers.authorization||'').replace(/^Bearer\s+/i,''); if(!raw)return {error:'Missing API key'}; const [[row]]=await pool.query('SELECT * FROM external_api_keys WHERE key_hash=? AND active=1 LIMIT 1',[hashApiKey(raw)]); if(!row)return {error:'Invalid API key'}; if(row.expires_at&&new Date(row.expires_at)<new Date())return {error:'API key expired'}; const metadata=requestMetadata(req),allowed=String(row.allowed_ips||'').split(',').map(x=>x.trim()).filter(Boolean);if(allowed.length&&!allowed.includes(metadata.clientIp))return {error:'IP address is not allowed'}; return {row,metadata}; }
async function emailDnsError(value) { const email=normalizeEmail(value),domain=email.split('@')[1]; if(!validEmail(email)) return 'Enter a valid RFC-style email address'; try { const [mx,ns]=await Promise.all([dns.resolveMx(domain),dns.resolveNs(domain)]); if(!mx?.length) return 'Email domain has no MX mail record'; if(!ns?.length) return 'Email domain has no NS nameserver record'; return null; } catch { return 'Email domain could not be verified through DNS (NS/MX)'; } }

const baseExternalKey=externalKey;externalKey=async req=>{const result=await baseExternalKey(req);if(result.error)return result;const [[plan]]=await pool.query('SELECT * FROM api_plans WHERE id=? AND active=1 LIMIT 1',[result.row.plan_id]);if(!plan)return {error:'API plan is not active',status:403};const month=new Date().toISOString().slice(0,7),[[used]]=await pool.query("SELECT COUNT(*) AS total FROM api_usage_logs WHERE api_key_id=? AND created_at>=STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')",[result.row.id,month]);if(Number(used.total)>=Number(plan.monthly_call_limit))return {error:'Monthly plan quota exceeded',status:429};const m=result.metadata;try{const inserted=await pool.query('INSERT INTO api_usage_logs(api_key_id,plan_id,endpoint,source,status_code,cache_hit,client_ip,forwarded_for,user_agent,device_type,accept_language,referer,request_host,location_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[result.row.id,plan.id,'/api/v1/external/rc',null,null,0,m.clientIp,m.forwardedFor,m.userAgent,m.deviceType,m.acceptLanguage,m.referer,m.requestHost,m.locationStatus]);result.usageId=inserted[0].insertId}catch(error){console.error('API metadata logging failed:',error.code||'ERROR',error.message);result.usageId=null}result.plan=plan;return result};
const quotaGuard=externalKey;externalKey=async req=>{const first=await quotaGuard(req);if(!first.error||!String(first.error).startsWith('Monthly plan quota exceeded'))return first;const raw=req.headers['x-api-key']||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const [[row]]=await pool.query('SELECT * FROM external_api_keys WHERE key_hash=? AND active=1 LIMIT 1',[hashApiKey(raw)]);if(!row||Number(row.topup_credits||0)<=0)return first;const [updated]=await pool.query('UPDATE external_api_keys SET topup_credits=topup_credits-1 WHERE id=? AND topup_credits>0',[row.id]);if(!updated.affectedRows)return first;const [[plan]]=await pool.query('SELECT * FROM api_plans WHERE id=?',[row.plan_id]);const m=requestMetadata(req);const inserted=await pool.query('INSERT INTO api_usage_logs(api_key_id,plan_id,endpoint,source,status_code,cache_hit,client_ip,forwarded_for,user_agent,device_type,accept_language,referer,request_host,location_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[row.id,plan?.id||null,'/api/v1/external/rc',null,null,0,m.clientIp,m.forwardedFor,m.userAgent,m.deviceType,m.acceptLanguage,m.referer,m.requestHost,m.locationStatus]);return {row,metadata:m,plan,usageId:inserted[0].insertId,topupUsed:true};};
async function externalUsageSummary(key) {
  let plan = key.plan;
  if (!plan) {
    const [planRows] = await pool.query('SELECT id,name,monthly_call_limit FROM api_plans WHERE id=? AND active=1 LIMIT 1', [key.row.plan_id]);
    plan = planRows[0];
  }
  if (!plan) return null;
  const month = new Date().toISOString().slice(0, 7);
  const [usageRows] = await pool.query("SELECT COUNT(*) AS used FROM api_usage_logs WHERE api_key_id=? AND created_at>=STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')", [key.row.id, month]);
  const [topupRows] = await pool.query("SELECT COALESCE(SUM(CASE WHEN action='credit' THEN credits ELSE 0 END),0) AS total_top_up_calls FROM api_topup_ledger WHERE api_key_id=?", [key.row.id]);
  const used = Number(usageRows[0]?.used || 0), monthly = Number(plan.monthly_call_limit || 0), totalTopUp = Number(topupRows[0]?.total_top_up_calls || 0), topup = Number(key.row.topup_credits || 0), remaining = Math.max(0, monthly - used);
  return { total_calls: monthly, total_top_up_calls: totalTopUp, used_calls: used, monthly_remaining_calls: remaining, topup_calls: topup, total_remaining_calls: remaining + topup, topup_used: Math.max(0, Math.min(totalTopUp, used - monthly)) };
}
async function addExternalUsage(payload, key) { try { const parsed = JSON.parse(payload), usage = await externalUsageSummary(key); if (usage) parsed.usage = usage; return JSON.stringify(parsed); } catch { return payload; } }
async function getExpiryRefreshDays() { try { const [rows] = await pool.query("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('puccRefreshDays','insuranceRefreshDays','registrationRefreshDays')"); const values = Object.fromEntries(rows.map(row => [row.setting_key, Number(row.setting_value)])); const safe = value => Number.isFinite(value) && value >= 0 ? Math.min(value, 3650) : 7; return { pucc: safe(values.puccRefreshDays), insurance: safe(values.insuranceRefreshDays), registration: safe(values.registrationRefreshDays) }; } catch { return { pucc: 7, insurance: 7, registration: 7 }; } }
async function getResponseMessageOverrides() { try { const [[row]] = await pool.query("SELECT setting_value FROM app_settings WHERE setting_key='responseMessageOverrides' LIMIT 1"); const parsed = JSON.parse(row?.setting_value || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
function applyMessageOverride(payload, overrides) { try { const parsed = JSON.parse(payload), code = parsed.message_code; const defaults = { OK: 'Vehicle details are ready.', INVALID_INPUT: 'Please check the vehicle registration number and try again.', REQUEST_FAILED: 'We could not complete this request right now. Please try again shortly.', PROVIDER_UNAVAILABLE: 'Vehicle information is temporarily unavailable. Please try again shortly.', INTERNAL_ERROR: 'We could not complete this request right now. Please try again shortly.', VERIFICATION_FAILED: 'Vehicle verification could not be completed.', NO_RECORD_FOUND: 'No vehicle record was found for this registration.', SOURCE_UNAVAILABLE: 'Vehicle information is temporarily unavailable. Please try again later.', LOOKUP_QUEUED: 'Your request is being processed. Please try again shortly.', QUEUE_FULL: 'Too many requests are being processed. Please try again shortly.', INVALID_API_KEY: 'The supplied access key is not valid.', MISSING_API_KEY: 'An access key is required.', RATE_LIMITED: 'Request limit reached. Please try again later.' }; if (code) parsed.message = typeof overrides[code] === 'string' && overrides[code].trim() ? overrides[code].trim() : (defaults[code] || 'We could not complete this request right now. Please try again shortly.'); return JSON.stringify(parsed); } catch { return payload; } }
function providerRetryable(payload, status) {
  // Way2API documents charge state separately from HTTP status. Never retry a
  // charged response, even if it uses HTTP 500/503. Retry only transient,
  // explicitly non-charged provider failures.
  return payload?.charged === false && (['REQUEST_FAILED','PROVIDER_UNAVAILABLE','INTERNAL_ERROR'].includes(payload?.message_code) || [500,503].includes(Number(status)));
}
function queueError(code, message, status=503) { const error = new Error(message); error.code = code; error.status = status; return error; }
const providerWorker = createProviderWorker({ pool, queueError, providerRetryable, fetchImpl: nativeFetch, providerBaseUrl: process.env.WAY2API_BASE_URL || 'https://app.way2api.com/api/v1', providerApiKey: process.env.WAY2API_API_KEY });
const vehicleRepository = createVehicleRepository(pool);
const usageRepository = createUsageRepository(pool);
const vehicleController = createVehicleController({ repository: vehicleRepository, send, audit });
const authController = createAuthController({ pool, readJson, normalizeEmail, validEmail, verifyPassword, createSessionCookie: session => sessionCookie(session), sessionTtl, currentSession, audit, send });
const adminController = createAdminController({ pool, readJson, emailDnsError, validPhone, hashPassword, normalizeEmail, audit, send });
const planController = createPlanController({ pool, readJson, send });
const profileController = createProfileController({ pool, readJson, currentSession, validEmail, hashPassword, verifyPassword, audit, send });
const settingsController = createSettingsController({ pool, readJson, currentSession, validEmail, audit, send });
const apiKeyController = createApiKeyController({ pool, readJson, hashApiKey, currentSession, audit, send });
const usageController = createUsageController({ pool, send });
const auditController = createAuditController({ pool, readJson, audit, send });
const usageDetailController = createUsageDetailController({ pool, repository: usageRepository, send, exportUsage: require('./usage-export') });
const setupController = createSetupController({ pool, readJson, emailDnsError, validPhone, hashPassword, normalizeEmail, send });
const lookupController = createLookupController({ pool, readJson, validRegistration, cacheTtlMs: CACHE_TTL_MS, refreshCooldownMs: REFRESH_COOLDOWN_MS, getExpiryRefreshDays, getResponseMessageOverrides, applyMessageOverride, audit, send, fetchImpl: nativeFetch });
const callWay2Api = providerWorker.call;
const persistProviderResult = providerWorker.persist;
const runProviderJob = providerWorker.run;
async function initExternalQueue() {
  if (!queueEnabled || !redisUrl) { console.warn('External queue: Redis is not configured; using bounded local single-flight fallback'); return; }
  redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true, retryStrategy: () => null });
  try { await redisConnection.connect(); } catch (error) { console.warn(`External queue: Redis unavailable (${error.code || error.message}); using bounded local single-flight fallback`); redisConnection.disconnect(); redisConnection = null; return; }
  redisConnection.on('error', error => console.error('External queue Redis error:', error.message));
  const connection = { connection: redisConnection };
  externalQueue = new Queue('external-rc-lookups', connection);
  externalQueueEvents = new QueueEvents('external-rc-lookups', connection);
  externalWorker = new Worker('external-rc-lookups', async job => {
    const started = Date.now();
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const result = await runProviderJob(job.data);
        return { status: result.status, text: result.text, attempt: attempt + 1 };
      } catch (error) {
        if (error.code !== 'WAY2API_TRANSIENT' || attempt === 2 || Date.now() - started > queueDeadlineMs) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(8000, 1000 * (2 ** attempt) + Math.floor(Math.random() * 500))));
      }
    }
  }, { ...connection, concurrency: 1, limiter: { max: 5, duration: 60000 } });
  externalWorker.on('failed', (job, error) => console.error('External queue job failed:', job?.id, error.code || error.message));
  console.log('External queue: Redis/BullMQ worker enabled');
}
async function queueProviderLookup(vehicle) {
  const key = `way2api:${vehicle}`;
  if (localFlights.has(key)) return { promise: localFlights.get(key), joined: true };
  if (externalQueue) {
    const lockKey = `vdesk:singleflight:${key}`;
    const lockToken = crypto.randomUUID();
    let lockAcquired;
    try { lockAcquired = await redisConnection.set(lockKey, lockToken, 'NX', 'EX', Math.max(10, Math.ceil(queueDeadlineMs / 1000))); }
    catch (error) { throw queueError('QUEUE_UNAVAILABLE', `Redis single-flight lock unavailable: ${error.message}`, 503); }
    if (!lockAcquired) {
      const waitForExisting = (async () => {
        const deadline = Date.now() + queueWaitMs;
        while (Date.now() < deadline) {
          const [rows] = await pool.query('SELECT response_json FROM vehicle_cache WHERE vehicle=? ORDER BY fetched_at DESC LIMIT 1', [vehicle]);
          if (rows[0]) return { status: 200, text: rows[0].response_json, fromCache: true };
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw queueError('LOOKUP_QUEUED', 'Lookup is still processing', 202);
      })();
      return { promise: waitForExisting, joined: true };
    }
    const counts = await externalQueue.getJobCounts('waiting','active','delayed');
    if (Number(counts.waiting || 0) >= queueMaxWaiting) {
      await redisConnection.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockToken);
      throw queueError('QUEUE_FULL', 'Lookup queue is temporarily full', 503);
    }
    const job = await externalQueue.add('rc-lookup', { vehicle, jobId: crypto.randomUUID() }, { jobId: crypto.randomUUID(), removeOnComplete: 100, removeOnFail: 100, attempts: 1 });
    const resultPromise = job.waitUntilFinished(externalQueueEvents, queueDeadlineMs).finally(async () => {
      externalQueueEvents.removeAllListeners(`completed:${job.id}`);
      try { await redisConnection.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockToken); } catch (error) { console.error('Redis single-flight unlock failed:', error.message); }
    });
    return { promise: resultPromise, joined: false, jobId: job.id };
  }
  if (localFlights.size >= 100) throw queueError('QUEUE_FULL', 'Lookup queue is temporarily full', 503);
  const promise = (async () => { for (let attempt = 0; attempt <= 2; attempt++) { try { return await runProviderJob({vehicle, jobId:crypto.randomUUID()}); } catch (error) { if (error.code !== 'WAY2API_TRANSIENT' || attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, Math.min(8000, 1000 * (2 ** attempt) + Math.floor(Math.random() * 500)))); } } })();
  localFlights.set(key, promise); promise.finally(() => localFlights.delete(key)).catch(() => {});
  return { promise, joined: false };
}
function queueResponse(status, body) { return { status, body: JSON.stringify(body) }; }
const externalLookupController = createExternalLookupController({ externalKey, validRegistration, pool, cacheTtlMs: CACHE_TTL_MS, queueProviderLookup, queueWaitMs, queueError, finalizeUsage, auditExternal, addExternalUsage, getExpiryRefreshDays, getResponseMessageOverrides, applyMessageOverride, send });
const server = http.createServer((req, res) => {
  if (shuttingDown) return jsonError(res, 503, 'Server is shutting down', 'SERVER_SHUTTING_DOWN');
  applyRequestTimeout(req, res, requestTimeoutMs, () => jsonError(res, 408, 'Request timed out', 'REQUEST_TIMEOUT'));
  const externalVehiclePath=req.url.match(/^\/api\/(?:v1\/)?external\/rc\/([^?]+)/);
  if(req.method==='GET'&&externalVehiclePath){const candidate=decodeURIComponent(externalVehiclePath[1]).toUpperCase().replace(/\s+/g,'');if(!validRegistration(candidate))return getResponseMessageOverrides().then(overrides=>send(res,400,applyMessageOverride(JSON.stringify({success:false,message:'Invalid registration number. Use the four-digit final series, for example UP16AN0593.',message_code:'INVALID_INPUT',charged:false}),overrides))).catch(()=>send(res,400,JSON.stringify({success:false,message:'Please check the vehicle registration number and try again.',message_code:'INVALID_INPUT',charged:false})))}
  if (req.method === 'GET' && (req.url.startsWith('/api/external/rc/') || req.url.startsWith('/api/v1/external/rc/'))) { externalLookupController.lookup(req, res); return; }
  // Controller dispatch is kept ahead of the legacy blocks below during the final cleanup.
  if (req.method === 'GET' && req.url === '/api/auth/me') { authController.session(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/auth/login') { authController.login(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/auth/logout') { authController.logout(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/admins') { if (!protectedApi(req, res)) return; adminController.create(req, res); return; }
  if (req.method === 'GET' && req.url === '/api/admins') { if (!protectedApi(req, res)) return; adminController.list(req, res); return; }
  if (req.method === 'PATCH' && req.url.startsWith('/api/admins/')) { if (!protectedApi(req, res)) return; adminController.update(req, res, req.url.split('/').pop()); return; }
  if (req.method === 'DELETE' && req.url.startsWith('/api/admins/')) { if (!protectedApi(req, res)) return; adminController.deactivate(req, res, req.url.split('/').pop()); return; }
  if (req.method === 'GET' && req.url === '/api/plans') { if (!protectedApi(req, res)) return; planController.listPlans(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/plans') { if (!protectedApi(req, res)) return; planController.createPlan(req, res); return; }
  if (req.method === 'PATCH' && req.url.startsWith('/api/plans/')) { if (!protectedApi(req, res)) return; planController.updatePlan(req, res, Number(req.url.split('/').pop())); return; }
  if (req.method === 'GET' && req.url === '/api/topup-packages') { if (!protectedApi(req, res)) return; planController.listPackages(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/topup-packages') { if (!protectedApi(req, res)) return; planController.createPackage(req, res); return; }
  if (req.method === 'PATCH' && req.url.match(/^\/api\/topup-packages\/\d+$/)) { if (!protectedApi(req, res)) return; planController.updatePackage(req, res, Number(req.url.split('/').pop())); return; }
  if (req.method === 'DELETE' && req.url.match(/^\/api\/topup-packages\/\d+$/)) { if (!protectedApi(req, res)) return; planController.deactivatePackage(req, res, Number(req.url.split('/').pop())); return; }
  if (req.method === 'GET' && req.url === '/api/profile') { if (!protectedApi(req, res)) return; profileController.get(req, res); return; }
  if (req.method === 'PATCH' && req.url === '/api/profile') { if (!protectedApi(req, res)) return; profileController.update(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/profile/password') { if (!protectedApi(req, res)) return; profileController.changePassword(req, res); return; }
  if (req.method === 'GET' && req.url === '/api/settings') { if (!protectedApi(req, res)) return; settingsController.get(req, res); return; }
  if (req.method === 'PUT' && req.url === '/api/settings') { if (!protectedApi(req, res)) return; settingsController.update(req, res); return; }
  if (req.method === 'GET' && req.url === '/api/public-settings') { settingsController.publicGet(req, res).catch(() => send(res, 200, '{}')); return; }
  if (req.method === 'GET' && req.url === '/api/external-keys') { if (!protectedApi(req, res)) return; apiKeyController.list(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/external-keys') { if (!protectedApi(req, res)) return; apiKeyController.create(req, res); return; }
  if (req.method === 'PATCH' && req.url.startsWith('/api/external-keys/')) { if (!protectedApi(req, res)) return; apiKeyController.update(req, res, req.url.split('/').pop()); return; }
  if (req.method === 'DELETE' && req.url.startsWith('/api/external-keys/')) { if (!protectedApi(req, res)) return; apiKeyController.deactivate(req, res, req.url.split('/').pop()); return; }
  if (req.method === 'POST' && req.url.match(/^\/api\/external-keys\/\d+\/regenerate$/)) { if (!protectedApi(req, res)) return; apiKeyController.regenerate(req, res, req.url.split('/')[3]); return; }
  if (req.method === 'POST' && req.url.match(/^\/api\/external-keys\/\d+\/plan$/)) { if (!protectedApi(req, res)) return; apiKeyController.assignPlan(req, res, req.url.split('/')[3]); return; }
  if (req.method === 'GET' && req.url === '/api/usage') { if (!protectedApi(req, res)) return; usageController.summary(req, res); return; }
  if (req.method === 'GET' && req.url === '/api/usage/today') { if (!protectedApi(req, res)) return; usageController.today(req, res); return; }
  if (req.method === 'GET' && req.url === '/api/audit') { if (!protectedApi(req, res)) return; auditController.list(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/audit/event') { if (!protectedApi(req, res)) return; auditController.create(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/auth/setup') { setupController.create(req, res); return; }
  if (req.method === 'POST' && req.url.match(/^\/api\/external-keys\/\d+\/topup$/)) { if (!protectedApi(req, res)) return; apiKeyController.creditTopup(req, res, req.url.split('/')[3]); return; }
  if (req.method === 'GET' && /^\/api\/(?:v1\/)?external\/usage(?:\?|$)/.test(req.url)) { usageController.externalSummary(req, res, externalKeyIdentity); return; }
  const usageDetailPath = req.url.match(/^\/api\/usage\/keys\/(\d+)(?:\/export\.(pdf|xlsx))?$/);
  if (req.method === 'GET' && usageDetailPath) { if (!protectedApi(req, res)) return; usageDetailController.get(req, res, Number(usageDetailPath[1]), usageDetailPath[2]); return; }
  if (req.method === 'DELETE' && req.url.startsWith('/api/records/')) { if (!protectedApi(req, res)) return; const vehicle = decodeURIComponent(req.url.slice('/api/records/'.length)).trim().toUpperCase().replace(/\s+/g, ''); if (!vehicle || vehicle.length > 32) return send(res, 400, JSON.stringify({ message: 'Vehicle registration is required' })); vehicleController.remove(req, res, vehicle); return; }
  if (req.method === 'GET' && req.url === '/api/records') { if (!protectedApi(req, res)) return; vehicleController.list(req, res); return; }
  if (req.method === 'GET' && req.url === '/api/dashboard') { if (!protectedApi(req, res)) return; vehicleController.dashboard(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/rc-lookup') { if (!protectedApi(req, res)) return; lookupController.lookup(req, res); return; }
  const keyPath = req.url.match(/^\/key=(\d+)\/?(?:\?.*)?$/); if (req.method === 'GET' && keyPath) { res.writeHead(302, { Location: `/plan/${keyPath[1]}` }); res.end(); return; }
  const cleanPath = req.url.split('?')[0];
  const isPage = !path.extname(cleanPath) || cleanPath.endsWith('.html');
  if(req.method==='GET' && isPage && cleanPath!=='/login' && cleanPath!=='/login.html' && !authenticated(req)) {
    res.writeHead(302,{'Location':'/login?returnTo='+encodeURIComponent(req.url),'Cache-Control':'no-store'});res.end();return;
  }
  if(req.method==='GET' && (cleanPath==='/login'||cleanPath==='/login.html')) {
    if(authenticated(req)){
      const requested=new URL(req.url,'http://localhost').searchParams.get('returnTo')||'/dashboard';
      const safe=/^\/(?:dashboard|search|records|pucc|insurance|fitness|activity|api-docs|user-guide|api-keys|admins|audit|settings|plans|usage|plan\/\d+)\/?(?:\?[^#]*)?$/.test(requested)?requested:'/dashboard';
      res.writeHead(302,{'Location':safe,'Cache-Control':'no-store'});return res.end();
    }
    res.setHeader('Cache-Control','no-store');return send(res,200,fs.readFileSync(path.join(root,'login.html'),'utf8'),'text/html; charset=utf-8');
  }
  if(req.method==='GET' && /^\/plan\/\d+\/?$/.test(cleanPath)) {
    res.setHeader('Cache-Control','no-store');
    return send(res,200,require('./shared-layout')(root),'text/html; charset=utf-8');
  }
  const requested = /^\/plan\/\d+\/?$/.test(cleanPath) ? '/key-details.html' : cleanPath === '/' || !path.extname(cleanPath) ? '/index.html' : cleanPath;
  const file = path.join(root, requested.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const ext = path.extname(file), isStaticAsset = ['.js','.css'].includes(ext);
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': isStaticAsset ? 'public, max-age=300' : 'no-store, no-cache, must-revalidate' }); fs.createReadStream(file).pipe(res);
});

server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 5000);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 10000);

function registerOperationalRoutes() {
  const previous = server.listeners('request')[0];
  server.removeListener('request', previous);
  const systemRoute = createSystemRoutes({ send, jsonError, healthCheck: () => healthCheck(pool) });
  server.on('request', (req, res) => {
    if (systemRoute(req, res)) return;
    return previous.call(server, req, res);
  });
}
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: graceful shutdown started`);
  await new Promise(resolve => server.close(resolve));
  try { await externalWorker?.close(); await externalQueueEvents?.close(); await externalQueue?.close(); await redisConnection?.quit(); } catch (error) { console.error('Queue shutdown failed:', error.message); }
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

registerOperationalRoutes();
initDatabase().then(() => initExternalQueue()).then(() => server.listen(port, () => console.log(`RC Lookup running at http://localhost:${port}`))).catch(error => { console.error('MySQL connection failed:', error.message); process.exit(1); });
