// Pass options.impersonate ('webview' | 'chrome') through to Paul's browser-engine
// fetchv2 commit. 'webview' routes the request through the app's real WebView, so
// the CFBypass-solved cf_clearance applies and Cloudflare managed challenges pass.
async function soraFetch(url, options = {}) {
    const opts = options || {};
    const headers = opts.headers || {};
    const imp = opts.impersonate;
    try {
        return await fetchv2(url, headers, opts.method || 'GET', opts.body || null, imp ? { impersonate: imp } : {});
    } catch (e) {
        try {
            return await fetchv2(url, { method: opts.method || 'GET', headers: headers, body: opts.body || null, impersonate: imp });
        } catch (e2) {
            try {
                return await fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body || null });
            } catch (error) {
                return null;
            }
        }
    }
}

/* Shirox's HTTP cache can hand back a stale body under a 304 (a different
 * series' data served for the requested id). A unique per-request param makes
 * every data URL novel so the cache can never serve a stale hit. Kept to the
 * /cdn/v1 JSON routes only — NEVER put a cache-buster on /api/ (mangadot lesson:
 * unexpected query params trip the Cloudflare managed challenge there). */
let __cbSeq = 0;
function noCache(url) {
    const sep = url.indexOf("?") !== -1 ? "&" : "?";
    return url + sep + "_ts=" + Date.now().toString(36) + (++__cbSeq).toString(36);
}

/* toonkotsu's /api/ routes sit behind the same Cloudflare managed-challenge
 * infrastructure seen on the site (cdn-cgi/challenge-platform). Headers alone
 * won't clear it, so the chapter-pages call goes through impersonate:'webview'
 * (the app's CFBypass clearance applies); the same-origin headers ride along to
 * match the site's own XHR. The /cdn/v1 routes are NOT challenged and fetch
 * plain. */
const API_HEADERS = {
    "Referer": "https://toonkotsu.com/",
    "Origin": "https://toonkotsu.com",
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest"
};

const BASE = "https://toonkotsu.com";

function toAbsolute(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("http://") === 0) return "https://" + u.substring(7);
    if (u.indexOf("https://") === 0) return u;
    return BASE + (u.indexOf("/") === 0 ? "" : "/") + u;
}

/* Series pages are /title/{hid}-{slug}; the hid is the leading token before the
 * first dash and is the key for /cdn/v1/series/{hid}. */
function extractHid(url) {
    const seg = /\/title\/([^\/?#]+)/.exec(String(url));
    if (!seg) return null;
    const dash = seg[1].indexOf("-");
    return dash === -1 ? seg[1] : seg[1].slice(0, dash);
}

/* Chapter pages are /title/{hid}-{slug}/{uploadId}-chapter-{n}; the numeric
 * uploadId is what /api/manga/chapter/{id} takes. */
function extractChapterId(url) {
    const m = /\/(\d+)-chapter-/.exec(String(url));
    return m ? m[1] : null;
}

/* URL form for a chapter number: 94.5 -> "94-5" (matches the site's own
 * /...-chapter-94-5 slug). */
function chapterNumSlug(n) {
    return String(n).replace(".", "-");
}

/* Chapter labels are usually generic ("Chapter 147") but sometimes carry the
 * real name ("Chapter 144: \"Embracing\" Fern.", "Episode 50", "Oneshot").
 * Strip the "Chapter N"/"Episode N" scaffolding and keep any real remainder. */
function cleanChapterTitle(t) {
    if (!t) return "";
    t = String(t).trim();
    t = t.replace(/^(?:chapter|episode|ep|ch|vol(?:ume)?)\.?\s*[0-9]+(?:\.[0-9]+)?\s*[-:.]?\s*/i, "").trim();
    return t;
}
function isRealTitle(t) {
    if (!t) return false;
    if (/^(?:chapter|ch\.?|episode|ep\.?|vol(?:ume)?|oneshot|one-shot|extra|prologue|epilogue)?\s*[0-9]*(?:\.[0-9]+)?$/i.test(t)) return false;
    if (!/[a-z]/i.test(t)) return false;              // needs letters
    return true;
}
/* best real title across a chapter's uploads, else "Chapter N" */
function bestChapterTitle(labels, num) {
    let best = "", bestLen = 0;
    for (let i = 0; i < labels.length; i++) {
        const c = cleanChapterTitle(labels[i]);
        if (isRealTitle(c) && c.length > bestLen) { bestLen = c.length; best = c; }
    }
    return best || ("Chapter " + num);
}

/* When true, a chapter that has a colored upload defaults to it, falling back to
 * the highest-resolution scan below when no colored version exists. toonkotsu
 * exposes no explicit color flag, so colored is detected by group name — same
 * basis as the mangadot module. Flip to false to rank purely by resolution. */
const PREFER_COLORED = true;

function groupLabel(g) {
    if (!g) return "";
    if (typeof g === "string") return g;
    return String(g.name || g.slug || "");
}
function isColored(g) {
    return /colou?r/i.test((g && typeof g === "object") ? (String(g.slug || "") + " " + String(g.name || "")) : String(g || ""));
}

/* Rank an upload: colored first (if enabled), then by width, then bpp, then
 * filesize. Higher is better, so we return a descending sort comparator. */
function uploadRank(a, b) {
    if (PREFER_COLORED) {
        const ca = isColored(a.group) ? 1 : 0, cb = isColored(b.group) ? 1 : 0;
        if (ca !== cb) return cb - ca;
    }
    if ((b.w || 0) !== (a.w || 0)) return (b.w || 0) - (a.w || 0);
    if ((b.bpp || 0) !== (a.bpp || 0)) return (b.bpp || 0) - (a.bpp || 0);
    return (b.mb || 0) - (a.mb || 0);
}

async function searchResults(keyword, page = 1) {
    const results = [];
    try {
        const url = BASE + "/cdn/v1/browse?q=" + encodeURIComponent(keyword) +
            "&genreMode=all&excludeMode=any&sort=relevance&order=desc&page=" + page +
            "&limit=42&sfw=1";
        const response = await soraFetch(noCache(url));
        if (!response) return results;

        const json = JSON.parse(await response.text());
        const list = json && Array.isArray(json.items) ? json.items : [];

        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m || !m.hid) continue;
            const slug = m.slug ? ("-" + m.slug) : "";
            results.push({
                id: BASE + "/title/" + m.hid + slug,
                imageURL: toAbsolute(m.cover),
                title: String(m.title || "Untitled").trim()
            });
        }
        return results;
    } catch (err) {
        return results;
    }
}

async function extractDetails(url) {
    try {
        const hid = extractHid(url);
        if (!hid) return { description: "Error", tags: [] };

        const response = await soraFetch(noCache(BASE + "/cdn/v1/series/" + hid));
        if (!response) return { description: "Error", tags: [] };

        const json = JSON.parse(await response.text());
        const s = (json && json.series) ? json.series : {};

        return {
            description: String(s.description || "").trim(),
            tags: Array.isArray(s.tags) ? s.tags.map(function (g) { return String(g).trim(); }) : []
        };
    } catch (err) {
        return { description: "Error", tags: [] };
    }
}

async function extractChapters(url) {
    try {
        const hid = extractHid(url);
        if (!hid) return { en: [] };

        const response = await soraFetch(noCache(BASE + "/cdn/v1/series/" + hid));
        if (!response) return { en: [] };

        const json = JSON.parse(await response.text());
        const s = (json && json.series) ? json.series : {};
        const slug = s.slug || "";
        const rawhid = s.hid || hid;
        const list = (json && Array.isArray(json.chapters)) ? json.chapters : [];

        // Flatten every upload for every chapter: each top-level row plus its
        // alts is one upload (own id/width/group). Dedupe by upload id, group
        // by chapter number. The list is NOT deduped by number, so the same
        // chapter can surface under several rows — the map merges them.
        const byNum = {};   // n -> { uploads: {id->upload}, labels: {} }
        function add(up, n) {
            if (!up || up.id == null || isNaN(n)) return;
            if (!byNum[n]) { byNum[n] = { uploads: {}, labels: {} }; }
            byNum[n].uploads[up.id] = {
                id: up.id,
                group: up.group,
                w: Number(up.w) || 0,
                bpp: Number(up.bpp) || 0,
                mb: Number(up.mb) || 0
            };
            if (up.label) byNum[n].labels[String(up.label)] = 1;
        }
        for (let i = 0; i < list.length; i++) {
            const ch = list[i];
            if (!ch) continue;
            const n = parseFloat(ch.n);
            add(ch, n);
            if (Array.isArray(ch.alts)) {
                for (let j = 0; j < ch.alts.length; j++) add(ch.alts[j], n);
            }
        }

        const nums = Object.keys(byNum).map(parseFloat).sort(function (a, b) { return b - a; }); // newest first
        const out = [];
        for (let i = 0; i < nums.length; i++) {
            const n = nums[i];
            const bucket = byNum[n];
            const uploads = Object.keys(bucket.uploads).map(function (k) { return bucket.uploads[k]; });
            uploads.sort(uploadRank);  // colored -> highest resolution
            const title = bestChapterTitle(Object.keys(bucket.labels), n);

            const entries = [];
            for (let u = 0; u < uploads.length; u++) {
                entries.push({
                    id: BASE + "/title/" + rawhid + (slug ? "-" + slug : "") + "/" + uploads[u].id + "-chapter-" + chapterNumSlug(n),
                    chapter: n,
                    title: title,
                    scanlation_group: groupLabel(uploads[u].group)
                });
            }
            out.push([String(n), entries]);
        }

        return { en: out };
    } catch (err) {
        return { en: [] };
    }
}

async function extractImages(url) {
    const results = [];
    try {
        const chId = extractChapterId(url);
        if (!chId) return results;

        // /api/ is Cloudflare-challenged — WebView engine so CFBypass clearance clears it.
        const response = await soraFetch(BASE + "/api/manga/chapter/" + chId, { headers: API_HEADERS, impersonate: "webview" });
        if (!response) return results;

        const json = JSON.parse(await response.text());
        const pages = (json && json.chapter && Array.isArray(json.chapter.pages)) ? json.chapter.pages : [];
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            if (p && p.src) results.push(toAbsolute(p.src));
        }
        return results;
    } catch (err) {
        return results;
    }
}
