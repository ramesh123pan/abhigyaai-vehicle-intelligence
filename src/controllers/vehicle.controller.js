function toRecord(row) {
  const value = JSON.parse(row.response_json), data = value?.data?.result || value?.data || value;
  return { vehicle: row.vehicle, provider: row.provider, fetched_at: row.fetched_at, status: data.rc_status || data.status || '', pucc: data.rc_pucc_upto || data.pucc_upto || null, insurance: data.rc_insurance_upto || data.insurance_upto || null, fitness: data.rc_fit_upto || data.fit_up_to || null, tax: data.rc_tax_upto || data.tax_upto || null };
}

function createVehicleController({ repository, send, audit }) {
  return {
    async list(req, res) {
      try { const rows = await repository.findAll(); const seen = new Set(); const records = []; for (const row of rows) { if (seen.has(row.vehicle)) continue; seen.add(row.vehicle); records.push(toRecord(row)); } send(res, 200, JSON.stringify({ records })); }
      catch (error) { send(res, 502, JSON.stringify({ message: error.message })); }
    },
    async remove(req, res, vehicle) {
      try { const result = await repository.remove(vehicle); await audit(req, 'vehicle_deleted', vehicle, { deletedRows: result.affectedRows }); send(res, 200, JSON.stringify({ deleted: true, vehicle, deletedRows: result.affectedRows })); }
      catch (error) { send(res, 400, JSON.stringify({ message: error.message })); }
    },
    async dashboard(req, res) {
      try {
        const totals = await repository.totals();
        const rows = await repository.findAll();
        const seen = new Set();
        const records = [];
        for (const row of rows) { if (seen.has(row.vehicle)) continue; seen.add(row.vehicle); records.push(toRecord(row)); }
        const now = Date.now();
        const within30 = key => records.filter(record => { const date = Date.parse(record[key] || ''); return date >= now && date <= now + 30 * 86400000; }).length;
        send(res, 200, JSON.stringify({ totals, recent: records.slice(0, 50), critical: { pucc: within30('pucc'), insurance: within30('insurance'), fitness: within30('fitness'), tax: within30('tax'), active: records.filter(record => String(record.status).toLowerCase() === 'active').length } }));
      } catch (error) { send(res, 502, JSON.stringify({ message: error.message })); }
    }
  };
}

module.exports = { createVehicleController };
