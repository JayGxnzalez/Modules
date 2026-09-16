/* ==================================================================
 * megaplay/vidwish `enc` support.
 *
 * As of player v2.8 these hosts no longer return a plaintext
 * sources.file. getSources now returns an `enc` blob: base64url,
 * AES-256-CBC. Decrypting it yields {"file":"<master.m3u8>"}.
 *
 * The CDN then requires a short-lived signed token appended to the
 * master URL:
 *     payload = "<unix_expiry>|<hash1>/<hash2>"   (the two 32-hex
 *               path segments of the m3u8 URL; expiry = now + 90s)
 *     token   = base64url(payload) + "." + base64url(HMAC_SHA256(payload))
 * The token gates only the master playlist — variant playlists and
 * segments are fetched untokenized, so the player walks the ladder
 * unaided once it has the signed master.
 *
 * Constants live in megaplay's newclient.min.js (AES key + IV, in
 * plaintext) and e1-player.min.js (HMAC key, inside the obfuscated
 * string table). Expect them to rotate with the player's ?v= number;
 * when playback breaks, re-check those two files first.
 *
 * Verified end-to-end against a real capture: the decrypt reproduces
 * the observed master.m3u8, and the minted token is byte-identical to
 * the one the browser produced for the same episode.
 * ================================================================== */
const MP_AES_KEY = "i?LMTAx0Q6,:}50U";
const MP_AES_IV  = "W0;27ToaUpl_P%'c";
const MP_HMAC_KEY = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
const MP_TOKEN_TTL = 90;

/* ==================================================================
 * megaplay crypto helpers — pure JS, JavaScriptCore safe.
 * No crypto.subtle, no atob/btoa, no TextEncoder, no timers.
 * Everything operates on plain arrays of byte values.
 * ================================================================== */

// ---- byte / string helpers -------------------------------------------------
function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
            const c2 = str.charCodeAt(i + 1);
            c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++;
            out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
}

function bytesToUtf8(b) {
    let s = "";
    for (let i = 0; i < b.length;) {
        const c = b[i];
        if (c < 0x80) { s += String.fromCharCode(c); i += 1; }
        else if (c < 0xe0) { s += String.fromCharCode(((c & 31) << 6) | (b[i + 1] & 63)); i += 2; }
        else if (c < 0xf0) { s += String.fromCharCode(((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; }
        else {
            let cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63);
            cp -= 0x10000;
            s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
            i += 4;
        }
    }
    return s;
}

const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Accepts standard or URL-safe base64; padding optional.
function b64ToBytes(str) {
    let s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
        const c0 = B64C.indexOf(s.charAt(i)), c1 = B64C.indexOf(s.charAt(i + 1));
        const a2 = s.charAt(i + 2), a3 = s.charAt(i + 3);
        const c2 = (a2 === "" || a2 === "=") ? -1 : B64C.indexOf(a2);
        const c3 = (a3 === "" || a3 === "=") ? -1 : B64C.indexOf(a3);
        if (c0 < 0 || c1 < 0) break;
        out.push((c0 << 2) | (c1 >> 4));
        if (c2 >= 0) out.push(((c1 & 15) << 4) | (c2 >> 2));
        if (c3 >= 0) out.push(((c2 & 3) << 6) | c3);
    }
    return out;
}

function bytesToB64url(b) {
    let s = "";
    for (let i = 0; i < b.length; i += 3) {
        const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2];
        s += B64C.charAt(b0 >> 2);
        s += B64C.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4));
        s += (b1 === undefined) ? "" : B64C.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6));
        s += (b2 === undefined) ? "" : B64C.charAt(b2 & 63);
    }
    return s.replace(/\+/g, "-").replace(/\//g, "_");
}

// Player behaviour: TextEncoder(str) copied into a zero-filled buffer of fixed
// length. A short string is therefore zero-padded, a long one truncated.
function padKey(str, len) {
    const src = utf8Bytes(str), out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = i < src.length ? src[i] : 0;
    return out;
}

// ---- SHA-256 ---------------------------------------------------------------
const K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256Bytes(msg) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = msg.length, bitLenHi = Math.floor(l / 536870912), bitLenLo = (l * 8) >>> 0;
    const padded = msg.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    padded.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255);
    padded.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);

    const w = new Array(64);
    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = ((padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) |
                    (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3]) >>> 0;
        }
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15], b = w[i - 2];
            const s0 = (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) >>> 0;
            const s1 = (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)) >>> 0;
            w[i] = (((w[i - 16] + s0) >>> 0) + ((w[i - 7] + s1) >>> 0)) >>> 0;
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let i = 0; i < 64; i++) {
            const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
            const ch = ((e & f) ^ (~e & g)) >>> 0;
            const t1 = (((((h + S1) >>> 0) + ch) >>> 0) + ((K256[i] + w[i]) >>> 0)) >>> 0;
            const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
            const mj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            const t2 = ((S0 + mj) >>> 0);
            h = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = [];
    for (let i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
    return out;
}

// ---- HMAC-SHA-256 ----------------------------------------------------------
function hmacSha256(keyBytes, msgBytes) {
    let k = keyBytes.slice();
    if (k.length > 64) k = sha256Bytes(k);
    while (k.length < 64) k.push(0);
    const ipad = new Array(64), opad = new Array(64);
    for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
    const inner = sha256Bytes(ipad.concat(msgBytes));
    return sha256Bytes(opad.concat(inner));
}

// ---- AES (decrypt only) ----------------------------------------------------
const SBOX = new Array(256), INV_SBOX = new Array(256);
(function buildSbox() {
    let p = 1, q = 1;
    const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 255;
    do {
        p = (p ^ ((p << 1) & 255) ^ ((p & 0x80) ? 0x1b : 0)) & 255;
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255;
        if (q & 0x80) q ^= 0x09;
        const v = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 255;
        SBOX[p] = v;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();

function xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 255; }
function gmul(a, b) {
    let r = 0;
    for (let i = 0; i < 8; i++) {
        if (b & 1) r ^= a;
        b >>= 1; a = xtime(a);
    }
    return r & 255;
}

// AES-256 -> Nk=8, Nr=14
function expandKey(key) {
    const Nk = key.length / 4, Nr = Nk + 6, total = 4 * (Nr + 1);
    const w = [];
    for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    let rcon = 1;
    for (let i = Nk; i < total; i++) {
        let t = w[i - 1].slice();
        if (i % Nk === 0) {
            t = [SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
            rcon = xtime(rcon);
        } else if (Nk > 6 && i % Nk === 4) {
            t = [SBOX[t[0]], SBOX[t[1]], SBOX[t[2]], SBOX[t[3]]];
        }
        w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]);
    }
    return { w: w, Nr: Nr };
}

function addRoundKey(s, w, round) {
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) s[r][c] ^= w[round * 4 + c][r];
}

function decryptBlock(block, ks) {
    const w = ks.w, Nr = ks.Nr;
    const s = [[], [], [], []];
    for (let i = 0; i < 16; i++) s[i % 4][Math.floor(i / 4)] = block[i];

    addRoundKey(s, w, Nr);
    for (let round = Nr - 1; round >= 0; round--) {
        // InvShiftRows
        for (let r = 1; r < 4; r++) {
            const row = s[r].slice();
            for (let c = 0; c < 4; c++) s[r][(c + r) % 4] = row[c];
        }
        // InvSubBytes
        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++) s[r][c] = INV_SBOX[s[r][c]];
        addRoundKey(s, w, round);
        // InvMixColumns (skip on final)
        if (round > 0) {
            for (let c = 0; c < 4; c++) {
                const a0 = s[0][c], a1 = s[1][c], a2 = s[2][c], a3 = s[3][c];
                s[0][c] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
                s[1][c] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
                s[2][c] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
                s[3][c] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
            }
        }
    }
    const out = new Array(16);
    for (let i = 0; i < 16; i++) out[i] = s[i % 4][Math.floor(i / 4)];
    return out;
}

function aesCbcDecrypt(keyBytes, ivBytes, cipherBytes) {
    if (cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) return null;
    const ks = expandKey(keyBytes);
    const out = [];
    let prev = ivBytes.slice();
    for (let off = 0; off < cipherBytes.length; off += 16) {
        const blk = cipherBytes.slice(off, off + 16);
        const dec = decryptBlock(blk, ks);
        for (let i = 0; i < 16; i++) out.push(dec[i] ^ prev[i]);
        prev = blk;
    }
    // strip PKCS#7
    const pad = out[out.length - 1];
    if (pad > 0 && pad <= 16 && pad <= out.length) {
        let ok = true;
        for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) ok = false;
        if (ok) out.length = out.length - pad;
    }
    return out;
}


// Decrypt an `enc` blob into the plaintext stream URL. Returns null on
// any failure so the caller can fall back rather than throw.
function mpDecryptEnc(enc) {
    try {
        const bytes = aesCbcDecrypt(padKey(MP_AES_KEY, 32), padKey(MP_AES_IV, 16), b64ToBytes(enc));
        if (!bytes) return null;
        const obj = JSON.parse(bytesToUtf8(bytes));
        return (obj && typeof obj.file === "string") ? obj.file : null;
    } catch (e) {
        console.log("[megaplay] enc decrypt failed: " + e);
        return null;
    }
}

// Append the signed token. A URL that already carries one, or that has
// no 32-hex pair to sign, is returned untouched — same as the player.
function mpSignUrl(url) {
    try {
        if (!url || /[?&]token=/.test(url)) return url;
        const m = String(url).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
        if (!m) return url;
        const expiry = Math.floor(Date.now() / 1000) + MP_TOKEN_TTL;
        const payload = expiry + "|" + m[1].toLowerCase() + "/" + m[2].toLowerCase();
        const pb = utf8Bytes(payload);
        const token = bytesToB64url(pb) + "." + bytesToB64url(hmacSha256(utf8Bytes(MP_HMAC_KEY), pb));
        return url + (url.indexOf("?") === -1 ? "?" : "&") + "token=" + encodeURIComponent(token);
    } catch (e) {
        console.log("[megaplay] token mint failed: " + e);
        return url;
    }
}

const ANIKOTO_BASE = "https://anikototv.to";
const MEGAPLAY = "https://megaplay.buzz";
const VIDWISH = "https://vidwish.live";
const VIDTUBE = "https://vidtube.site";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// Shared subtitle/stream shaping — used by the embed extractor.
function buildStreamResult(data, referer) {
    const tracks = data.tracks || [];
    let englishSub = "";
    const engTrack = tracks.find(t => t.kind === "captions" && t.label && t.label.toLowerCase().includes("english"));
    if (engTrack?.file) englishSub = engTrack.file;
    else {
        const firstCaption = tracks.find(t => t.kind === "captions" && t.file);
        if (firstCaption) englishSub = firstCaption.file;
    }
    const allSubtitles = tracks.filter(t => t.file).map(t => ({
        url: t.file, label: t.label || t.kind, kind: t.kind, headers: { Referer: referer }
    }));
    // v2.8+ returns `enc`; older responses carried sources.file directly.
    // Both are handled so a rollback on their side doesn't break playback.
    let streamUrl = data?.sources?.file || "";
    if (!streamUrl && data.enc) {
        const decrypted = mpDecryptEnc(data.enc);
        if (decrypted) streamUrl = mpSignUrl(decrypted);
    }
    if (!streamUrl) return null;

    return {
        streamUrl,
        subtitles: englishSub,
        subtitlesHeaders: { Referer: referer },
        allSubtitles,
        headers: { Referer: referer }
    };
}

// ══════════════════════════════════════════════════════════════════
// Anikoto site scrape — search, details, episode list, server list.
// Everything comes directly from anikototv.to, same pattern as every
// other module: search the real site, use whatever's actually there.
// No external ID service (AniList/MAL) involved anywhere in this file.
// ══════════════════════════════════════════════════════════════════
class Anikoto {
    // Confirmed live: real results live in #list-items. The page also
    // carries a "Top rated anime" sidebar using the identical
    // <a class="item" href=".../watch/..."> pattern, so this scopes
    // strictly to the results grid rather than matching anywhere on
    // the page. Each item card carries its numeric show ID directly
    // via data-tip, so no separate watch-page fetch is needed to get it.
    static async search(keyword) {
        const url = ANIKOTO_BASE + "/filter?keyword=" + encodeURIComponent(keyword);
        console.log("[Anikoto] Searching: " + url);

        const resp = await soraFetch(url, { headers: { "User-Agent": UA, "Referer": ANIKOTO_BASE + "/" } });
        if (!resp || resp.status !== 200) {
            console.error("[Anikoto] Search fetch failed, status: " + (resp ? resp.status : "null"));
            return [];
        }
        const html = await resp.text();

        const gridStart = html.indexOf('id="list-items"');
        if (gridStart === -1) {
            console.warn("[Anikoto] No results grid found for: " + keyword);
            return [];
        }
        const gridEndMarker = html.indexOf("pre-pagination", gridStart);
        const gridHtml = gridEndMarker === -1 ? html.slice(gridStart) : html.slice(gridStart, gridEndMarker);

        const blocks = gridHtml.split('<div class="item ">').slice(1);
        const results = [];
        for (const block of blocks) {
            const slugMatch = block.match(/href="https:\/\/anikototv\.to\/watch\/([^"\/]+)\/ep-\d+"/);
            const tipMatch = block.match(/data-tip="(\d+)"/);
            // Visible anchor text (English title), not data-jp — that
            // attribute holds the Japanese/romaji title.
            const titleMatch = block.match(/<a class="name d-title"[^>]*>([^<]*)<\/a>/);
            const posterMatch = block.match(/<img\s+src="([^"]+)"/);
            if (!slugMatch || !tipMatch) continue;
            results.push({
                slug: slugMatch[1],
                showId: tipMatch[1],
                title: titleMatch ? titleMatch[1].trim() : "Untitled",
                poster: posterMatch ? posterMatch[1] : ""
            });
        }

        console.log("[Anikoto] Search returned " + results.length + " item(s)");
        return results;
    }

    // Best-effort scrape of the watch page's info block. Built from
    // confirmed real markup (Bleach watch page capture), but watch pages
    // may vary slightly by content type (movie/special vs TV) — treat
    // any single field coming back empty as expected, not a bug.
    static async getDetails(slug) {
        const url = ANIKOTO_BASE + "/watch/" + slug;
        const resp = await soraFetch(url, { headers: { "User-Agent": UA, "Referer": ANIKOTO_BASE + "/" } });
        if (!resp || resp.status !== 200) return null;
        const html = await resp.text();

        const synMatch = html.match(/<div class="synopsis[^"]*">[\s\S]*?<div class="content">([\s\S]*?)<\/div>/);
        const synopsis = synMatch
            ? synMatch[1].replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "").trim()
            : "";

        const getField = (label) => {
            const re = new RegExp(label + ":\\s*<span>\\s*(?:<a[^>]*>)?\\s*([^<]*?)\\s*(?:<\\/a>)?\\s*<\\/span>", "i");
            const m = html.match(re);
            return m ? m[1].trim() : "";
        };

        const genres = [...html.matchAll(/<a href="https:\/\/anikototv\.to\/genre\/[^"]*">\s*([^<]+?)\s*<\/a>/g)]
            .slice(0, 6)
            .map(m => m[1].trim())
            .join(", ");

        return {
            synopsis,
            aired: getField("Aired"),
            status: getField("Status"),
            duration: getField("Duration"),
            genres
        };
    }

    // Confirmed live, byte-perfect: data-id/num/slug/sub/dub/ids on each
    // episode anchor.
    static async getEpisodes(showId) {
        const url = ANIKOTO_BASE + "/ajax/episode/list/" + showId;
        const resp = await soraFetch(url, {
            headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": ANIKOTO_BASE + "/" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") {
            console.warn("[Anikoto] Episode list fetch failed for showId " + showId + ", status: " + (resp ? resp.status : "null"));
            return [];
        }
        let json;
        try { json = await resp.json(); } catch (e) {
            console.warn("[Anikoto] Episode list JSON parse failed for showId " + showId);
            return [];
        }
        const html = json?.result || "";
        if (!html) {
            console.warn("[Anikoto] Episode list result HTML was empty for showId " + showId);
        }

        const episodes = [];
        const re = /<a\s[^>]*data-id="[^"]*"[^>]*>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const tag = m[0];
            const g = (attr) => tag.match(new RegExp("data-" + attr + '="([^"]*)"'))?.[1] || "";
            const num = g("num"), ids = g("ids");
            if (!num || !ids) continue;
            episodes.push({ num: parseInt(num, 10), hasDub: g("dub") === "1", ids });
        }

        console.log("[Anikoto] Parsed " + episodes.length + " episodes for showId " + showId + ", dub count: " + episodes.filter(e => e.hasDub).length);
        return episodes;
    }

    // Confirmed live: HTML with sub/dub <div class="type"> blocks, each
    // server <li> carrying a data-link-id token.
    static async getServerList(idsToken, audio) {
        const url = ANIKOTO_BASE + "/ajax/server/list?servers=" + encodeURIComponent(idsToken);
        const resp = await soraFetch(url, {
            headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": ANIKOTO_BASE + "/" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") {
            console.warn("[Anikoto] Server list fetch failed, status: " + (resp ? resp.status : "null"));
            return [];
        }
        let json;
        try { json = await resp.json(); } catch (e) {
            console.warn("[Anikoto] Server list JSON parse failed");
            return [];
        }
        const html = json?.result || "";

        const items = [];
        const typeRe = /<div class="type" data-type="(sub|dub)">([\s\S]*?)<\/ul>\s*<\/div>/g;
        let typeM;
        while ((typeM = typeRe.exec(html)) !== null) {
            if (typeM[1] !== audio) continue;
            for (const li of typeM[2].matchAll(/<li\s+([^>]*data-link-id[^>]*)>([\s\S]*?)<\/li>/g)) {
                const linkId = li[1].match(/data-link-id="([^"]+)"/)?.[1];
                const name = li[2].replace(/<[^>]+>/g, "").trim();
                if (linkId) items.push({ linkId, name });
            }
        }
        console.log("[Anikoto] Found " + items.length + " " + audio + " server(s)");
        return items;
    }

    // Confirmed live, many times.
    static async resolveServer(linkId) {
        const url = ANIKOTO_BASE + "/ajax/server?get=" + encodeURIComponent(linkId);
        const resp = await soraFetch(url, {
            headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": ANIKOTO_BASE + "/" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") return null;
        let json;
        try { json = await resp.json(); } catch (e) { return null; }
        return json?.result?.url || null;
    }

    // megaplay.buzz and vidwish.live share the same embed template
    // (data-id attribute + /stream/getSources?id= endpoint) — confirmed
    // live. vidtube.site's embed page looks like the same template by
    // title/warning text, but its real API differs: the endpoint is
    // /stream/getSourcesNew (not getSources) and requires an explicit
    // type=dub param — confirmed live. Only the request URL branches
    // per host; buildStreamResult() handles both the legacy
    // sources.file shape and the newer `enc` shape for all three.
    static async extractFromEmbed(embedUrl) {
        const host = [MEGAPLAY, VIDWISH, VIDTUBE].find(h => embedUrl.includes(h.replace("https://", "")));
        if (!host) {
            console.warn("[Anikoto] Unrecognized dub server host — no extractor for: " + embedUrl);
            return null;
        }
        const fileId = await extractFileId(embedUrl, host + "/");
        if (!fileId) return null;

        // The embed page installs a rewrite hook that appends the `s` param
        // of the embed URL onto any getSources request. `s` selects the CDN
        // (HD-1 = tcdn, HD-2 = bcdn), so dropping it makes every server
        // resolve to the same plain stream — hiding working fallbacks.
        // The hook matches "getSources" as a substring, so it covers
        // getSourcesNew too. Character class matches the site's sanitiser.
        const sParam = (String(embedUrl).match(/[?&]s=([A-Za-z0-9_-]+)/) || [])[1] || "";
        const sSuffix = sParam ? "&s=" + encodeURIComponent(sParam) : "";

        const sourcesUrl = host === VIDTUBE
            ? `${host}/stream/getSourcesNew?id=${fileId}&type=dub&id=${fileId}&type=dub` + sSuffix
            : `${host}/stream/getSources?id=${fileId}&id=${fileId}` + sSuffix;

        const resp = await soraFetch(sourcesUrl, {
            headers: { "Referer": host + "/", "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") return null;
        let data; try { data = await resp.json(); } catch (e) { return null; }
        // Accept either shape: the guard can't require sources.file any
        // more, since v2.8 responses only carry `enc`.
        if (!data?.sources?.file && !data?.enc) {
            console.warn("[Anikoto] getSources returned neither sources.file nor enc for " + host);
            return null;
        }
        const built = buildStreamResult(data, host + "/");
        if (built) console.log("[Anikoto] " + host + (sParam ? " (s=" + sParam + ")" : "") + " stream: " + built.streamUrl.substring(0, 110));
        return built;
    }
}

async function extractFileId(embedUrl, referer) {
    const resp = await soraFetch(embedUrl, { headers: { "Referer": referer, "User-Agent": UA } });
    if (!resp || resp.status !== 200) return null;
    const html = await resp.text();
    return html.match(/data-id="([^"]*)"/)?.[1] || null;
}

// ══════════════════════════════════════════════════════════════════
// Shirox entry points
// ══════════════════════════════════════════════════════════════════
async function searchResults(keyword) {
    try {
        console.log("[searchResults] Keyword: " + keyword);
        const items = await Anikoto.search(keyword);
        if (!items) return JSON.stringify([{ title: "Error", image: "", href: "" }]);

        const transformed = items.map(item => ({
            title: item.title,
            image: item.poster,
            href: "anime/" + item.slug + "?showId=" + item.showId
        }));

        return JSON.stringify(transformed);
    } catch (error) {
        console.log("[searchResults] Fetch error: " + error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

async function extractDetails(url) {
    try {
        const match = url.match(/anime\/([^\/\?]+)/);
        if (!match) throw new Error("Invalid URL format");
        const slug = match[1];

        const details = await Anikoto.getDetails(slug);
        if (!details) throw new Error("Could not fetch details");

        return JSON.stringify([{
            description: details.synopsis || "No description available",
            aliases: details.genres || ("Duration: " + (details.duration || "Unknown")),
            airdate: details.aired ? "Aired: " + details.aired : (details.status ? "Status: " + details.status : "Aired: Unknown")
        }]);
    } catch (error) {
        console.log("Details error: " + error);
        return JSON.stringify([{
            description: "Error loading description",
            aliases: "",
            airdate: "Aired: Unknown"
        }]);
    }
}

// Only dub-available episodes are listed (data-dub="1" on Anikoto's own
// episode list) — no dead entries that fail at play time.
async function extractEpisodes(url) {
    try {
        const match = url.match(/anime\/([^\/\?]+)\?showId=(\d+)/);
        if (!match) throw new Error("Invalid URL format");
        const [, slug, showId] = match;

        const episodesData = await Anikoto.getEpisodes(showId);
        if (!episodesData) return JSON.stringify([]);

        const dubOnly = episodesData.filter(ep => ep.hasDub);
        console.log("[extractEpisodes] " + dubOnly.length + " of " + episodesData.length + " episodes have a dub");

        const sorted = dubOnly.sort((a, b) => a.num - b.num);
        const episodesArray = sorted.map(ep => ({
            href: "anime/" + slug + "/" + ep.num + "?ids=" + encodeURIComponent(ep.ids),
            number: ep.num,
            title: "Episode " + ep.num
        }));

        return JSON.stringify(episodesArray);
    } catch (error) {
        console.log("Fetch error in extractEpisodes: " + error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const match = url.match(/anime\/([^\/]+)\/(\d+)\?ids=(.+)/);
        if (!match) throw new Error("Invalid URL format");
        const [, slug, epNumStr, idsEncoded] = match;
        const epNum = parseInt(epNumStr, 10);
        const idsToken = decodeURIComponent(idsEncoded);

        console.log("[extractStreamUrl] Slug: " + slug + ", Episode: " + epNum);

        const dubServers = await Anikoto.getServerList(idsToken, "dub");
        if (dubServers.length === 0) {
            console.warn("[extractStreamUrl] No dub servers available for this episode");
            return JSON.stringify({ streams: [], subtitles: "", subtitlesHeaders: {}, allSubtitles: [] });
        }

        // Anikoto's own server labels carry a trailing "-N" on Vidstream/
        // Vidplay entries (e.g. "Vidstream-2") that's just noise here —
        // strip it. HD-1/HD-2 are left untouched since the number there
        // is meaningful (distinguishes two real, different servers).
        const cleanLabel = (name) => name
            .replace(/^Vidstream-\d+$/i, "Vidstream")
            .replace(/^Vidplay-\d+$/i, "Vidplay");

        const results = await Promise.allSettled(dubServers.map(async (server) => {
            const embedUrl = await Anikoto.resolveServer(server.linkId);
            if (!embedUrl) return null;
            const streamData = await Anikoto.extractFromEmbed(embedUrl);
            if (!streamData) return null;
            return { title: cleanLabel(server.name), ...streamData };
        }));

        // Dedupe on the URL with any signed token stripped. Tokens embed a
        // per-call expiry, so two servers resolving to the identical file
        // produce different URLs and would otherwise both be listed.
        const dedupeKey = (u) => String(u).replace(/([?&])token=[^&]*/i, "$1").replace(/[?&]$/, "");
        const seenStream = {};
        const streams = [];
        let subtitles = "", subtitlesHeaders = {}, allSubtitles = [];
        for (const r of results) {
            if (r.status !== "fulfilled" || !r.value) continue;
            const s = r.value;
            if (!s.streamUrl) continue;
            const key = dedupeKey(s.streamUrl);
            if (seenStream[key]) continue;
            seenStream[key] = true;
            streams.push({ title: s.title, streamUrl: s.streamUrl, headers: s.headers });
            if (!subtitles && s.subtitles) { subtitles = s.subtitles; subtitlesHeaders = s.subtitlesHeaders; }
            if (s.allSubtitles?.length) allSubtitles.push(...s.allSubtitles);
        }

        if (streams.length === 0) {
            console.warn("[extractStreamUrl] Dub servers found but none resolved to a working stream");
            return JSON.stringify({ streams: [], subtitles: "", subtitlesHeaders: {}, allSubtitles: [] });
        }

        // De-duplicate subtitle tracks across providers
        const seenSub = {};
        allSubtitles = allSubtitles.filter(t => {
            if (!t.url || seenSub[t.url]) return false;
            seenSub[t.url] = true;
            return true;
        });

        const out = JSON.stringify({ streams, subtitles, subtitlesHeaders, allSubtitles });
        console.log("[extractStreamUrl] Result: " + out.substring(0, 300));
        return out;
    } catch (error) {
        console.log("[extractStreamUrl] Fetch error: " + error);
        return JSON.stringify({ streams: [], subtitles: "", subtitlesHeaders: {}, allSubtitles: [] });
    }
}

// ─── soraFetch (existing wrapper) ───
async function soraFetch(url, options = { headers: {}, method: "GET", body: null, encoding: "utf-8" }) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? "GET",
            options.body ?? null,
            true,
            options.encoding ?? "utf-8"
        );
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}
