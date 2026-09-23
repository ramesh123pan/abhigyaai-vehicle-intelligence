// Shared expired-session behavior for every authenticated page.
(()=>{const nativeFetch=window.fetch.bind(window);let redirecting=false;
function loginRedirect(){if(redirecting)return;redirecting=true;document.documentElement.style.visibility='hidden';location.replace('/login?returnTo='+encodeURIComponent(location.pathname+location.search))}
window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(response.status===401)loginRedirect();return response};
window.addEventListener('pageshow',async()=>{try{const response=await nativeFetch('/api/auth/me',{cache:'no-store'});const session=await response.json();if(!session.authenticated)loginRedirect()}catch{}});
})();
