function createAuditController({ pool, readJson, audit, send }) {
  return {
    async list(req,res){const [rows]=await pool.query('SELECT a.id,a.action,a.vehicle,a.details,a.created_at,ad.name,ad.email FROM audit_logs a LEFT JOIN admins ad ON ad.id=a.admin_id ORDER BY a.created_at DESC LIMIT 200');send(res,200,JSON.stringify({logs:rows}));},
    async create(req,res){try{const p=await readJson(req);await audit(req,String(p.action||'activity'),p.vehicle,p.details);send(res,201,JSON.stringify({created:true}));}catch(e){send(res,400,JSON.stringify({message:e.message}));}}
  };
}
module.exports={createAuditController};
