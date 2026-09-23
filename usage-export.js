const ExcelJS=require('exceljs');
const PDFDocument=require('pdfkit');
module.exports=async function exportUsage(res,format,key,rows){
  const headers=['Vehicle','Endpoint','HTTP status','Source','Cache hit','IP address','Forwarded for','Device','User agent','Language','Referer','Host','Location status','Time (UTC)'];
  const values=rows.map(r=>[r.vehicle||'Not recorded',r.endpoint,String(r.status_code??'Not recorded'),r.cache_hit?'Cache':r.status_code==null?'Not recorded':'Provider',r.cache_hit?'Yes':'No',r.client_ip||'Not recorded',r.forwarded_for||'Not recorded',r.device_type||'Unknown',r.user_agent||'Not recorded',r.accept_language||'Not recorded',r.referer||'Not recorded',r.request_host||'Not recorded',r.location_status||'Not recorded',new Date(r.created_at).toISOString()]);
  const filename=`site-key-${key.id}-request-history.${format}`;
  let buffer;
  if(format==='xlsx'){
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Request history');
    sheet.addRow(['Site',key.name]);sheet.addRow(['API key ID',Number(key.id)]);sheet.addRow(['Scope','Latest 100 requests for this key']);sheet.addRow([]);sheet.addRow(headers);values.forEach(row=>sheet.addRow(row));
    [22,34,16,16,12,18,24,18,34,18,24,24,42,28].forEach((width,i)=>sheet.getColumn(i+1).width=width);
    sheet.getRow(5).font={bold:true};sheet.views=[{state:'frozen',ySplit:5}];sheet.autoFilter='A5:H'+Math.max(5,sheet.rowCount);
    buffer=Buffer.from(await workbook.xlsx.writeBuffer());
  }else{
    const doc=new PDFDocument({size:'A4',layout:'landscape',margin:36}),chunks=[];
    doc.on('data',chunk=>chunks.push(chunk));const finished=new Promise((resolve,reject)=>{doc.on('end',resolve);doc.on('error',reject)});
    const widths=[58,105,48,48,42,70,78,58,120,58,78,78,112,78];
    const heading=()=>{doc.fillColor('#17233d').font('Helvetica-Bold').fontSize(18).text('Vehicle Desk | Request history');doc.font('Helvetica').fontSize(10).text(`Site: ${key.name} | Key #${key.id}`).text('Latest 100 requests for this key. Times in UTC.');doc.moveDown();let x=36;const y=doc.y;headers.forEach((h,i)=>{doc.font('Helvetica-Bold').text(h,x,y,{width:widths[i]-8});x+=widths[i]});doc.y=y+28};
    heading();if(!values.length)doc.text('No requests recorded.');
    for(const row of values){doc.font('Helvetica').fontSize(9);const height=Math.max(24,...row.map((v,i)=>doc.heightOfString(v,{width:widths[i]-8})+12));if(doc.y+height>doc.page.height-36){doc.addPage();heading();doc.font('Helvetica').fontSize(9)}const y=doc.y;let x=36;row.forEach((v,i)=>{doc.text(v,x,y,{width:widths[i]-8});x+=widths[i]});doc.y=y+height}
    doc.end();await finished;buffer=Buffer.concat(chunks);
  }
  res.writeHead(200,{'Content-Type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store'});res.end(buffer);
};
