const VALID_STATE_CODES = new Set('AN AP AR AS BR CH CG DD DL DN GA GJ HR HP JK JH KA KL LA LD MP MH MN ML MZ NL OD OR PB PY RJ SK TN TS TR UP UK WB'.split(' '));

function validRegistration(value) {
  const input = String(value || '').toUpperCase();
  if (/^\d{2}BH\d{4}[A-Z]{1,2}$/.test(input)) return true;
  const standard = input.match(/^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{4})$/);
  if (standard) return VALID_STATE_CODES.has(standard[1]) && Number(standard[2]) >= 1;
  const delhi = input.match(/^DL([A-Z0-9]{2,3})([A-Z]{1,3})(\d{4})$/);
  return Boolean(delhi);
}

function expiryLabel(value, now = new Date()) {
  if (!value) return { status: 'unavailable', message: 'Expiry date unavailable', date: null, days_remaining: null };
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)$/) || raw.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})$/);
  let date;
  if (match) date = match[1].length === 4 ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : new Date(Date.UTC(+match[3], +match[2] - 1, +match[1]));
  else date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { status: 'unavailable', message: 'Expiry date unavailable', date: raw, days_remaining: null };
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const target = new Date(date); target.setHours(0, 0, 0, 0);
  const days = Math.ceil((target - today) / 86400000), formatted = target.toISOString().slice(0, 10);
  if (days < 0) return { status: 'expired', message: `Expired on ${formatted}`, date: formatted, days_remaining: days };
  if (days <= 7) return { status: 'expiring_soon', message: `Expires in ${days} day${days === 1 ? '' : 's'}`, date: formatted, days_remaining: days };
  return { status: 'valid', message: `Valid until ${formatted}`, date: formatted, days_remaining: days };
}

function addExpiryStatuses(payload) {
  try {
    const output = typeof payload === 'string' ? JSON.parse(payload) : JSON.parse(JSON.stringify(payload));
    const data = output?.data?.result || output?.data || output;
    const pucc = data?.pucc_upto || data?.rc_pucc_upto;
    const insurance = data?.insurance_upto || data?.rc_insurance_upto;
    const registration = data?.registration_upto || data?.registration_expiry || data?.fit_up_to || data?.rc_fit_upto;
    output.expiry_status = { pucc: expiryLabel(pucc), insurance: expiryLabel(insurance), registration: expiryLabel(registration) };
    return output;
  } catch {
    return payload;
  }
}

module.exports = { validRegistration, expiryLabel, addExpiryStatuses };
