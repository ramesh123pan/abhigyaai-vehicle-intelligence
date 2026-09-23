'use strict';
const keyId=location.pathname.match(/^\/plan\/(\d+)\/?$/)?.[1];
const byId=id=>document.getElementById(id);
// The shell markup and account controls are shared with index.html.
const adminNav=document.querySelector('.side-group:last-child');
for(const [page,label] of [['plans','Plan Management'],['usage','API Usage']]){
  if(!adminNav.querySelector(`[data-page="${page}"]`)){
    const link=document.createElement('a');link.href='/'+page;link.dataset.page=page;link.textContent=label;
    adminNav.insertBefore(link,adminNav.querySelector('[data-page="audit"]'));
  }
}
document.querySelector('[data-page="usage"]').classList.add('side-active');
byId('logoutBtn').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST'});location.reload()});
byId('headerSearchForm').addEventListener('submit',event=>{event.preventDefault();const value=byId('headerSearch').value.trim();if(value)location.href='/records?search='+encodeURIComponent(value)});
const escapeHtml=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let requestRows=[],requestSort={key:'created_at',direction:'desc'};
const requestValue=(row,key)=>key==='source'?(row.cache_hit?'Cache':row.status_code==null?'Not recorded':'Provider'):row[key]??'';
function renderRequestHistory(){
  const header=byId('requests')?.closest('table')?.querySelector('thead tr');
  if(header&&header.children.length!==14)header.innerHTML='<th>Vehicle ↕</th><th>Endpoint ↕</th><th>Status ↕</th><th>Source ↕</th><th>Cache hit</th><th>IP address ↕</th><th>Forwarded for</th><th>Device</th><th>User agent</th><th>Accept language</th><th>Referer</th><th>Request host</th><th>Location</th><th>Time ↕</th>';
  const query=(byId('historySearch')?.value||'').trim().toLowerCase();
  const rows=requestRows.filter(row=>[row.vehicle,row.endpoint,row.status_code,requestValue(row,'source'),row.client_ip,row.forwarded_for,row.user_agent,row.device_type,row.accept_language,row.referer,row.request_host,row.location_status,row.created_at].join(' ').toLowerCase().includes(query));
  rows.sort((a,b)=>{const av=requestValue(a,requestSort.key),bv=requestValue(b,requestSort.key);const an=requestSort.key==='created_at'?Date.parse(av):Number(av);const bn=requestSort.key==='created_at'?Date.parse(bv):Number(bv);const cmp=Number.isNaN(an)||Number.isNaN(bn)?String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'}):an-bn;return requestSort.direction==='asc'?cmp:-cmp});
  byId('requests').innerHTML=rows.map(r=>`<tr><td>${escapeHtml(r.vehicle)}</td><td>${escapeHtml(r.endpoint)}</td><td>${escapeHtml(r.status_code??'Not recorded')}</td><td>${escapeHtml(requestValue(r,'source'))}</td><td>${r.cache_hit?'Yes':'No'}</td><td>${escapeHtml(r.client_ip||'Not recorded')}</td><td>${escapeHtml(r.forwarded_for||'Not recorded')}</td><td>${escapeHtml(r.device_type||'Unknown')}</td><td>${escapeHtml(r.user_agent||'Not recorded')}</td><td>${escapeHtml(r.accept_language||'Not recorded')}</td><td>${escapeHtml(r.referer||'Not recorded')}</td><td>${escapeHtml(r.request_host||'Not recorded')}</td><td>${escapeHtml(r.location_status||'Not recorded')}</td><td>${escapeHtml(new Date(r.created_at).toLocaleString())}</td></tr>`).join('')||'<tr><td colspan="14">No matching requests.</td></tr>';
  byId('historyCount').textContent=`${rows.length} of ${requestRows.length} requests`;
  document.querySelectorAll('[data-sort]').forEach(button=>button.classList.toggle('sorted',button.dataset.sort===requestSort.key));
}
document.addEventListener('input',event=>{if(event.target.id==='historySearch')renderRequestHistory()});
document.addEventListener('click',event=>{const button=event.target.closest('[data-sort]');if(!button)return;requestSort={key:button.dataset.sort,direction:requestSort.key===button.dataset.sort&&requestSort.direction==='asc'?'desc':'asc'};renderRequestHistory()});
async function loadDetails(){
  byId('message').textContent='Loading details…';
  try{
    if(!keyId)throw Error('Invalid site key URL');
    const response=await fetch(`/api/usage/keys/${keyId}`,{cache:'no-store'});
    const data=await response.json();
    if(response.status===401)return;
    if(!response.ok)throw Error(data.message||'Unable to load details');
    const k=data.key,remaining=k.monthly_call_limit==null?'Unassigned':Math.max(0,Number(k.monthly_call_limit)-k.used),status=!k.active?'Inactive':k.expires_at&&new Date(k.expires_at)<new Date()?'Expired':'Active';
    byId('title').textContent=k.name;
    byId('message').textContent=`Site key #${k.id} · ${k.plan_name||'No plan assigned'}`;
    byId('cards').innerHTML=[['Calls this month',k.used],['Calls remaining',remaining],['Top-up credits',k.topup_credits||0],['Monthly allowance',k.monthly_call_limit??'Unassigned'],['Key status',status]].map(([label,value])=>`<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    byId('subscription').innerHTML=`<p>Application: <strong>${escapeHtml(k.name)}</strong></p><p>Site / Postal Address: <span style="white-space:pre-wrap">${escapeHtml(k.application_address||'Not provided')}</span></p><p>Plan: ${escapeHtml(k.plan_name||'Unassigned')}</p>`;
    const priceNode=byId('price');if(priceNode)priceNode.textContent=k.price==null?'No plan assigned':`Current plan price: INR ${Number(k.price).toLocaleString()}`;
    const billsSection=[...document.querySelectorAll('.key-content section')].find(s=>s.querySelector('h2')?.textContent==='Bills');if(billsSection)billsSection.innerHTML='<h2>Bills</h2>'+(data.bills?.length?`<div class="table-wrap"><table><thead><tr><th>Package</th><th>Calls</th><th>Amount</th><th>Reference</th><th>Date</th></tr></thead><tbody>${data.bills.map(b=>`<tr><td>${escapeHtml(b.package_name||'Top-up')}</td><td>${Number(b.credits).toLocaleString()}</td><td>INR ${Number(b.amount||0).toLocaleString()}</td><td>${escapeHtml(b.reference||'—')}</td><td>${new Date(b.created_at).toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`:'<p>No top-up bills yet. Purchased packages will appear here.</p><p id="price"></p>');
    byId('months').innerHTML=data.months.map(m=>`<tr><td>${escapeHtml(m.month)}</td><td>${Number(m.calls)}</td><td>${Number(m.cache_hits)}</td></tr>`).join('')||'<tr><td colspan="3">No monthly usage recorded.</td></tr>';
    requestRows=data.recent||[];renderRequestHistory();
    byId('details').hidden=false;
    renderQuotaActions(k,remaining,status);
    const actions=byId('historyExports');
    if(!actions.dataset.bound){
      actions.dataset.bound='true';
      actions.addEventListener('click',async event=>{const button=event.target.closest('[data-export]');if(!button)return;button.disabled=true;byId('exportMessage').textContent='Preparing download…';try{const response=await fetch(`/api/usage/keys/${keyId}/export.${button.dataset.export}`);if(!response.ok)throw Error('Unable to download report');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`site-key-${keyId}-request-history.${button.dataset.export}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);byId('exportMessage').textContent='Download ready.'}catch(error){byId('exportMessage').textContent=error.message}finally{button.disabled=false}});
    }
  }catch(error){const message=byId('message');if(message)message.textContent=error.message;const details=byId('details');if(details)details.hidden=true}
}
window.addEventListener('pageshow',loadDetails);

function renderQuotaActions(key,remaining,status){
  let panel=byId('quotaActions');
  if(!panel){panel=document.createElement('section');panel.id='quotaActions';byId('cards').after(panel)}
  panel.classList.toggle('quota-exhausted',remaining===0);
  panel.innerHTML=`<h2>${remaining===0?'Quota exhausted':remaining==='Unassigned'?'No plan assigned':'Plan usage'}</h2><p>${remaining===0?'No calls remain this month. Upgrade the plan or choose a fixed-price top-up package.':remaining==='Unassigned'?'Assign an active plan to enable API usage.':'You can update the assigned plan or add a fixed-price top-up package.'}</p>${status!=='Active'?'<p>The key is '+escapeHtml(status.toLowerCase())+'. Changing its plan does not reactivate it.</p>':''}<button type="button" id="changeSitePlan">${remaining===0?'Upgrade / Update Plan':'Update Plan'}</button> <button type="button" id="addTopup">Buy top-up package</button><div id="planChooser" hidden></div><div id="topupForm" hidden><form><label>Top-up package<select name="packageId" id="topupPackage" required><option value="">Loading packages…</option></select></label><label>Reference <input name="reference" placeholder="Payment or admin reference"></label><button>Add package credits</button><p id="topupMessage" role="status"></p></form></div>`;
  byId('addTopup').addEventListener('click',async()=>{byId('topupForm').hidden=false;const select=byId('topupPackage');try{const response=await fetch('/api/topup-packages'),data=await response.json();if(!response.ok)throw Error(data.message||'Unable to load packages');select.innerHTML=(data.packages||[]).filter(p=>p.active).map(p=>`<option value="${p.id}">${escapeHtml(p.name)} · ${Number(p.credits).toLocaleString()} calls · INR ${Number(p.price).toLocaleString()}</option>`).join('')||'<option value="">No packages available</option>'}catch(error){select.innerHTML='<option value="">'+escapeHtml(error.message)+'</option>'}});
  byId('topupForm').querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=event.target,button=form.querySelector('button');button.disabled=true;try{const payload=Object.fromEntries(new FormData(form));payload.packageId=Number(payload.packageId);const result=await fetch(`/api/external-keys/${keyId}/topup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),body=await result.json();if(!result.ok)throw Error(body.message||'Unable to add package credits');await loadDetails();const message=byId('message');if(message)message.textContent+=' · Top-up package added'}catch(error){const topupMessage=byId('topupMessage');if(topupMessage)topupMessage.textContent=error.message}finally{button.disabled=false}});
  byId('changeSitePlan').addEventListener('click',async()=>{
    const chooser=byId('planChooser');chooser.hidden=false;chooser.textContent='Loading available plans…';
    try{
      const response=await fetch('/api/plans'),data=await response.json();if(!response.ok)throw Error(data.message||'Unable to load plans');
      const plans=(data.plans||[]).filter(p=>p.active);
      chooser.innerHTML=`<form id="assignSitePlan"><label>Choose plan<select name="planId" required>${plans.map(p=>`<option value="${Number(p.id)}" ${p.name===key.plan_name?'selected':''}>${escapeHtml(p.name)} · ${Number(p.monthly_call_limit).toLocaleString()} calls/month · INR ${Number(p.price).toLocaleString()}</option>`).join('')}</select></label><p>Calls already used this month (${Number(key.used)}) are retained. A plan limit above this amount is needed to restore remaining calls.</p><button ${plans.length?'':'disabled'}>Save assigned plan</button><p id="assignMessage" role="status"></p></form>`;
      byId('assignSitePlan').addEventListener('submit',async event=>{
        event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
        try{const result=await fetch(`/api/external-keys/${keyId}/plan`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:Number(new FormData(event.target).get('planId'))})}),body=await result.json();if(!result.ok)throw Error(body.message||'Unable to update plan');await loadDetails();byId('message').textContent+=' · Plan updated successfully'}catch(error){byId('assignMessage').textContent=error.message}finally{button.disabled=false}
      });
    }catch(error){chooser.textContent=error.message}
  });
}
