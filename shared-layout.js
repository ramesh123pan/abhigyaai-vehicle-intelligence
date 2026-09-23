// index.html is the single source for application chrome and global styles.
const fs = require('fs');
const path = require('path');
module.exports = function renderDetailPage(root) {
  const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'key-details.html'), 'utf8');
  const styles = [...shell.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('\n');
  const sidebar = shell.match(/<aside class="sidebar">[\s\S]*?<\/aside>/)[0].replace(/href="#/g,'href="/');
  const header = shell.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
  const footer = shell.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  const main = detail.match(/<main>([\s\S]*?)<\/main>/)[1];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Site API Key Details | Vehicle Desk</title><link rel="stylesheet" href="/styles.css">${styles}<link rel="stylesheet" href="/key-details.css"></head><body class="key-details-page">${sidebar}${header}<main class="shell key-content">${main}</main>${footer}<script src="/session.js"></script><script src="/shared-account.js"></script><script src="/key-details.js"></script></body></html>`;
};
