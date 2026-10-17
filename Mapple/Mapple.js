// Mapple (mapple.fun) -> Shirox source module
// Ported from the Nuvio module (code name "Maelith") in the same style as the PenguPlay port.
//
// Mapple is TMDB-id based: its API takes `mediaId: <tmdbId>`, `mediaType:
// movie|tv`, and a `tv_slug: "<season>-<episode>"`, and its referers are
// /tv/<tmdbId>/<s>/<e>. So unlike PenguPlay (IMDb/Cinemeta), the metadata
// bridge here runs on the TMDB API, which hands Mapple the exact ids it eats.
//
// Flow:
//   searchResults   -> TMDB /search/multi (movie + tv)
//   extractDetails  -> TMDB /movie|/tv details
//   extractEpisodes -> TMDB /tv seasons+episodes (movie = single entry)
//   extractStreamUrl-> Mapple session (PoW + tokens) -> /api/encrypt -> HLS,
//                      + OpenSubtitles (keyless Stremio addon, via TMDB->imdb)
//
// JavaScriptCore constraints honored: no setTimeout, no new URL(), no
// crypto.subtle (pure-JS SHA-256), no TextEncoder (pure-JS UTF-8). All four
// outputs are JSON.stringify'd (Shirox video-module requirement).

// ---- CONFIG ---------------------------------------------------------------
const BASE_URL = "https://mapple.fun";
const DSKTP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const MBILE_UA = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

// Full god-source list from the site bundle (the ids are the `source` values
// /api/encrypt takes). Order mirrors the site's default playback priority.
// `multi` marks the multi-audio sources (site shows a "Multi-audio" badge).
const SERVERS = [
    { name: "Poseidon", source: "s25" },
    { name: "Prometheus", source: "s10" },
    { name: "Zeus", source: "mapple" },
    { name: "Athena", source: "s2", multi: true },
    { name: "Astraeus", source: "s28" },
    { name: "Apollo", source: "s19", multi: true },
    { name: "Persephone", source: "s12" },
    { name: "Hera", source: "s4" },
    { name: "Aphrodite", source: "s6" },
    { name: "Demeter", source: "s7" },
    { name: "Dionysus", source: "s8" }
];

// Metadata bridge. Mapple proxies TMDB through its own backend
// (/api/tmdb/... , key held server-side, native TMDB response shape), so we
// route search/details/episodes through Mapple itself — no third-party key to
// revoke, same host the streams come from. Paths mirror TMDB 1:1 minus the /3.
const TMDB = `${BASE_URL}/api/tmdb`;
const TMDB_KEY_URL = `${BASE_URL}/api/tmdb-key`;
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// Mapple's /api/tmdb proxy is gated by an x-api-key the site mints at
// /api/tmdb-key (a "<expiresAt>.<hash>" token issued server-side — not
// computed client-side, so there's no secret to reverse). Fetch it, cache it
// until just before it expires, and send it as x-api-key on every /api/tmdb
// call. Refetched automatically when expired.
// Shared session cookie jar. /api/tmdb-key (and the stream endpoints) are
// gated by the _mapple_site cookie the site sets on first load, so bootstrap
// it with GET / and reuse it everywhere. The cookie count is logged — if it
// stays 0, fetchv2 isn't surfacing Set-Cookie and we move to a webview
// transport that keeps its own jar (same fix the streams would need).
const SESSION_JAR = createCookieJar();
async function ensureSession() {
    if (SESSION_JAR.count() > 0) return SESSION_JAR;
    try {
        const res = await httpGet(`${BASE_URL}/`, { "User-Agent": MBILE_UA, Accept: "text/html" });
        SESSION_JAR.update(res);
        await readText(res);
    } catch (e) {
        console.log("[mapple] session bootstrap error: " + e);
    }
    console.log("[mapple] session cookies=" + SESSION_JAR.count());
    return SESSION_JAR;
}

let _tmdbKey = null;
let _tmdbKeyExp = 0;
async function ensureTmdbKey() {
    const now = Date.now();
    if (_tmdbKey && now < _tmdbKeyExp - 5000) return _tmdbKey;
    const jar = await ensureSession();
    const hdr = { "User-Agent": MBILE_UA, Accept: "application/json", Referer: `${BASE_URL}/`, Origin: BASE_URL, "Content-Type": "application/json" };
    const cookie = jar.serialize();
    if (cookie) hdr.Cookie = cookie;
    try {
        const res = await httpPost(TMDB_KEY_URL, hdr, "");
        jar.update(res);
        const status = res && typeof res.status === "number" ? res.status : "?";
        const data = await readJson(res);
        if (data && data.key) {
            _tmdbKey = data.key;
            const exp = Number(data.expiresAt);
            _tmdbKeyExp = exp > now ? exp : (now + 30000);
            console.log("[mapple] tmdb-key ok (HTTP " + status + ", cookies=" + jar.count() + ")");
            return _tmdbKey;
        }
        console.log("[mapple] tmdb-key POST HTTP " + status + " (cookies=" + jar.count() + ")");
    } catch (e) {
        console.log("[mapple] tmdb-key error: " + e);
    }
    return _tmdbKey;
}

function tmdbHeaders(key) {
    const h = { "User-Agent": MBILE_UA, Accept: "application/json", Referer: `${BASE_URL}/`, Origin: BASE_URL };
    if (key) h["x-api-key"] = key;
    const cookie = SESSION_JAR.serialize();
    if (cookie) h.Cookie = cookie;
    return h;
}

// Drop the cached cookie + key so the next call re-bootstraps a fresh session.
// Mapple expires _mapple_site server-side; while the app is only backgrounded
// (JS context alive) the stale cookie would otherwise be reused forever and
// everything gated by it starts 401ing until a full app kill.
function resetSession() {
    SESSION_JAR.clear();
    _tmdbKey = null;
    _tmdbKeyExp = 0;
}

async function tmdbGet(url) {
    let key = await ensureTmdbKey();
    let res = await httpGet(url, tmdbHeaders(key));
    if (res && res.status === 401) {
        console.log("[mapple] tmdb 401 — refreshing session");
        resetSession();
        key = await ensureTmdbKey();
        res = await httpGet(url, tmdbHeaders(key));
    }
    return readJson(res);
}

// OpenSubtitles via the keyless Stremio addon (xdfkenny's method). Mapple
// serves no sidecar subs of its own, so this is the only subtitle source.
const STREMIO_OPENSUBTITLES_URL = "https://opensubtitles-v3.strem.io";
const SUBS_ENABLED = true;   // set false to ship streams only

// ---- fetch layer ----------------------------------------------------------
// Shirox native transport. Keep the 4-arg form PenguPlay uses.
async function httpGet(url, headers) {
    return fetchv2(url, headers || {}, "GET", null);
}
async function httpPost(url, headers, body) {
    return fetchv2(url, headers || {}, "POST", body == null ? "" : body);
}
// fetchv2 may or may not expose res.ok/res.status. Treat an unknown status as
// OK and let a bad body fall through to the JSON catch, rather than discarding
// a response just because status isn't surfaced.
function statusOk(res) {
    return !res || typeof res.status !== "number" ? true : res.status < 400;
}
// Read the body exactly once (text) then parse — reading .json() first and
// .text() on the fallback double-consumes the stream, which returns "" on some
// fetchv2 builds and masks the real body.
async function readJson(res) {
    let raw = "";
    try { raw = await res.text(); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}
async function readText(res) {
    try { return await res.text(); } catch (e) { return ""; }
}
async function getJSON(url, headers) {
    const res = await httpGet(url, headers);
    return await readJson(res);
}

// ---- pure-JS SHA-256 proof-of-work (carried from Nuvio) --------------------
const SHA256_K = new Int32Array([
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
    3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
    3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
    2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
    666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
    2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
    430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
    1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298
]);

const SHA256_IS = new Int32Array([
    1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225
]);

// Math.clz32 is ES2015 (present on modern JSC) but guard it anyway.
const clz32 = Math.clz32 || function (x) {
    x = x >>> 0;
    if (x === 0) return 32;
    let n = 0;
    if (x <= 0x0000ffff) { n += 16; x <<= 16; }
    if (x <= 0x00ffffff) { n += 8; x <<= 8; }
    if (x <= 0x0fffffff) { n += 4; x <<= 4; }
    if (x <= 0x3fffffff) { n += 2; x <<= 2; }
    if (x <= 0x7fffffff) { n += 1; }
    return n;
};

// TextEncoder is unreliable on JavaScriptCore — encode UTF-8 by hand. The PoW
// challenge is an ASCII string in practice, but handle the full range anyway.
function utf8Bytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c < 0x80) {
            out.push(c);
        } else if (c < 0x800) {
            out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            const c2 = s.charCodeAt(i + 1);
            const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
            out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
            i++;
        } else {
            out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
    }
    return new Uint8Array(out);
}

function sha256Compress(state, schedule, data, offset) {
    let i, pos, a, b, c, d, e, f, g, h, temp1, sum0, sum1, choice, majority, w15, w2;
    for (i = 0; i < 16; i++) {
        pos = offset + i * 4;
        schedule[i] = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
    }
    for (i = 16; i < 64; i++) {
        w15 = schedule[i - 15];
        w2 = schedule[i - 2];
        schedule[i] = (schedule[i - 16] + (((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)) +
            schedule[i - 7] + (((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10))) | 0;
    }
    a = state[0]; b = state[1]; c = state[2]; d = state[3];
    e = state[4]; f = state[5]; g = state[6]; h = state[7];
    for (i = 0; i < 64; i += 8) {
        sum1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)));
        choice = (e & f) ^ (~e & g);
        temp1 = (h + sum1 + choice + SHA256_K[i + 0] + schedule[i + 0]) | 0;
        sum0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)));
        majority = (a & b) ^ (a & c) ^ (b & c);
        d = (d + temp1) | 0;
        h = (temp1 + sum0 + majority) | 0;

        sum1 = (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7)));
        choice = (d & e) ^ (~d & f);
        temp1 = (g + sum1 + choice + SHA256_K[i + 1] + schedule[i + 1]) | 0;
        sum0 = (((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10)));
        majority = (h & a) ^ (h & b) ^ (a & b);
        c = (c + temp1) | 0;
        g = (temp1 + sum0 + majority) | 0;

        sum1 = (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7)));
        choice = (c & d) ^ (~c & e);
        temp1 = (f + sum1 + choice + SHA256_K[i + 2] + schedule[i + 2]) | 0;
        sum0 = (((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10)));
        majority = (g & h) ^ (g & a) ^ (h & a);
        b = (b + temp1) | 0;
        f = (temp1 + sum0 + majority) | 0;

        sum1 = (((b >>> 6) | (b << 26)) ^ ((b >>> 11) | (b << 21)) ^ ((b >>> 25) | (b << 7)));
        choice = (b & c) ^ (~b & d);
        temp1 = (e + sum1 + choice + SHA256_K[i + 3] + schedule[i + 3]) | 0;
        sum0 = (((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10)));
        majority = (f & g) ^ (f & h) ^ (g & h);
        a = (a + temp1) | 0;
        e = (temp1 + sum0 + majority) | 0;

        sum1 = (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7)));
        choice = (a & b) ^ (~a & c);
        temp1 = (d + sum1 + choice + SHA256_K[i + 4] + schedule[i + 4]) | 0;
        sum0 = (((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10)));
        majority = (e & f) ^ (e & g) ^ (f & g);
        h = (h + temp1) | 0;
        d = (temp1 + sum0 + majority) | 0;

        sum1 = (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7)));
        choice = (h & a) ^ (~h & b);
        temp1 = (c + sum1 + choice + SHA256_K[i + 5] + schedule[i + 5]) | 0;
        sum0 = (((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10)));
        majority = (d & e) ^ (d & f) ^ (e & f);
        g = (g + temp1) | 0;
        c = (temp1 + sum0 + majority) | 0;

        sum1 = (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7)));
        choice = (g & h) ^ (~g & a);
        temp1 = (b + sum1 + choice + SHA256_K[i + 6] + schedule[i + 6]) | 0;
        sum0 = (((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10)));
        majority = (c & d) ^ (c & e) ^ (d & e);
        f = (f + temp1) | 0;
        b = (temp1 + sum0 + majority) | 0;

        sum1 = (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7)));
        choice = (f & g) ^ (~f & h);
        temp1 = (a + sum1 + choice + SHA256_K[i + 7] + schedule[i + 7]) | 0;
        sum0 = (((b >>> 2) | (b << 30)) ^ ((b >>> 13) | (b << 19)) ^ ((b >>> 22) | (b << 10)));
        majority = (b & c) ^ (b & d) ^ (c & d);
        e = (e + temp1) | 0;
        a = (temp1 + sum0 + majority) | 0;
    }
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
    state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
    state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
}

function hasLeadingZeroBits(state, requiredBits) {
    let remaining = requiredBits;
    for (let i = 0; i < 8; i++) {
        if (remaining <= 0) return true;
        if (state[i] === 0) {
            remaining -= 32;
            continue;
        }
        return clz32(state[i]) >= remaining;
    }
    return true;
}

function solveProofOfWork(challenge, difficulty) {
    const prefix = utf8Bytes(String(challenge));
    const prefixLength = prefix.length;
    const state = new Int32Array(8);
    const midState = new Int32Array(8);
    const schedule = new Int32Array(64);
    const firstDynamicBlock = Math.floor(prefixLength / 64);

    for (let digits = 1; digits <= 8; digits++) {
        const rangeStart = digits === 1 ? 0 : Math.pow(10, digits - 1);
        const rangeEnd = Math.min(Math.pow(10, digits), 20000000);
        const messageLength = prefixLength + digits;
        const paddedLength = Math.ceil((messageLength + 9) / 64) * 64;
        const buffer = new Uint8Array(paddedLength);
        buffer.set(prefix, 0);
        buffer[messageLength] = 128;
        const bitLength = messageLength * 8;
        buffer[paddedLength - 4] = (bitLength >>> 24) & 255;
        buffer[paddedLength - 3] = (bitLength >>> 16) & 255;
        buffer[paddedLength - 2] = (bitLength >>> 8) & 255;
        buffer[paddedLength - 1] = bitLength & 255;

        midState.set(SHA256_IS);
        for (let block = 0; block < firstDynamicBlock; block++) {
            sha256Compress(midState, schedule, buffer, block * 64);
        }

        for (let nonce = rangeStart; nonce < rangeEnd; nonce++) {
            let remainder = nonce;
            for (let pos = messageLength - 1; pos >= prefixLength; pos--) {
                buffer[pos] = 48 + (remainder % 10);
                remainder = (remainder / 10) | 0;
            }
            state.set(midState);
            for (let offset = firstDynamicBlock * 64; offset < paddedLength; offset += 64) {
                sha256Compress(state, schedule, buffer, offset);
            }
            if (hasLeadingZeroBits(state, difficulty)) return String(nonce);
        }
    }
    return null;
}

// ---- Mapple session + stream resolution (carried from Nuvio) --------------
function buildApiHeaders(referer, isJson, cookie) {
    const headers = { "User-Agent": MBILE_UA, Accept: "*/*", Origin: BASE_URL, Referer: referer };
    if (isJson) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    return headers;
}

function buildPlaybackHeaders() {
    return { Referer: `${BASE_URL}/`, Origin: BASE_URL, "User-Agent": DSKTP_UA };
}

// Mapple's API is session-cookie gated across request-token / playback-init /
// encrypt / stream. This manual jar reads Set-Cookie defensively across the
// shapes fetchv2 might expose it in. NOTE (on-device check): if fetchv2 does
// not surface Set-Cookie at all, cookies=0 will log below and the session will
// fail — in that case fetchv2's own cookie jar (impersonate transport) must
// carry them instead. Watch the "[mapple] session" log line in Shirox Logs.
function createCookieJar() {
    const cookies = {};
    return {
        update(response) {
            let rawCookies = [];
            try {
                const h = response && response.headers;
                if (h && typeof h.getSetCookie === "function") {
                    rawCookies = h.getSetCookie() || [];
                } else if (h && typeof h.get === "function") {
                    const header = h.get("set-cookie");
                    if (header) rawCookies = Array.isArray(header) ? header : [header];
                } else if (h && (h["set-cookie"] || h["Set-Cookie"])) {
                    const header = h["set-cookie"] || h["Set-Cookie"];
                    rawCookies = Array.isArray(header) ? header : [header];
                }
            } catch (e) { }
            rawCookies.forEach(function (cookie) {
                const pair = cookie.split(";")[0].split("=");
                if (pair.length >= 2) cookies[pair[0].trim()] = pair.slice(1).join("=").trim();
            });
        },
        count() { return Object.keys(cookies).length; },
        clear() { Object.keys(cookies).forEach(function (k) { delete cookies[k]; }); },
        serialize() {
            return Object.keys(cookies).map(function (name) {
                return `${name}=${cookies[name]}`;
            }).join("; ");
        }
    };
}

// Retry once with a freshly bootstrapped session: a backgrounded app keeps the
// stale cookie, so the first playback-init can fail on an expired _mapple_site;
// resetting and re-bootstrapping recovers it without a full app kill.
async function createSession(tmdbId, mediaType, tvSlug, referer) {
    let s = await createSessionOnce(tmdbId, mediaType, tvSlug, referer);
    if (!s) {
        console.log("[mapple] session retry with fresh cookies");
        resetSession();
        s = await createSessionOnce(tmdbId, mediaType, tvSlug, referer);
    }
    return s;
}

async function createSessionOnce(tmdbId, mediaType, tvSlug, referer) {
    try {
        const jar = await ensureSession();

        const tokenResponse = await httpPost(`${BASE_URL}/api/request-token`, buildApiHeaders(referer, true, jar.serialize()), "");
        jar.update(tokenResponse);
        if (!statusOk(tokenResponse)) { console.log("[mapple] request-token HTTP " + (tokenResponse && tokenResponse.status)); return null; }
        const tokenData = await readJson(tokenResponse);
        const requestToken = tokenData && tokenData.token;
        if (!requestToken) { console.log("[mapple] no request token (cookies=" + jar.count() + ")"); return null; }

        const payload = {
            mediaId: Number(tmdbId),
            mediaType: mediaType,
            tv_slug: tvSlug,
            requestToken: requestToken
        };

        const initPlayback = async function (body) {
            const response = await httpPost(`${BASE_URL}/api/playback-init`, buildApiHeaders(referer, true, jar.serialize()), JSON.stringify(body));
            jar.update(response);
            return await readJson(response);
        };

        let result = await initPlayback(payload);
        if (result && result.success && result.token) {
            console.log("[mapple] session ready (cookies=" + jar.count() + ", no PoW)");
            return { requestToken: requestToken, playbackToken: result.token, jar: jar, referer: referer };
        }
        if (result && result.requiresPow && result.pow) {
            console.log("[mapple] solving PoW difficulty=" + (result.pow.difficulty || 18));
            const nonce = solveProofOfWork(result.pow.challenge, result.pow.difficulty || 18);
            if (nonce === null) { console.log("[mapple] PoW unsolved"); return null; }
            result = await initPlayback(Object.assign({}, payload, {
                pow: { challengeId: result.pow.challengeId, nonce: nonce }
            }));
            if (result && result.token) {
                console.log("[mapple] session ready (cookies=" + jar.count() + ", PoW solved)");
                return { requestToken: requestToken, playbackToken: result.token, jar: jar, referer: referer };
            }
        }
        console.log("[mapple] playback-init failed (cookies=" + jar.count() + ")");
        return null;
    } catch (e) {
        console.log("[mapple] session error: " + e);
        return null;
    }
}

function resolvePlaylistUrl(entry, playlistUrl) {
    if (/^https?:\/\//i.test(entry)) return entry;
    const cleanUrl = playlistUrl.split("#")[0].split("?")[0];
    if (entry.charAt(0) === "/") {
        const origin = cleanUrl.match(/^(https?:\/\/[^\/]+)/i);
        return `${origin ? origin[1] : ""}${entry}`;
    }
    return `${cleanUrl.slice(0, cleanUrl.lastIndexOf("/") + 1)}${entry}`;
}

function buildStream(url, server, quality, adaptive) {
    const name = server.name;
    return {
        name: name,
        title: name,
        url: url,
        quality: quality,
        multi: !!server.multi,
        adaptive: !!adaptive,
        headers: buildPlaybackHeaders()
    };
}

// A direct (non-master) stream carries no RESOLUTION tag, but its URL usually
// encodes the height (…-s2160p-…, …1080.m3u8, …/720/…). Read it from the path
// so an "Auto" row can honestly show its ceiling. Returns "" when none found.
function resLabelFromUrl(url) {
    const s = String(url || "").split("?")[0];
    let m = s.match(/(\d{3,4})\s*[pP](?![a-z0-9])/);
    if (!m) m = s.match(/(\d{3,4})x(\d{3,4})/);
    if (!m) m = s.match(/\b(2160|1440|1080|720|480|360)\b/);
    if (!m) return "";
    const h = Number(m[2] || m[1]);
    if (h >= 2000) return "2160p";
    if (h >= 1400) return "1440p";
    if (h >= 1000) return "1080p";
    if (h >= 700) return "720p";
    if (h >= 400) return "480p";
    return `${h}p`;
}

function getResolutionLabel(width, height) {
    if (width >= 3200 || height >= 2000) return "2160p";
    if (width >= 1800 || height >= 1000) return "1080p";
    if (width >= 1200 || height >= 700) return "720p";
    return `${height}p`;
}

async function parseMasterPlaylist(playlistUrl, server) {
    try {
        const response = await httpGet(playlistUrl, buildPlaybackHeaders());
        if (!statusOk(response)) return null;
        const content = await readText(response);
        if (content.indexOf("#EXT-X-STREAM-INF") === -1) return null;
        const lines = content.split("\n");
        const streams = [];
        let quality = "Unknown";
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
                const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/);
                quality = resolution ? getResolutionLabel(Number(resolution[1]), Number(resolution[2])) : "Unknown";
            } else if (line && line.charAt(0) !== "#") {
                streams.push(buildStream(resolvePlaylistUrl(line, playlistUrl), server, quality));
                quality = "Unknown";
            }
        }
        return streams;
    } catch (e) {
        return null;
    }
}

async function fetchServerStreams(server, tmdbId, mediaType, tvSlug, session) {
    try {
        const encryptResponse = await httpPost(`${BASE_URL}/api/encrypt`, buildApiHeaders(session.referer, true, session.jar.serialize()), JSON.stringify({
            data: { mediaId: Number(tmdbId), mediaType: mediaType, tv_slug: tvSlug, source: server.source },
            endpoint: "stream-encrypted",
            requestToken: session.requestToken
        }));
        if (!statusOk(encryptResponse)) return [];
        const encrypted = await readJson(encryptResponse);
        if (!encrypted || !encrypted.url) return [];

        const streamEndpoint = `${BASE_URL}${encrypted.url}&requestToken=${encodeURIComponent(session.requestToken)}&token=${encodeURIComponent(session.playbackToken)}`;
        const streamResponse = await httpGet(streamEndpoint, buildApiHeaders(session.referer, false, session.jar.serialize()));
        if (!statusOk(streamResponse)) return [];
        const streamData = await readJson(streamResponse);
        const streamUrl = streamData && streamData.success && streamData.data && streamData.data.stream_url;
        if (!streamUrl || String(streamUrl).indexOf("playback-unavailable") !== -1) return [];

        // One row per source: hand the app the adaptive MASTER so it picks the
        // quality by bandwidth, instead of exploding into a fixed-res row per
        // variant. Mark it [2160p] only when the source actually carries 4K;
        // otherwise it's [Auto].
        const variants = await parseMasterPlaylist(streamUrl, server);
        if (variants && variants.length) {
            const has4k = variants.some(function (v) { return getQualityRank(v.quality) === 10; });
            return [buildStream(streamUrl, server, has4k ? "2160p" : "Auto", true)];
        }
        // Non-master direct stream: 4K only if the URL says so, else Auto.
        return [buildStream(streamUrl, server, resLabelFromUrl(streamUrl) === "2160p" ? "2160p" : "Auto", true)];
    } catch (e) {
        return [];
    }
}

function getQualityRank(quality) {
    const value = String(quality || "").toLowerCase();
    if (value === "auto") return 5;
    if (/2160|4k|uhd/.test(value)) return 10;
    if (/1440|2k/.test(value)) return 8;
    if (/1080|fhd/.test(value)) return 6;
    if (/720|hd/.test(value)) return 4;
    if (/480/.test(value)) return 2;
    return 0;
}

// One row per source (dedup by URL), sorted best-first: the 4K-capable sources
// ([2160p]) stack at the top, then the adaptive [Auto] sources. Shirox re-sorts
// the picker LEXICALLY ASCENDING by title, so carry a zero-padded "NN." prefix
// to reproduce this order on-device.
function selectStreams(streams) {
    const seenUrls = new Set();
    const candidates = streams.filter(function (stream) {
        if (!stream || !stream.url || seenUrls.has(stream.url)) return false;
        seenUrls.add(stream.url);
        return true;
    });
    candidates.sort(function (a, b) {
        return getQualityRank(b.quality) - getQualityRank(a.quality);
    });
    const top = candidates.slice(0, 30);
    const width = Math.max(2, String(top.length).length);
    return top.map(function (stream, i) {
        const n = String(i + 1);
        const pad = n.length >= width ? n : new Array(width - n.length + 1).join("0") + n;
        // Fold the resolution into the row text — Shirox re-sorts the picker
        // lexically and renders the title, not a separate `quality` badge, so
        // the label carries both the numeric sort prefix and the quality.
        const hasRes = stream.quality && stream.quality !== "Unknown" && stream.quality !== "Auto";
        const q = hasRes ? ` [${stream.quality}]` : " [Auto]";
        const m = stream.multi ? " • Multi-audio" : "";
        const label = `${pad}. ${stream.name}${q}${m}`;
        return {
            title: label,
            name: label,
            quality: stream.quality,
            url: stream.url,
            streamUrl: stream.url,
            headers: stream.headers
        };
    });
}

// The site keeps a full source list client-side and calls /api/dead-sources to
// learn which to hide for a given title. Mirror that so we don't waste requests
// probing sources Mapple already knows are dead. Shape unknown, so parse
// defensively and log the raw body once to confirm it; failure => all active.
async function getDeadSources(tmdbId, type, tvSlug) {
    try {
        const url = `${BASE_URL}/api/dead-sources?mediaId=${encodeURIComponent(tmdbId)}&mediaType=${type}&tv_slug=${encodeURIComponent(tvSlug || "")}`;
        const res = await httpGet(url, buildApiHeaders(`${BASE_URL}/`, false, SESSION_JAR.serialize()));
        let raw = "";
        try { raw = await res.text(); } catch (e) { }
        console.log("[mapple] dead-sources: " + String(raw).slice(0, 160));
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { }
        let list = [];
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.dead)) list = data.dead;
        else if (data && Array.isArray(data.deadSources)) list = data.deadSources;
        else if (data && Array.isArray(data.sources)) list = data.sources;
        return list.filter(function (x) { return typeof x === "string"; });
    } catch (e) {
        return [];
    }
}

async function getMappleStreams(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        const type = mediaType === "tv" ? "tv" : "movie";
        if (type === "tv" && (season == null || episode == null)) return [];

        const tvSlug = type === "tv" ? `${Number(season)}-${Number(episode)}` : "";
        const referer = type === "tv"
            ? `${BASE_URL}/tv/${tmdbId}/${Number(season)}/${Number(episode)}`
            : `${BASE_URL}/movie/${tmdbId}`;

        const session = await createSession(tmdbId, type, tvSlug, referer);
        if (!session) return [];

        const dead = await getDeadSources(tmdbId, type, tvSlug);
        const active = SERVERS.filter(function (s) { return dead.indexOf(s.source) === -1; });
        console.log("[mapple] sources active=" + active.length + "/" + SERVERS.length +
            (dead.length ? " dead=[" + dead.join(",") + "]" : ""));

        const results = await Promise.all(active.map(function (server) {
            return fetchServerStreams(server, tmdbId, type, tvSlug, session);
        }));
        return selectStreams([].concat.apply([], results));
    } catch (e) {
        console.log("[mapple] getMappleStreams error: " + e);
        return [];
    }
}

// ---- OpenSubtitles (keyless Stremio addon; xdfkenny's method) -------------
// Credits: xdfkenny (https://github.com/xdfkenny) — resolving subtitles with no
// API key or login by querying the keyless Stremio OpenSubtitles addon with the
// Referer it expects. Same block as the PenguPlay port.
const SUB_LANG_RANK = {
    eng: 0,
    spa: 1, por: 2, pob: 3, fre: 4, deu: 5, ita: 6,
    zho: 7, zht: 8, jpn: 9, kor: 10, rus: 11, ara: 12, tur: 13,
    pol: 14, hin: 15, ind: 16, vie: 17, tha: 18, msa: 19,
    nld: 20, ell: 21, swe: 22, fin: 23, dan: 24, nor: 25,
    hun: 26, cze: 27, ces: 27, bul: 28, hrv: 29, srp: 30, bos: 31,
    ukr: 32, ron: 33, heb: 34, est: 35, lav: 36, lit: 37, slk: 38, slv: 39
};
const SUB_LANG_NAMES = {
    eng: "English", spa: "Spanish", por: "Portuguese", pob: "Portuguese (BR)",
    fre: "French", fra: "French", deu: "German", ger: "German", ita: "Italian",
    zho: "Chinese (Simplified)", zht: "Chinese (Traditional)", jpn: "Japanese",
    kor: "Korean", rus: "Russian", ara: "Arabic", tur: "Turkish", pol: "Polish",
    hin: "Hindi", ind: "Indonesian", msa: "Malay", vie: "Vietnamese", tha: "Thai",
    nld: "Dutch", dut: "Dutch", ell: "Greek", gre: "Greek", swe: "Swedish",
    fin: "Finnish", dan: "Danish", nor: "Norwegian", hun: "Hungarian",
    cze: "Czech", ces: "Czech", slk: "Slovak", slv: "Slovenian", bul: "Bulgarian",
    hrv: "Croatian", srp: "Serbian", bos: "Bosnian", ukr: "Ukrainian",
    ron: "Romanian", heb: "Hebrew", est: "Estonian", lav: "Latvian",
    lit: "Lithuanian", mal: "Malayalam", tam: "Tamil", tel: "Telugu",
    ben: "Bengali", fil: "Filipino", cat: "Catalan", glg: "Galician",
    eus: "Basque", cym: "Welsh", alb: "Albanian", ice: "Icelandic",
    may: "Malay", per: "Persian", fas: "Persian", tgl: "Tagalog",
    kur: "Kurdish", mac: "Macedonian", mkd: "Macedonian",
    slo: "Slovak", sqi: "Albanian", isl: "Icelandic", zsm: "Malay",
    spl: "Spanish (LatAm)", ces_cz: "Czech", chi: "Chinese (Simplified)",
    arm: "Armenian", geo: "Georgian", bur: "Burmese", khm: "Khmer",
    sin: "Sinhala", nep: "Nepali", urd: "Urdu", pan: "Punjabi",
    guj: "Gujarati", kan: "Kannada", mar: "Marathi", mya: "Burmese",
    aze: "Azerbaijani", kaz: "Kazakh", uzb: "Uzbek", bel: "Belarusian",
    lat: "Latin", epo: "Esperanto", afr: "Afrikaans", swa: "Swahili"
};

function subLabel(t) {
    const l = String((t && (t.lang || t.language)) || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SUB_LANG_NAMES, l)) return SUB_LANG_NAMES[l];
    if (t && t.label) return String(t.label);
    return l ? l.toUpperCase() : "Subtitle";
}

function isEnglishSub(t) {
    const l = String((t && (t.lang || t.language || t.label)) || "").toLowerCase();
    return l === "en" || l === "eng" || l === "english" || l.indexOf("english") > -1;
}

function curatedSubtitleEntries(list) {
    if (!Array.isArray(list) || list.length === 0) return [];
    const byLang = {};
    list.forEach(function (item) {
        if (!item) return;
        const url = item.url || item.file || item.src || item.link;
        if (!url) return;
        const lang = String(item.lang || item.language || "").toLowerCase();
        const existing = byLang[lang];
        const isUtf8 = url.indexOf("senc=") === -1;
        if (!existing || (isUtf8 && existing.url.indexOf("senc=") !== -1)) {
            byLang[lang] = { url: url, headers: item.headers || null };
        }
    });
    const entries = Object.keys(byLang).map(function (lang) {
        return {
            lang: lang,
            url: byLang[lang].url,
            headers: byLang[lang].headers || {},
            label: subLabel({ lang: lang }),
            rank: Object.prototype.hasOwnProperty.call(SUB_LANG_RANK, lang) ? SUB_LANG_RANK[lang] : 999
        };
    });
    entries.sort(function (a, b) {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.lang < b.lang ? -1 : (a.lang > b.lang ? 1 : 0);
    });
    return entries;
}

// `osId` is already in the addon's own id form: "tt123" / "tt123:1:2".
async function resolveStremioSubtitles(osId, type) {
    if (!SUBS_ENABLED || !osId) return [];
    try {
        const url = STREMIO_OPENSUBTITLES_URL + "/subtitles/" + type + "/" + encodeURIComponent(osId) + ".json";
        const data = await getJSON(url, { "Accept": "application/json", "Referer": "https://app.strem.io/" });
        const list = ((data && data.subtitles) || [])
            .filter(function (it) { return it && it.url; })
            .map(function (it) {
                return { url: it.url, lang: String(it.lang || "").toLowerCase(), label: subLabel(it) };
            });
        console.log("[mapple] opensubtitles -> " + list.length + " tracks");
        return list;
    } catch (e) {
        console.log("[mapple] opensubtitles error: " + e);
        return [];
    }
}

// ---- TMDB metadata bridge -------------------------------------------------
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

function formatAirdate(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s;
    const name = MONTH_NAMES[parseInt(m[2], 10) - 1];
    if (!name) return m[1] + "-" + m[2] + "-" + m[3];
    return name + " " + parseInt(m[3], 10) + ", " + m[1];
}

// Search href carries the TMDB type + id: https://mapple.fun/api/tmdb/<type>/<id>
// Episode href appends a "#<season>:<episode>" fragment (movie = no fragment).
function parsePath(href) {
    const clean = String(href || "").split("#")[0];
    const m = clean.match(/\/(movie|tv)\/(\d+)/);
    return { type: m ? m[1] : "movie", id: m ? m[2] : "" };
}

async function getImdbId(type, id) {
    try {
        const data = await tmdbGet(`${TMDB}/${type}/${id}/external_ids`);
        return (data && data.imdb_id) || "";
    } catch (e) {
        return "";
    }
}

// ---- 1. SEARCH ------------------------------------------------------------
async function searchResults(keyword) {
    const out = [];
    try {
        let key = await ensureTmdbKey();
        const searchUrl = `${TMDB}/search/multi?query=${encodeURIComponent(keyword)}&page=1&include_adult=false&language=en-US`;
        let res = await httpGet(searchUrl, tmdbHeaders(key));
        if (res && res.status === 401) {
            console.log("[mapple] search 401 — refreshing session");
            resetSession();
            key = await ensureTmdbKey();
            res = await httpGet(searchUrl, tmdbHeaders(key));
        }
        const status = res && typeof res.status === "number" ? res.status : "?";
        let raw = "";
        try { raw = await res.text(); } catch (e) { }
        console.log("[mapple] search HTTP " + status + " keylen=" + (key ? key.length : 0) + " len=" + (raw ? raw.length : 0));
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { }
        const results = (data && data.results) || [];
        results.forEach(function (it) {
            if (!it) return;
            const type = it.media_type;
            if (type !== "movie" && type !== "tv") return;
            if (!it.id) return;
            const name = type === "tv" ? (it.name || it.original_name) : (it.title || it.original_title);
            if (!name) return;
            const date = type === "tv" ? it.first_air_date : it.release_date;
            const year = date ? String(date).slice(0, 4) : "";
            out.push({
                title: name + (year ? " (" + year + ")" : ""),
                image: it.poster_path ? (TMDB_IMG + it.poster_path) : "",
                href: `${TMDB}/${type}/${it.id}`
            });
        });
        console.log("[mapple] search '" + keyword + "' -> " + out.length + " results");
    } catch (e) {
        console.log("[mapple] search error: " + e);
    }
    return JSON.stringify(out);
}

// ---- 2. DETAILS -----------------------------------------------------------
async function extractDetails(url) {
    const details = [{ description: "", aliases: "", airdate: "" }];
    try {
        const { type, id } = parsePath(url);
        const data = await tmdbGet(`${TMDB}/${type}/${id}?language=en-US`);
        if (data) {
            details[0].description = data.overview || "";
            details[0].aliases = (data.genres || []).map(function (g) { return g.name; }).filter(Boolean).join(", ");
            details[0].airdate = formatAirdate(type === "tv" ? data.first_air_date : data.release_date);
        }
    } catch (e) {
        console.log("[mapple] details error: " + e);
    }
    return JSON.stringify(details);
}

// ---- 3. EPISODES ----------------------------------------------------------
async function extractEpisodes(url) {
    const { type, id } = parsePath(url);
    const eps = [];
    try {
        if (type === "movie") {
            eps.push({ href: url, number: 1 });
        } else {
            const data = await tmdbGet(`${TMDB}/tv/${id}?language=en-US`);
            const seasons = ((data && data.seasons) || [])
                .filter(function (s) { return s && s.season_number > 0 && (s.episode_count == null || s.episode_count > 0); })
                .sort(function (a, b) { return a.season_number - b.season_number; });

            const seasonData = await Promise.all(seasons.map(function (s) {
                return tmdbGet(`${TMDB}/tv/${id}/season/${s.season_number}?language=en-US`).catch(function () { return null; });
            }));

            // `number` is the per-season episode number (NOT a running count):
            // Shirox detects season boundaries by watching the number reset, so
            // 1..10, 1..9 splits into seasons while a flat 1..35 renders as one.
            seasonData.forEach(function (sd) {
                if (!sd || !Array.isArray(sd.episodes)) return;
                const sn = sd.season_number;
                sd.episodes
                    .filter(function (ep) { return ep && ep.episode_number != null; })
                    .sort(function (a, b) { return a.episode_number - b.episode_number; })
                    .forEach(function (ep) {
                        eps.push({ href: url + "#" + sn + ":" + ep.episode_number, number: ep.episode_number });
                    });
            });
        }
        console.log("[mapple] episodes -> " + eps.length);
    } catch (e) {
        console.log("[mapple] episodes error: " + e);
    }
    return JSON.stringify(eps);
}

// ---- 4. STREAMS -----------------------------------------------------------
async function extractStreamUrl(url) {
    const { type, id } = parsePath(url);
    const frag = url.indexOf("#") > -1 ? url.split("#")[1] : "";
    let season = null, episode = null;
    if (type === "tv" && frag) {
        const p = frag.split(":");
        season = p[0];
        episode = p[1];
    }
    const mediaType = type === "tv" ? "tv" : "movie";

    const subtitles = [];
    try {
        // Streams and subtitles in parallel — OpenSubtitles adds no wall time.
        // Subs need the IMDb id (external_ids), then the addon's id form.
        const osPromise = (async function () {
            if (!SUBS_ENABLED) return [];
            const imdb = await getImdbId(mediaType, id);
            if (!imdb) return [];
            const osId = mediaType === "tv" ? (imdb + ":" + season + ":" + episode) : imdb;
            const osType = mediaType === "tv" ? "series" : "movie";
            return resolveStremioSubtitles(osId, osType);
        })();

        const [streams, osSubs] = await Promise.all([
            getMappleStreams(id, mediaType, season, episode),
            osPromise.catch(function () { return []; })
        ]);

        (osSubs || []).forEach(function (t) {
            if (t && t.url) subtitles.push(t);
        });

        const curated = curatedSubtitleEntries(subtitles);

        // Sora convention: flat [label, url, label, url, ...] pair array.
        const subtitlePairs = [];
        curated.forEach(function (t) { subtitlePairs.push(t.label, t.url); });

        // Shirox-family convention: in-player menu reads `allSubtitles`.
        const allSubtitles = curated.map(function (t) {
            return { url: t.url, label: t.label, kind: "subtitles", headers: t.headers || {} };
        });

        // Auto-load default: first non-forced English, else first English, else first.
        const english = curated.filter(isEnglishSub);
        const preferred = english.find(function (t) {
            return !/forced|signs|sdh|hi\b/i.test(String(t.label || ""));
        }) || english[0] || curated[0];
        const subtitle = (preferred && preferred.url) ? preferred.url : "";

        const primaryStream = streams.length ? (streams[0].streamUrl || streams[0].url) : "";

        console.log("[mapple] streams=" + streams.length + " subs=" + curated.length +
            " (" + mediaType + "/" + id + (mediaType === "tv" ? "/" + season + "/" + episode : "") + ")");

        return JSON.stringify({
            stream: primaryStream,
            streams: streams,
            subtitle: subtitle,
            subtitles: subtitlePairs.length >= 2 ? subtitlePairs : (subtitle || []),
            subtitlesHeaders: {},
            allSubtitles: allSubtitles
        });
    } catch (e) {
        console.log("[mapple] stream error: " + e);
        return JSON.stringify({ stream: "", streams: [], subtitle: "", subtitles: [], subtitlesHeaders: {}, allSubtitles: [] });
    }
}
