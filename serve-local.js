// Local test server that behaves like the Vercel deployment: serves frontend/, supports /admin
// (cleanUrls), and sends the same security headers from vercel.json (including the CSP), so a problem
// that would appear on Vercel appears here first.
//
//   node serve-local.js            then open http://localhost:3000  and  http://localhost:3000/admin
//   node serve-local.js 8080       (use another port)
//
// Needs only Node.js (no installs). Binds to loopback only for safer local testing. Stop with Ctrl+C.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'frontend');
const port = Number(process.argv[2]) || 3000;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const headers = {};
((config.headers || [])[0] || { headers: [] }).headers.forEach((h) => { headers[h.key] = h.value; });

const configJs = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
if (configJs.includes('YOUR_PROJECT_REF') || configJs.includes('YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY')) {
  console.log('\nNOTE: frontend/config.js still has placeholder Supabase settings, so the pages will say they are not connected.');
  console.log('      Add your Supabase project URL and publishable/anon key before testing live requests.\n');
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  else if (!path.extname(urlPath)) urlPath += '.html';          // cleanUrls: /admin -> admin.html
  const file = path.normalize(path.join(root, urlPath));

  Object.keys(headers).forEach((k) => res.setHeader(k, headers[k]));
  res.setHeader('Cache-Control', 'no-store');

  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
}).listen(port, '127.0.0.1', () => {
  console.log('TK27 local test server');
  console.log('  Public form : http://127.0.0.1:' + port + '/');
  console.log('  Admin       : http://127.0.0.1:' + port + '/admin');
  console.log('Press Ctrl+C to stop.');
});
