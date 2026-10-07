// Re:ANIME (reanime.to) — Shirox streaming source module
// Flow: /search/__data.json -> /watch/<slug>/__data.json -> /api/flix/<anilistId>/<ep>
//       -> flixcloud.cc /e/ embed -> on-device WASM key-derivation + AES-256-CBC -> master.m3u8
// All decryption is on-device (pure-JS SHA-256 / PBKDF2 / AES + the site's own w_payload WASM).
// Cloudflare is handled with impersonate (Paul's fetchv2 browser-engine commit).

const BASE_URL = 'https://reanime.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

function log(m) { try { console.log('[Reanime] ' + m); } catch (_) {} }

/* ------------------------------------------------------------------ fetch */
async function parseResponseJson(res) {
  if (!res) return null;
  try { if (typeof res.text === 'function') { const t = await res.text(); if (t) return JSON.parse(t); } } catch (_) {}
  try { if (typeof res.json === 'function') return await res.json(); } catch (_) {}
  return null;
}
async function soraFetch(url, options = {}) {
  const opts = options || {};
  const headers = opts.headers || {};
  if (!headers['User-Agent']) headers['User-Agent'] = UA;
  const imp = opts.impersonate !== undefined ? opts.impersonate : 'chrome';
  try {
    return await fetchv2(url, headers, opts.method || 'GET', opts.body || null, imp ? { impersonate: imp } : {});
  } catch (e) {
    try { return await fetchv2(url, { method: opts.method || 'GET', headers, body: opts.body || null, impersonate: imp }); }
    catch (e2) {
      try { return await fetch(url, { method: opts.method || 'GET', headers, body: opts.body || null, impersonate: imp }); }
      catch (_) { return null; }
    }
  }
}
async function fetchJson(url, options = {}) { return parseResponseJson(await soraFetch(url, options)); }

/* ------------------------------------------------------------- byte helpers */
function base64ToUint8(str) {
  let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const mod = b64.length % 4; if (mod) b64 += '===='.slice(mod);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out = [];
  for (let i = 0; i < b64.length; i += 4) {
    if (b64[i] === '=') break;
    const c0 = chars.indexOf(b64[i]), c1 = chars.indexOf(b64[i + 1]);
    const c2 = b64[i + 2] === '=' ? 0 : chars.indexOf(b64[i + 2]);
    const c3 = b64[i + 3] === '=' ? 0 : chars.indexOf(b64[i + 3]);
    out.push((c0 << 2) | (c1 >> 4));
    if (b64[i + 2] !== '=') out.push(((c1 & 15) << 4) | (c2 >> 2));
    if (b64[i + 3] !== '=') out.push(((c2 & 3) << 6) | c3);
  }
  return new Uint8Array(out);
}
function strBytes(s) { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff; return o; }
function bytesToStr(b) { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; }
function toHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; }
function uint8ToBase64(bytes) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += c[b0 >> 2] + c[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? c[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? c[b2 & 63] : '=';
  }
  return out;
}

/* --------------------------------------------- SvelteKit __data.json decoder */
function devalueDecode(flat) {
  const cache = new Array(flat.length);
  function rec(idx) {
    if (idx === -1 || idx === null || idx === undefined) return undefined;
    if (typeof idx !== 'number') return idx;
    if (idx < 0 || idx >= flat.length) return undefined;
    if (idx in cache) return cache[idx];
    const v = flat[idx];
    if (v === null) { cache[idx] = null; return null; }
    if (Array.isArray(v)) { const a = []; cache[idx] = a; for (const e of v) a.push(rec(e)); return a; }
    if (typeof v === 'object') { const o = {}; cache[idx] = o; for (const k in v) o[k] = rec(v[k]); return o; }
    cache[idx] = v; return v;
  }
  return rec(0);
}
function pageData(json) {
  const nodes = (json && json.nodes) || [];
  for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]; if (n && n.data) return devalueDecode(n.data); }
  return null;
}

/* --------------------------------------------------------- SHA-256 / PBKDF2 */
const _K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function sha256(bytes) {
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const ml = bytes.length * 8, msg = Array.prototype.slice.call(bytes); msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 7; i >= 0; i--) msg.push((ml / Math.pow(2, i * 8)) & 0xff);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < msg.length; o += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) w[i] = (msg[o+i*4]<<24)|(msg[o+i*4+1]<<16)|(msg[o+i*4+2]<<8)|(msg[o+i*4+3]);
    for (let i = 16; i < 64; i++) { const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3); const s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)|0; }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,hh=h7;
    for (let i = 0; i < 64; i++) {
      const S1=rotr(e,6)^rotr(e,11)^rotr(e,25), ch=(e&f)^(~e&g), t1=(hh+S1+ch+_K[i]+w[i])|0;
      const S0=rotr(a,2)^rotr(a,13)^rotr(a,22), maj=(a&b)^(a&c)^(b&c), t2=(S0+maj)|0;
      hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+hh)|0;
  }
  const out = new Uint8Array(32), hs = [h0,h1,h2,h3,h4,h5,h6,h7];
  for (let i = 0; i < 8; i++) { out[i*4]=(hs[i]>>>24)&0xff; out[i*4+1]=(hs[i]>>>16)&0xff; out[i*4+2]=(hs[i]>>>8)&0xff; out[i*4+3]=hs[i]&0xff; }
  return out;
}
function sha256hex(s) { return toHex(sha256(strBytes(s))); }
function hmacSha256(key, msg) {
  if (key.length > 64) key = sha256(key);
  const k = new Uint8Array(64); k.set(key);
  const ip = new Uint8Array(64), op = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ip[i]=k[i]^0x36; op[i]=k[i]^0x5c; }
  const inner = sha256(concat(ip, msg));
  return sha256(concat(op, inner));
}
function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
function pbkdf2(pass, salt, iters, dkLen) {
  const out = []; let block = 1;
  while (out.length < dkLen) {
    const bi = new Uint8Array([(block>>>24)&0xff,(block>>>16)&0xff,(block>>>8)&0xff,block&0xff]);
    let u = hmacSha256(pass, concat(salt, bi)); const t = new Uint8Array(u);
    for (let i = 1; i < iters; i++) { u = hmacSha256(pass, u); for (let j = 0; j < t.length; j++) t[j] ^= u[j]; }
    for (let j = 0; j < t.length; j++) out.push(t[j]); block++;
  }
  return new Uint8Array(out.slice(0, dkLen));
}

/* ----------------------------------------------------------- AES-256-CBC dec */
const _sbox = new Uint8Array(256), _isbox = new Uint8Array(256);
(function () { let p=1,q=1; do { p=p^(p<<1)^(p&0x80?0x11b:0); q^=q<<1;q^=q<<2;q^=q<<4;q^=(q&0x80?0x09:0);q&=0xff; const x=q^(q<<1|q>>>7)^(q<<2|q>>>6)^(q<<3|q>>>5)^(q<<4|q>>>4)^0x63; _sbox[p]=x&0xff; } while(p!==1); _sbox[0]=0x63; for(let i=0;i<256;i++)_isbox[_sbox[i]]=i; })();
const _rcon = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
function _keyExp(key) { const w=new Uint32Array(60); for(let i=0;i<8;i++)w[i]=(key[4*i]<<24)|(key[4*i+1]<<16)|(key[4*i+2]<<8)|key[4*i+3]; for(let i=8;i<60;i++){let t=w[i-1];if(i%8===0){t=((t<<8)|(t>>>24))>>>0;t=(_sbox[(t>>>24)&0xff]<<24)|(_sbox[(t>>>16)&0xff]<<16)|(_sbox[(t>>>8)&0xff]<<8)|_sbox[t&0xff];t^=(_rcon[i/8]<<24);}else if(i%8===4){t=(_sbox[(t>>>24)&0xff]<<24)|(_sbox[(t>>>16)&0xff]<<16)|(_sbox[(t>>>8)&0xff]<<8)|_sbox[t&0xff];}w[i]=(w[i-8]^t)>>>0;} return w; }
function _gmul(a,b){let p=0;for(let c=0;c<8;c++){if(b&1)p^=a;const hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p;}
function _invCipher(st,w){for(let c=0;c<4;c++){const k=w[56+c];st[c*4]^=(k>>>24)&0xff;st[c*4+1]^=(k>>>16)&0xff;st[c*4+2]^=(k>>>8)&0xff;st[c*4+3]^=k&0xff;}for(let r=13;r>0;r--){let t=st[13];st[13]=st[9];st[9]=st[5];st[5]=st[1];st[1]=t;t=st[2];st[2]=st[10];st[10]=t;t=st[6];st[6]=st[14];st[14]=t;t=st[3];st[3]=st[7];st[7]=st[11];st[11]=st[15];st[15]=t;for(let i=0;i<16;i++)st[i]=_isbox[st[i]];for(let c=0;c<4;c++){const k=w[r*4+c];st[c*4]^=(k>>>24)&0xff;st[c*4+1]^=(k>>>16)&0xff;st[c*4+2]^=(k>>>8)&0xff;st[c*4+3]^=k&0xff;}for(let c=0;c<4;c++){const i=c*4,s0=st[i],s1=st[i+1],s2=st[i+2],s3=st[i+3];st[i]=_gmul(s0,14)^_gmul(s1,11)^_gmul(s2,13)^_gmul(s3,9);st[i+1]=_gmul(s0,9)^_gmul(s1,14)^_gmul(s2,11)^_gmul(s3,13);st[i+2]=_gmul(s0,13)^_gmul(s1,9)^_gmul(s2,14)^_gmul(s3,11);st[i+3]=_gmul(s0,11)^_gmul(s1,13)^_gmul(s2,9)^_gmul(s3,14);}}let t=st[13];st[13]=st[9];st[9]=st[5];st[5]=st[1];st[1]=t;t=st[2];st[2]=st[10];st[10]=t;t=st[6];st[6]=st[14];st[14]=t;t=st[3];st[3]=st[7];st[7]=st[11];st[11]=st[15];st[15]=t;for(let i=0;i<16;i++)st[i]=_isbox[st[i]];for(let c=0;c<4;c++){const k=w[c];st[c*4]^=(k>>>24)&0xff;st[c*4+1]^=(k>>>16)&0xff;st[c*4+2]^=(k>>>8)&0xff;st[c*4+3]^=k&0xff;}}
function aesCbcDecrypt(ct, key, iv) { const w=_keyExp(key); const pt=new Uint8Array(ct.length); const blk=new Uint8Array(16); let prev=iv; for(let i=0;i<ct.length;i+=16){for(let j=0;j<16;j++)blk[j]=ct[i+j];_invCipher(blk,w);for(let j=0;j<16;j++)pt[i+j]=blk[j]^prev[j];prev=ct.subarray(i,i+16);} const pad=pt[pt.length-1]; if(pad>0&&pad<=16)return pt.subarray(0,pt.length-pad); return pt; }

/* ------------------------------------------------- flixcloud embed resolution */
// Decoy field names are sha256-chains of obfuscation_seed.
function fieldMap(seed) {
  let e = seed; for (let s = 0; s < 3; s++) e = sha256hex(e + s);
  let a = e; for (let s = 0; s < 3; s++) a = sha256hex(a + s);
  return {
    kf: 'kf_' + e.substring(8, 16),
    ivf: 'ivf_' + e.substring(16, 24),
    token: e.substring(48, 64) + '_' + e.substring(56, 64),
    keyFrag2: a.substring(0, 16) + '_' + a.substring(16, 24)
  };
}
function grab(html, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp('(?:"' + esc + '"|' + esc + ')\\s*:\\s*"([^"]*)"'));
  return m ? m[1] : null;
}
function parseSubs(html) {
  const out = [], re = /url:"([^"]+)"\s*,\s*language:"([^"]+)"\s*,\s*format:"([^"]+)"/g; let m;
  while ((m = re.exec(html))) out.push({ url: m[1].replace(/\\\//g, '/'), label: m[2] });
  return out;
}
function runWasmR(inst, inB, k1, k2, seedInt) {
  const ex = inst.exports;
  if (ex.memory.buffer.byteLength < 2048) ex.memory.grow(1);
  const mem = new Uint8Array(ex.memory.buffer);
  const L = inB.length, x = 1000, _ = x + L, y = _ + L, z = y + L;
  mem.set(inB, x); mem.set(k1, _); mem.set(k2, y);
  ex._s(seedInt); ex._r(x, _, y, z, L);
  return mem.slice(z, z + L);
}
async function resolveEmbed(dataLink) {
  // flixcloud.cc is Cloudflare-gated per-subdomain; use the real WebView engine so the
  // app's CFBypass cf_clearance applies (header-only impersonate rides on warm clearance
  // and returns an empty 403 body when it has expired -> "empty embed").
  const res = await soraFetch(dataLink, { headers: { Referer: BASE_URL + '/' }, impersonate: 'webview' });
  const html = res && typeof res.text === 'function' ? await res.text() : '';
  if (!html) throw new Error('empty embed');
  const seed = grab(html, 'obfuscation_seed'), wpay = grab(html, 'w_payload');
  if (!seed || !wpay) throw new Error('no crypto data');
  const map = fieldMap(seed);
  const frag1 = grab(html, map.kf), iv_b64 = grab(html, map.ivf), frag2 = grab(html, map.keyFrag2), T = grab(html, map.token);
  if (!frag1 || !iv_b64 || !frag2 || !T) throw new Error('missing obfuscated fields');
  const subs = parseSubs(html);

  const api = await fetchJson('https://flixcloud.cc/api/m3u8/' + T, { headers: { Referer: dataLink }, impersonate: 'webview' });
  if (!api) throw new Error('api/m3u8 fetch failed');
  const vidField = sha256hex(T + 'vid').substring(0, 10), keyField = sha256hex(T + 'key').substring(0, 10);
  const ct_b64 = api[vidField], frag3 = api[keyField];
  if (!ct_b64 || !frag3) throw new Error('incomplete token response');

  const inst = (await WebAssembly.instantiate(base64ToUint8(wpay), {})).instance;
  const H = runWasmR(inst, base64ToUint8(frag1), base64ToUint8(frag2), base64ToUint8(frag3), parseInt(seed.substring(0, 8), 16));
  const N = pbkdf2(H, strBytes(seed), 1000, 32);
  const J = new Uint8Array(N); for (let i = 0; i < 32; i++) J[i] ^= seed.charCodeAt(i % seed.length);
  const aesKey = sha256(J);
  const pt = aesCbcDecrypt(base64ToUint8(ct_b64), aesKey, base64ToUint8(iv_b64));
  const url = bytesToStr(pt).trim();
  if (!/^https?:\/\//.test(url)) throw new Error('decrypt produced non-URL');
  // playlistKey (__pk): base64 of the WASM _c() output — the site's playlist-scramble key.
  // Shirox's proxy XOR-unscrambles every non-#EXTM3U playlist (master/audio/video) with it.
  const ex = inst.exports;
  if (ex.memory.buffer.byteLength < 4096) ex.memory.grow(1);
  const pkPtr = ex._c();
  const pk = uint8ToBase64(new Uint8Array(ex.memory.buffer).slice(pkPtr, pkPtr + 32));
  return { url, subs, pk };
}

/* -------------------------------------------------------------- module API */
async function searchResults(keyword) {
  try {
    const d = await fetchJson(BASE_URL + '/search/__data.json?q=' + encodeURIComponent(keyword));
    const pd = pageData(d);
    const results = (pd && (pd.initial && pd.initial.results || pd.results)) || [];
    return JSON.stringify(results.map(it => {
      const t = it.title || {}, c = it.cover_image || {};
      return {
        title: t.english || t.romaji || t.native || it.anime_id || 'Unknown',
        image: c.large || c.extra_large || c.medium || '',
        href: BASE_URL + '/watch/' + it.anime_id
      };
    }));
  } catch (e) { log('search error: ' + e.message); return JSON.stringify([]); }
}

async function extractDetails(url) {
  try {
    const mm = url.match(/\/(?:watch|anime)\/([^/?#]+)/);
    if (!mm) return JSON.stringify([{ description: '', aliases: '', airdate: '' }]);
    const d = await fetchJson(BASE_URL + '/anime/' + mm[1] + '/__data.json');
    const a = (pageData(d) || {}).anime || {};
    const description = String(a.description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const aliases = Array.isArray(a.synonyms) ? a.synonyms.slice(0, 6).join(', ') : '';
    let airdate = ''; const sd = a.start_date;
    if (sd && sd.year) { airdate = String(sd.year); if (sd.month) airdate += '-' + String(sd.month).padStart(2, '0'); if (sd.day) airdate += '-' + String(sd.day).padStart(2, '0'); }
    return JSON.stringify([{ description, aliases, airdate }]);
  } catch (e) { return JSON.stringify([{ description: '', aliases: '', airdate: '' }]); }
}

async function extractEpisodes(url) {
  try {
    const slug = (url.match(/\/watch\/([^/?#]+)/) || [])[1];
    if (!slug) return JSON.stringify([]);
    const d = await fetchJson(BASE_URL + '/watch/' + slug + '/__data.json?ep=1');
    const pd = pageData(d);
    const eps = (pd && pd.episodes) || [];
    const out = [];
    for (const ep of eps) {
      const n = (typeof ep.number === 'number' ? ep.number : ep.episode_number) || out.length + 1;
      out.push({ number: n, href: BASE_URL + '/watch/' + slug + '?ep=' + n });
    }
    return JSON.stringify(out);
  } catch (e) { log('episodes error: ' + e.message); return JSON.stringify([]); }
}

async function extractStreamUrl(url) {
  try {
    const slug = (url.match(/\/watch\/([^/?#]+)/) || [])[1];
    const ep = parseInt((url.match(/[?&]ep=(\d+)/) || [])[1] || '1', 10);
    if (!slug) return JSON.stringify({ streams: [] });

    const wd = await fetchJson(BASE_URL + '/watch/' + slug + '/__data.json?ep=' + ep);
    const pd = pageData(wd);
    const anilist = pd && pd.anime && pd.anime.anilist_id;
    if (!anilist) { log('no anilist_id for ' + slug); return JSON.stringify({ streams: [] }); }

    const flix = await fetchJson(BASE_URL + '/api/flix/' + anilist + '/' + ep);
    const servers = (flix && flix.servers) || [];
    if (!servers.length) { log('no servers'); return JSON.stringify({ streams: [] }); }

    // Each embed carries both audio tracks (jpn=sub default, eng=dub) in one master,
    // so HD-1 sub/dub share an identical dataLink. Dedupe by embed → one entry per
    // server (HD-1, HD-2); the dub is selectable as the English audio track in-player.
    const seenLink = new Set(), streams = [], allSubs = [], seenSub = new Set();
    for (const sv of servers) {
      const link = sv.dataLink; if (!link || seenLink.has(link)) continue;
      seenLink.add(link);
      let r = null;
      try { r = await resolveEmbed(link); }
      catch (e) { log('embed ' + sv.serverName + ' failed: ' + e.message); }
      if (r && r.url) {
        streams.push({
          title: sv.serverName,
          streamUrl: r.url,
          headers: { Referer: 'https://flixcloud.cc/', Origin: 'https://flixcloud.cc', 'User-Agent': UA },
          playlistKey: r.pk
        });
        for (const s of (r.subs || [])) { if (!seenSub.has(s.url)) { seenSub.add(s.url); allSubs.push(s); } }
      }
    }
    log('streams=' + streams.length + ' subs=' + allSubs.length);
    const out = { streams };
    if (allSubs.length) out.allSubtitles = allSubs;
    return JSON.stringify(out);
  } catch (e) { log('extractStreamUrl error: ' + e.message); return JSON.stringify({ streams: [] }); }
}
