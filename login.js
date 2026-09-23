const requestedReturn=new URLSearchParams(location.search).get('returnTo')||'/dashboard';
const safeReturn=/^\/(?:dashboard|search|records|pucc|insurance|fitness|activity|api-docs|api-keys|admins|audit|settings|plans|usage|plan\/\d+)\/?(?:\?[^#]*)?$/.test(requestedReturn)?requestedReturn:'/dashboard';
fetch('/api/auth/me',{cache:'no-store'}).then(response=>response.json()).then(data=>{if(data.authenticated)location.replace(safeReturn)}).catch(()=>{});
document.getElementById('signIn').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button'),error=document.getElementById('error');button.disabled=true;error.textContent='';
  try{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))}),data=await response.json();if(!response.ok)throw Error(data.message||'Sign in failed');location.replace(safeReturn)}catch(e){error.textContent=e.message}finally{button.disabled=false}
});
