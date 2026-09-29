const BASE_URL = 'https://ani.pm';

async function parseResponseJson(res) {
    if (!res) return null;
    try {
        if (typeof res.text === 'function') {
            const txt = await res.text();
            if (txt && typeof txt === 'string') {
                return JSON.parse(txt);
            }
        }
    } catch (_) {}
    try {
        if (typeof res.json === 'function') {
            return await res.json();
        }
    } catch (_) {}
    return null;
}

async function soraFetch(url, options = {}) {
    const opts = options || {};
    const headers = opts.headers || {};
    if (!headers["User-Agent"]) {
        headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0";
    }
    if (!headers["Accept-Encoding"]) {
        headers["Accept-Encoding"] = "gzip, deflate";
    }
    const imp = opts.impersonate !== undefined ? opts.impersonate : false;
    try {
        return await fetchv2(url, headers, opts.method || 'GET', opts.body || null, imp ? { impersonate: imp } : {});
    } catch (e) {
        try {
            return await fetchv2(url, {
                method: opts.method || 'GET',
                headers: headers,
                body: opts.body || null,
                impersonate: imp
            });
        } catch (e2) {
            try {
                return await fetch(url, {
                    method: opts.method || 'GET',
                    headers: headers,
                    body: opts.body || null,
                    impersonate: imp
                });
            } catch (error) {
                return null;
            }
        }
    }
}

const sbox = new Uint8Array(256);
const isbox = new Uint8Array(256);
(function initSbox() {
    let p = 1, q = 1;
    do {
        p = p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0);
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q ^= (q & 0x80 ? 0x09 : 0);
        q &= 0xff;
        const xformed = q ^ (q << 1 | q >>> 7) ^ (q << 2 | q >>> 6) ^ (q << 3 | q >>> 5) ^ (q << 4 | q >>> 4) ^ 0x63;
        sbox[p] = xformed & 0xff;
    } while (p !== 1);
    sbox[0] = 0x63;
    for (let i = 0; i < 256; i++) isbox[sbox[i]] = i;
})();

const rcon = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function keyExpansion(key) {
    const w = new Uint32Array(60);
    for (let i = 0; i < 8; i++) {
        w[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
    }
    for (let i = 8; i < 60; i++) {
        let temp = w[i - 1];
        if (i % 8 === 0) {
            temp = ((temp << 8) | (temp >>> 24)) >>> 0;
            temp = (sbox[(temp >>> 24) & 0xff] << 24) |
                (sbox[(temp >>> 16) & 0xff] << 16) |
                (sbox[(temp >>> 8) & 0xff] << 8) |
                sbox[temp & 0xff];
            temp ^= (rcon[i / 8] << 24);
        } else if (i % 8 === 4) {
            temp = (sbox[(temp >>> 24) & 0xff] << 24) |
                (sbox[(temp >>> 16) & 0xff] << 16) |
                (sbox[(temp >>> 8) & 0xff] << 8) |
                sbox[temp & 0xff];
        }
        w[i] = (w[i - 8] ^ temp) >>> 0;
    }
    return w;
}

function gmul(a, b) {
    let p = 0;
    for (let c = 0; c < 8; c++) {
        if (b & 1) p ^= a;
        const hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return p;
}

function invCipher(state, w) {
    for (let c = 0; c < 4; c++) {
        const k = w[14 * 4 + c];
        state[c * 4] ^= (k >>> 24) & 0xff;
        state[c * 4 + 1] ^= (k >>> 16) & 0xff;
        state[c * 4 + 2] ^= (k >>> 8) & 0xff;
        state[c * 4 + 3] ^= k & 0xff;
    }

    for (let round = 13; round > 0; round--) {
        const t1 = state[13]; state[13] = state[9]; state[9] = state[5]; state[5] = state[1]; state[1] = t1;
        const t2 = state[2]; state[2] = state[10]; state[10] = t2;
        const t6 = state[6]; state[6] = state[14]; state[14] = t6;
        const t3 = state[3]; state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t3;

        for (let i = 0; i < 16; i++) state[i] = isbox[state[i]];

        for (let c = 0; c < 4; c++) {
            const k = w[round * 4 + c];
            state[c * 4] ^= (k >>> 24) & 0xff;
            state[c * 4 + 1] ^= (k >>> 16) & 0xff;
            state[c * 4 + 2] ^= (k >>> 8) & 0xff;
            state[c * 4 + 3] ^= k & 0xff;
        }

        for (let c = 0; c < 4; c++) {
            const idx = c * 4;
            const s0 = state[idx], s1 = state[idx + 1], s2 = state[idx + 2], s3 = state[idx + 3];
            state[idx] = gmul(s0, 0x0e) ^ gmul(s1, 0x0b) ^ gmul(s2, 0x0d) ^ gmul(s3, 0x09);
            state[idx + 1] = gmul(s0, 0x09) ^ gmul(s1, 0x0e) ^ gmul(s2, 0x0b) ^ gmul(s3, 0x0d);
            state[idx + 2] = gmul(s0, 0x0d) ^ gmul(s1, 0x09) ^ gmul(s2, 0x0e) ^ gmul(s3, 0x0b);
            state[idx + 3] = gmul(s0, 0x0b) ^ gmul(s1, 0x0d) ^ gmul(s2, 0x09) ^ gmul(s3, 0x0e);
        }
    }

    const t1 = state[13]; state[13] = state[9]; state[9] = state[5]; state[5] = state[1]; state[1] = t1;
    const t2 = state[2]; state[2] = state[10]; state[10] = t2;
    const t6 = state[6]; state[6] = state[14]; state[14] = t6;
    const t3 = state[3]; state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t3;

    for (let i = 0; i < 16; i++) state[i] = isbox[state[i]];

    for (let c = 0; c < 4; c++) {
        const k = w[c];
        state[c * 4] ^= (k >>> 24) & 0xff;
        state[c * 4 + 1] ^= (k >>> 16) & 0xff;
        state[c * 4 + 2] ^= (k >>> 8) & 0xff;
        state[c * 4 + 3] ^= k & 0xff;
    }
}

function decryptAes256Cbc(ciphertext, key, iv) {
    const w = keyExpansion(key);
    const plaintext = new Uint8Array(ciphertext.length);
    const block = new Uint8Array(16);
    let prev = iv;

    for (let i = 0; i < ciphertext.length; i += 16) {
        for (let j = 0; j < 16; j++) block[j] = ciphertext[i + j];
        invCipher(block, w);
        for (let j = 0; j < 16; j++) {
            plaintext[i + j] = block[j] ^ prev[j];
        }
        prev = ciphertext.subarray(i, i + 16);
    }

    const pad = plaintext[plaintext.length - 1];
    if (pad > 0 && pad <= 16) {
        return plaintext.subarray(0, plaintext.length - pad);
    }
    return plaintext;
}

function base64ToUint8(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const mod = b64.length % 4;
    if (mod) b64 += '===='.slice(mod);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const out = [];
    for (let i = 0; i < b64.length; i += 4) {
        if (b64[i] === '=') break;
        const c0 = chars.indexOf(b64[i]);
        const c1 = chars.indexOf(b64[i + 1]);
        const c2 = b64[i + 2] === '=' ? 0 : chars.indexOf(b64[i + 2]);
        const c3 = b64[i + 3] === '=' ? 0 : chars.indexOf(b64[i + 3]);
        out.push((c0 << 2) | (c1 >> 4));
        if (b64[i + 2] !== '=') out.push(((c1 & 15) << 4) | (c2 >> 2));
        if (b64[i + 3] !== '=') out.push(((c2 & 3) << 6) | c3);
    }
    return new Uint8Array(out);
}

function strToUint8(s, len) {
    const arr = new Uint8Array(len);
    for (let i = 0; i < Math.min(s.length, len); i++) {
        arr[i] = s.charCodeAt(i) & 0xff;
    }
    return arr;
}

function decryptMegaplayEnc(encStr) {
    const key = strToUint8('i?LMTAx0Q6,:}50U', 32);
    const iv = strToUint8("W0;27ToaUpl_P%'c", 16);
    const cipherBytes = base64ToUint8(encStr);
    const decrypted = decryptAes256Cbc(cipherBytes, key, iv);
    let resultStr = '';
    for (let i = 0; i < decrypted.length; i++) resultStr += String.fromCharCode(decrypted[i]);
    return resultStr;
}

function extractIdFromUrl(url) {
    if (!url) return null;
    const str = String(url).trim().split(/[?#]/)[0].replace(/\/+$/, '');
    const match = str.match(/(?:^|\/|-)(\d+)$/) || str.match(/(\d+)/);
    return match ? match[1] : null;
}

async function searchResults(keyword) {
    try {
        const url = `${BASE_URL}/api/anime/search?q=${encodeURIComponent(keyword)}`;
        const response = await soraFetch(url, {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate'
            },
            impersonate: false
        });
        if (!response) return JSON.stringify([]);
        const data = await parseResponseJson(response);
        if (!data || !Array.isArray(data.items)) return JSON.stringify([]);

        const results = data.items.map(item => {
            let image = '';
            if (item.poster) {
                image = item.poster.startsWith('http') ? item.poster : `${BASE_URL}${item.poster}`;
            }
            const slug = item.slug ? `${item.slug}-${item.id}` : String(item.id);
            return {
                title: item.title || item.native || 'Unknown',
                image: image,
                href: `${BASE_URL}/anime/${slug}`
            };
        });

        return JSON.stringify(results);
    } catch (e) {
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const id = extractIdFromUrl(url);
        if (!id) return JSON.stringify([{ description: '', aliases: '', airdate: '' }]);

        const apiUrl = `${BASE_URL}/api/anime/series/${id}?routes=e4`;
        const proxyUrl = `https://passthrough-worker.simplepostrequest.workers.dev/?simple=${encodeURIComponent(apiUrl)}&url=${encodeURIComponent(apiUrl)}&referer=${encodeURIComponent(BASE_URL)}/`;

        let response = await soraFetch(proxyUrl, {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate'
            },
            impersonate: false
        });
        let data = await parseResponseJson(response);
        if (!data || !data.title) {
            response = await soraFetch(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate'
                },
                impersonate: false
            });
            data = await parseResponseJson(response);
        }
        if (!data) return JSON.stringify([{ description: '', aliases: '', airdate: '' }]);

        const description = data.synopsis || '';

        const aliasSet = new Set();
        if (data.native && data.native !== data.title) aliasSet.add(data.native);
        if (Array.isArray(data.providerTitles)) {
            data.providerTitles.forEach(t => {
                if (t && t !== data.title) aliasSet.add(t);
            });
        }
        const aliases = Array.from(aliasSet).join(', ');

        let airdate = '';
        if (data.startDate && typeof data.startDate === 'object') {
            const { year, month, day } = data.startDate;
            if (year) {
                airdate = String(year);
                if (month) airdate += `-${String(month).padStart(2, '0')}`;
                if (day) airdate += `-${String(day).padStart(2, '0')}`;
            }
        } else if (data.year) {
            airdate = String(data.year);
        }

        return JSON.stringify([{
            description: description,
            aliases: aliases,
            airdate: airdate
        }]);
    } catch (e) {
        return JSON.stringify([{ description: '', aliases: '', airdate: '' }]);
    }
}

async function extractEpisodes(url) {
    try {
        const id = extractIdFromUrl(url);
        if (!id) return JSON.stringify([]);

        const apiUrl = `${BASE_URL}/api/anime/series/${id}?routes=e4`;
        const proxyUrl = `https://passthrough-worker.simplepostrequest.workers.dev/?simple=${encodeURIComponent(apiUrl)}&url=${encodeURIComponent(apiUrl)}&referer=${encodeURIComponent(BASE_URL)}/`;

        let response = await soraFetch(proxyUrl, {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate'
            },
            impersonate: false
        });
        let data = await parseResponseJson(response);

        if (!data || (!Array.isArray(data.episodes) && !data.episodeCount)) {
            response = await soraFetch(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate'
                },
                impersonate: false
            });
            data = await parseResponseJson(response);
        }
        if (!data) return JSON.stringify([]);

        const episodes = [];
        if (Array.isArray(data.episodes) && data.episodes.length > 0) {
            for (let i = 0; i < data.episodes.length; i++) {
                const ep = data.episodes[i];
                let epNum = i + 1;
                if (ep) {
                    if (typeof ep.number === 'number' && !isNaN(ep.number)) {
                        epNum = ep.number;
                    } else if (typeof ep.sourceNumber === 'number' && !isNaN(ep.sourceNumber)) {
                        epNum = ep.sourceNumber;
                    } else if (ep.number) {
                        const parsed = parseFloat(ep.number);
                        if (!isNaN(parsed)) epNum = parsed;
                    }
                }
                episodes.push({
                    number: epNum,
                    href: `${BASE_URL}/watch/settlar/${id}?ep=${epNum}`
                });
            }
        } else if (data.episodeCount) {
            const count = parseInt(data.episodeCount, 10) || 0;
            for (let i = 1; i <= count; i++) {
                episodes.push({
                    number: i,
                    href: `${BASE_URL}/watch/settlar/${id}?ep=${i}`
                });
            }
        }

        return JSON.stringify(episodes);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// Shirox's VTT parser ignores WebVTT's X-TIMESTAMP-MAP header, so cues that the
// source times against the HLS MPEG-TS clock render offset (appear delayed).
// This fetches the cue file, bakes the map offset into every timestamp, strips
// the map line, and returns a data: URI Shirox parses correctly.
// If subs end up shifted the WRONG way after testing, flip VTT_OFFSET_SIGN to 1.
const VTT_OFFSET_SIGN = -1;

function vttSecToStamp(sec) {
    if (sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    const pad = (n, l) => String(n).padStart(l, '0');
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function vttStampToSec(str) {
    const t = str.trim().replace(',', '.');
    const parts = t.split(':');
    if (parts.length === 3) {
        return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        return (parseFloat(parts[0]) * 60) + parseFloat(parts[1]);
    }
    return NaN;
}

async function normalizeVttTiming(subUrl, headers) {
    try {
        const res = await soraFetch(subUrl, { headers: headers || {} });
        if (!res || typeof res.text !== 'function') return subUrl;
        let content = await res.text();
        if (!content) return subUrl;

        const stripped = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
        if (!/^WEBVTT/.test(stripped)) return subUrl; // not VTT (e.g. ASS/SRT) — leave as-is

        const mapMatch = content.match(/X-TIMESTAMP-MAP=.*MPEGTS:(\d+).*?(?:LOCAL:(\d{2}:\d{2}:\d{2}[.,]\d{3}))?/i);
        if (!mapMatch) return subUrl; // no map, nothing to correct

        const mpegts = parseInt(mapMatch[1], 10);
        const localSec = mapMatch[2] ? vttStampToSec(mapMatch[2]) : 0;
        const offset = (mpegts / 90000) - localSec;
        if (!offset || Math.abs(offset) < 0.001) return subUrl;

        const shift = VTT_OFFSET_SIGN * offset;
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const out = [];
        for (const line of lines) {
            if (/^X-TIMESTAMP-MAP=/i.test(line.trim())) continue; // drop the map line
            if (line.includes('-->')) {
                const shifted = line.replace(/(\d{2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})/g, (m) => {
                    const sec = vttStampToSec(m);
                    return isNaN(sec) ? m : vttSecToStamp(sec + shift);
                });
                out.push(shifted);
            } else {
                out.push(line);
            }
        }
        return 'data:text/vtt,' + encodeURIComponent(out.join('\n'));
    } catch (e) {
        return subUrl; // any failure → fall back to the original URL
    }
}

async function extractStreamUrl(url) {
    try {
        const id = extractIdFromUrl(url);
        let ep = 1;
        const epMatch = url.match(/[?&]ep=(\d+)/i);
        if (epMatch) ep = parseInt(epMatch[1], 10);

        let source = 'settlar';
        const sourceMatch = url.match(/\/watch\/([a-z0-9_-]+)\//i);
        if (sourceMatch) source = sourceMatch[1];

        if (!id) return JSON.stringify({ streams: [] });

        const streams = [];
        const allSubs = [];
        const seenSubs = new Set();
        function addSub(url, label) {
            if (!url || typeof url !== 'string') return;
            if (seenSubs.has(url)) return;
            seenSubs.add(url);
            allSubs.push({ url: url, label: label || 'Subtitle' });
        }

        const FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0";

        for (const lang of ['dub']) {
            try {
                const bootUrl = `${BASE_URL}/api/anime/playback-bootstrap/${source}/${id}?ep=${ep}&lang=${lang}`;
                const bootRes = await soraFetch(bootUrl, {
                    headers: { 'User-Agent': FIREFOX_UA }
                });
                if (!bootRes) continue;
                const bootData = await parseResponseJson(bootRes);
                const selection = bootData && bootData.settlarSelection;
                if (!selection) continue;

                const sessUrl = `${BASE_URL}/api/anime/settlar/session?selection=${encodeURIComponent(selection)}&provider=anipm&ep=${ep}&channel=${lang}&telemetry=0`;
                const sessRes = await soraFetch(sessUrl, {
                    headers: { 'User-Agent': FIREFOX_UA }
                });
                if (!sessRes) continue;
                const sessData = await parseResponseJson(sessRes);
                const embedUrl = sessData && sessData.embedUrl;
                if (!embedUrl) continue;

                const tokenMatch = embedUrl.match(/[?&]t=([^&#]+)/);
                if (!tokenMatch) continue;
                const token = decodeURIComponent(tokenMatch[1]);

                const apiSessionUrl = `https://embed.settlar.io/api/embed/session?t=${encodeURIComponent(token)}`;
                const apiRes = await soraFetch(apiSessionUrl, {
                    method: 'GET',
                    impersonate: 'firefox',
                    headers: {
                        'Host': 'embed.settlar.io',
                        'User-Agent': FIREFOX_UA,
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': 'https://embed.settlar.io/',
                        'Origin': 'https://embed.settlar.io',
                        'Sec-Fetch-Dest': 'empty',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'same-origin'
                    }
                });

                if (apiRes) {
                    const apiData = await parseResponseJson(apiRes);
                    if (apiData && apiData.source) {
                        streams.push({
                            title: 'Settlar • Main',
                            streamUrl: apiData.source,
                            headers: {
                                'Referer': 'https://embed.settlar.io/',
                                'Origin': 'https://embed.settlar.io',
                                'User-Agent': FIREFOX_UA
                            }
                        });

                        if (Array.isArray(apiData.subtitles)) {
                            for (const s of apiData.subtitles) {
                                if (s && s.url) {
                                    addSub(s.url, s.label || s.srclang || s.language);
                                }
                            }
                        }
                    }
                }
            } catch (settlarErr) {
            }
        }

        for (const lang of ['dub']) {
            try {
                const bootUrl = `${BASE_URL}/api/anime/playback-bootstrap/${source}/${id}?ep=${ep}&lang=${lang}&backup=1`;
                const bootRes = await soraFetch(bootUrl, {
                    headers: { 'User-Agent': FIREFOX_UA }
                });
                if (!bootRes) continue;
                const bootData = await parseResponseJson(bootRes);
                if (!bootData || !bootData.backupEmbed || !bootData.backupEmbed.available || !bootData.backupEmbed.url) continue;

                const embedUrl = bootData.backupEmbed.url;
                const embedRes = await soraFetch(embedUrl, {
                    headers: {
                        'Referer': `${BASE_URL}/`,
                        'User-Agent': FIREFOX_UA
                    }
                });
                if (!embedRes) continue;
                const html = await embedRes.text();

                const idMatch = html.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
                if (!idMatch) continue;
                const dataId = idMatch[1];

                const sourcesUrl = `https://megaplay.buzz/stream/getSources?id=${dataId}`;
                const sourcesRes = await soraFetch(sourcesUrl, {
                    headers: {
                        'Referer': embedUrl,
                        'X-Requested-With': 'XMLHttpRequest',
                        'User-Agent': FIREFOX_UA
                    }
                });
                if (!sourcesRes) continue;
                const sourcesData = await parseResponseJson(sourcesRes);
                if (!sourcesData) continue;

                let streamUrl = null;
                if (sourcesData.sources && Array.isArray(sourcesData.sources) && sourcesData.sources[0] && sourcesData.sources[0].file) {
                    streamUrl = sourcesData.sources[0].file;
                } else if (sourcesData.sources && typeof sourcesData.sources.file === 'string') {
                    streamUrl = sourcesData.sources.file;
                } else if (sourcesData.enc) {
                    const decStr = decryptMegaplayEnc(sourcesData.enc);
                    const parsed = JSON.parse(decStr);
                    streamUrl = parsed.file;
                }

                if (streamUrl) {
                    streams.push({
                        title: 'Megaplay • Backup',
                        streamUrl: streamUrl,
                        headers: {
                            'Referer': 'https://megaplay.buzz/',
                            'User-Agent': FIREFOX_UA
                        }
                    });
                }

                if (sourcesData.tracks && Array.isArray(sourcesData.tracks)) {
                    for (const t of sourcesData.tracks) {
                        if (!t || !t.file) continue;
                        const kind = (t.kind || '').toLowerCase();
                        const label = (t.label || '').toLowerCase();
                        if (kind === 'thumbnails' || label === 'thumbnails') continue;
                        if (kind && kind !== 'captions' && kind !== 'subtitles') continue;
                        addSub(t.file, t.label || t.kind);
                    }
                }
            } catch (err) {
            }
        }

        if (allSubs.length) {
            await Promise.all(allSubs.map(async (t) => {
                t.url = await normalizeVttTiming(t.url, { 'User-Agent': FIREFOX_UA });
            }));
        }

        const result = { streams: streams };
        if (allSubs.length) result.allSubtitles = allSubs;

        return JSON.stringify(result);
    } catch (e) {
        return JSON.stringify({ streams: [] });
    }
}
