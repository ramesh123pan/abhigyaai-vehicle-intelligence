function sendError(res, send, error, fallbackStatus = 500) { if (!res.headersSent) send(res, Number(error?.status) || fallbackStatus, JSON.stringify({ success: false, message: error?.message || 'Internal server error', message_code: error?.code || 'INTERNAL_ERROR' })); }
module.exports = { sendError };
