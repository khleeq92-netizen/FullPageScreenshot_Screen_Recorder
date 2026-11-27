// Static + dynamic fixture server for end-to-end tests.
import http from 'node:http';
import zlib from 'node:zlib';

// Band colour for index i – shared with the checks (bandColor in harness).
export function bandColor(i) { return [(i * 37 + 40) % 256, (i * 91 + 20) % 256, (i * 53 + 90) % 256]; }

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgb) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function bandsPage(q) {
  const n = Number(q.get('n') || 40); const bh = Number(q.get('bh') || 100);
  const sticky = q.get('sticky'); const fixed = q.get('fixed'); const footer = q.get('footer');
  let bands = '';
  for (let i = 0; i < n; i++) { const [r, g, b] = bandColor(i); bands += `<div class="b" style="background:rgb(${r},${g},${b})">band ${i}</div>`; }
  return `<!doctype html><html><head><title>Bands ${n}</title><style>
    html,body{margin:0;padding:0} .b{height:${bh}px;font:14px monospace;color:#fff;padding-left:${q.get('wide') ? 0 : 8}px;box-sizing:border-box}
    ${q.get('wide') ? `.b{width:${q.get('wide')}px}` : ''}
    .hdr{height:60px;background:#000;color:#fff;font:20px sans-serif;display:flex;align-items:center;padding:0 12px;z-index:10}
    .sticky{position:sticky;top:0} .fixed{position:fixed;top:0;left:0;right:0} .foot{position:fixed;bottom:0;left:0;right:0;height:40px;background:#f0f;z-index:10}
    .fab{position:fixed;right:20px;bottom:60px;width:50px;height:50px;border-radius:50%;background:#0ff;z-index:11}
  </style></head><body>
  ${sticky ? '<div class="hdr sticky" id="hdr">STICKY HEADER</div>' : ''}${fixed ? '<div class="hdr fixed" id="hdr">FIXED HEADER</div>' : ''}
  ${bands}
  ${footer ? '<div class="foot"></div><div class="fab"></div>' : ''}
  </body></html>`;
}

function lazyPage() {
  let imgs = '';
  for (let i = 0; i < 30; i++) imgs += `<div style="height:300px;background:#eee"><img loading="lazy" src="/img/${i}.png" width="600" height="250" style="display:block"></div>`;
  return `<!doctype html><html><head><title>Lazy images</title><style>body{margin:0}</style></head><body>
  <h1 style="margin:0;height:100px">Lazy loading test</h1>${imgs}
  <div id="more"></div>
  <script>
    // IntersectionObserver driven content that appears only after scrolling
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.style.background = 'rgb(10, 200, 30)'; e.target.textContent = 'loaded'; io.unobserve(e.target); } });
    for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'late'; d.style.cssText = 'height:200px;background:#ccc'; document.getElementById('more').append(d); io.observe(d); }
  </script></body></html>`;
}

function infinitePage() {
  return `<!doctype html><html><head><title>Infinite</title><style>body{margin:0}.it{height:150px;border-bottom:1px solid #999;font:16px sans-serif}</style></head><body><div id="list"></div>
  <script>let n=0;function add(k){for(let i=0;i<k;i++){const d=document.createElement('div');d.className='it';d.textContent='item '+(n++);d.style.background='hsl('+(n*13%360)+',60%,80%)';list.append(d);}}
  add(30); addEventListener('scroll',()=>{ if (scrollY + innerHeight > document.body.scrollHeight - 800) add(20); });</script></body></html>`;
}

function innerScrollPage() {
  let bands = '';
  for (let i = 0; i < 50; i++) { const [r, g, b] = bandColor(i); bands += `<div style="height:100px;background:rgb(${r},${g},${b});color:#fff">row ${i}</div>`; }
  return `<!doctype html><html><head><title>App layout</title><style>html,body{margin:0;height:100%;overflow:hidden}
  .app{display:grid;grid-template-rows:50px 1fr;height:100%} header{background:#222;color:#fff} main{overflow:auto}</style></head>
  <body><div class="app"><header>App header</header><main id="scroller">${bands}</main></div></body></html>`;
}

function tablePage() {
  let rows = '';
  for (let i = 0; i < 400; i++) rows += `<tr><td>${i}</td><td>Product ${i}</td><td>${(i * 7.31).toFixed(2)}</td><td>${'★'.repeat(i % 5 + 1)}</td></tr>`;
  return `<!doctype html><html><head><title>Table</title><style>table{border-collapse:collapse;width:100%}td{border:1px solid #ccc;padding:6px;font:14px sans-serif}thead th{position:sticky;top:0;background:#333;color:#fff;padding:8px}</style></head><body><h1>Big table</h1><table><thead><tr><th>#</th><th>Name</th><th>Price</th><th>Rating</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function articlePage() {
  const p = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec ullamcorper nulla non metus auctor fringilla. ';
  let body = '';
  for (let i = 0; i < 60; i++) body += `<h2>Section ${i}</h2><p>${p.repeat(4)}</p>${i % 6 === 0 ? `<img src="/img/${i}.png" width="700" height="300">` : ''}`;
  return `<!doctype html><html><head><title>News article</title><style>body{max-width:760px;margin:0 auto;font:18px/1.6 Georgia,serif;padding:0 16px}nav{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px;font:16px sans-serif}</style></head><body><nav>THE DAILY FIXTURE · World · Tech · Sport</nav><h1>Headline of the test article</h1>${body}<footer style="height:200px;background:#222;color:#fff">Footer</footer></body></html>`;
}

function mediaPage() {
  return `<!doctype html><html><head><title>Media test</title><style>body{margin:0;background:#123}canvas{display:block}</style></head><body>
  <canvas id="c" width="1280" height="720" style="width:100vw;height:100vh"></canvas>
  <script>
    const c=document.getElementById('c'),x=c.getContext('2d');let f=0;
    function draw(){f++;x.fillStyle='hsl('+(f%360)+',70%,45%)';x.fillRect(0,0,1280,720);x.fillStyle='#fff';x.font='bold 120px sans-serif';x.fillText('Frame '+f,80,400);requestAnimationFrame(draw);}draw();
    // audible tone for tab-audio tests (starts on first click)
    let ac; addEventListener('click',()=>{ if(ac) return; ac=new AudioContext(); const o=ac.createOscillator(); o.frequency.value=440; o.connect(ac.destination); o.start(); });
  </script></body></html>`;
}

const pages = { '/bands': bandsPage, '/lazy': lazyPage, '/infinite': infinitePage, '/inner': innerScrollPage, '/table': tablePage, '/article': articlePage, '/media': mediaPage };

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const m = u.pathname.match(/^\/img\/(\d+)\.png$/);
    if (m) {
      const i = Number(m[1]);
      setTimeout(() => { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); res.end(png(60, 25, [200, (i * 40) % 256, 50])); }, 150);
      return;
    }
    const fn = pages[u.pathname];
    if (fn) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fn(u.searchParams)); return; }
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Short page</title><h1>Short page</h1><p>Fits in one viewport.</p>'); return; }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
