/* MangaBall — Shirox manga source module
 * Author: Jay
 * Site: https://mangaball.com   API: https://api.mangaball.com/api/v1
 */

const SITE = "https://mangaball.com";
const API = "https://api.mangaball.com/api/v1";
const COVER_CDN = "https://bulbasaur.poke-black-and-white.net/covers/";

const CHAPTER_LIMIT = 500;
const MAX_CHAPTER_PAGES = 8;

/* Upstream source quality. MangaBall mirrors other sites and labels each
 * upload with a Pokemon "group" name, but the real quality signal is the
 * `site` field (the site it was scraped from). Higher = better scan. */
const SITE_QUALITY = {
    "mangadex": 100,
    "comick": 95,
    "weebcentral": 88,
    "mangapark": 86,
    "mangakatana": 84,
    "mangafire": 80,
    "mangabuddy": 78,
    "mangareader": 74,
    "mangasee": 72,
    "asurascans": 70,
    "flamecomics": 68,
    "mangahub": 60,
    "readcomicsonline": 56,
    "godamh": 54,
    "zinmanga": 52,
    "likemanga": 50,
    "daomeoden": 48,
    "komiku": 46,
    "komikcast": 46,
    "kiryuu": 44,
    "leercapitulo": 42,
    "mangaonline": 40,
    "hentairead": 30
};

const SITE_LABELS = {
    "mangadex": "MangaDex",
    "comick": "Comick",
    "weebcentral": "WeebCentral",
    "mangapark": "MangaPark",
    "mangakatana": "MangaKatana",
    "mangafire": "MangaFire",
    "mangabuddy": "MangaBuddy",
    "mangahub": "MangaHub",
    "godamh": "GoDaMH",
    "zinmanga": "ZinManga",
    "likemanga": "LikeManga",
    "daomeoden": "DaoMeoDen",
    "komiku": "Komiku",
    "komikcast": "KomikCast",
    "kiryuu": "Kiryuu",
    "leercapitulo": "LeerCapitulo",
    "mangaonline": "MangasOnline",
    "readcomicsonline": "ReadComicsOnline",
    "hentairead": "HentaiRead"
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function soraFetch(url, options) {
    if (!options) options = {};
    const headers = options.headers || {};
    if (!headers["Accept"]) headers["Accept"] = "application/json, text/plain, */*";
    if (!headers["Origin"]) headers["Origin"] = SITE;
    if (!headers["Referer"]) headers["Referer"] = SITE + "/";
    try {
        return await fetchv2(url, headers, options.method || "GET", options.body || null);
    } catch (e) {
        try {
            return await fetch(url, {
                method: options.method || "GET",
                headers: headers,
                body: options.body || null
            });
        } catch (error) {
            return null;
        }
    }
}

/* iOS ATS refuses plain http, so everything is forced to https. */
function httpsify(u) {
    u = String(u || "").trim();
    if (u.length === 0) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("http://") === 0) return "https://" + u.substring(7);
    if (u.indexOf("https://") === 0) return u;
    return SITE + (u.indexOf("/") === 0 ? "" : "/") + u;
}

function objectId(url) {
    const m = /([a-f0-9]{24})/i.exec(String(url || ""));
    return m ? m[1] : null;
}

function coverUrl(item) {
    const img = item && item.image ? item.image : null;
    if (!img) return "";
    if (img.cover && img.cover.path) {
        const p = String(img.cover.path).replace(/\\/g, "/").replace(/^\/+/, "");
        return COVER_CDN + p;
    }
    if (img.cdn_mangadex) return httpsify(img.cdn_mangadex);
    if (img.file) return httpsify(img.file);
    return "";
}

function siteLabel(site) {
    const s = String(site || "").toLowerCase();
    if (!s) return "MangaBall";
    if (SITE_LABELS[s]) return SITE_LABELS[s];
    return s.charAt(0).toUpperCase() + s.substring(1);
}

function qualityScore(entry) {
    const s = String(entry.site || "").toLowerCase();
    let score = SITE_QUALITY[s];
    if (score === undefined) score = 20;
    /* a real chapter title means the upload carries proper metadata */
    if (entry.realTitle) score += 5;
    /* popularity as a tie-break between equal sources */
    const views = parseInt(entry.views, 10);
    if (!isNaN(views)) score += Math.min(views / 1000, 3);
    return score;
}

/* ------------------------------------------------------------------ */
/* chapter titles                                                      */
/* ------------------------------------------------------------------ */

/* Most uploads name themselves "Chapter 147", "147", "" or the scanlation
 * group. Strip all of that so only a genuine chapter title survives. */
function realChapterTitle(raw, number, groupName) {
    let t = String(raw || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return "";

    const num = String(number);

    /* drop a leading volume marker: "Vol. 3 Chapter 12: Dawn" */
    t = t.replace(/^vol(?:ume)?\.?\s*\d+(?:\.\d+)?\s*[,:;\-–—]?\s*/i, "").trim();
    if (!t) return "";

    /* "Capitulo 145: Clarividencia" -> "Clarividencia" */
    const prefixed = new RegExp(
        "^(?:chapter|chap|ch|cap[ií]tulo|cap[ií]tol|capitulo|cap|chuong|chương|episode|ep|\\u7b2c)\\s*\\.?\\s*0*" +
        num.replace(".", "\\.") +
        "(?:\\.0+)?\\s*(?:\\u8bdd|\\u8a71|\\u7ae0)?\\s*[:：．.\\-–—]?\\s*",
        "i"
    );
    t = t.replace(prefixed, "").trim();

    /* bare number, or "Chapter 147" / "第147话" with nothing after it */
    if (!t) return "";
    if (/^[0-9]+(\.[0-9]+)?$/.test(t)) return "";
    if (/^(chapter|chap|ch|cap[ií]tulo|capitulo|chuong|chương|episode|ep)\b[\s.:#-]*[0-9]*(\.[0-9]+)?$/i.test(t)) return "";
    if (/^第?\s*[0-9]+\s*[话話章]$/.test(t)) return "";

    /* scanlation-group / watermark noise rather than a title */
    if (groupName && t.toLowerCase() === String(groupName).toLowerCase()) return "";
    if (/^(official(\s+translation)?|official\s+release|raw|raws)$/i.test(t)) return "";
    if (/\b(scans?|scanlations?|scanlation|fansub|team|group|translations?)\b\s*$/i.test(t) &&
        t === t.toUpperCase()) return "";
    if (/^(read|download)\b/i.test(t)) return "";

    /* strip a leading separator left over from the prefix removal */
    t = t.replace(/^[\s:：.\-–—]+/, "").trim();
    if (t.length < 2) return "";
    if (t.length > 120) t = t.substring(0, 120).trim();
    return t;
}

function displayTitle(number, realTitle) {
    const base = "Chapter " + number;
    return realTitle ? base + ": " + realTitle : base;
}

/* ------------------------------------------------------------------ */
/* searchResults                                                       */
/* ------------------------------------------------------------------ */

async function searchResults(keyword, page = 1) {
    const results = [];
    try {
        const url = API + "/title/search-advanced"
            + "?keyword=" + encodeURIComponent(keyword)
            + "&sort_by=lastupdate&sort_order=desc"
            + "&adult_mode=no_18&tag_mode=AND&use_user_settings=false"
            + "&page=" + (page || 1) + "&limit=24";

        const response = await soraFetch(url, { method: "GET" });
        if (!response) return results;

        const json = await response.json();
        const data = json && Array.isArray(json.data) ? json.data : [];

        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (!item) continue;
            const id = item.id || item._id;
            if (!id || !item.name) continue;
            results.push({
                id: SITE + "/title-detail/" + String(id),
                imageURL: coverUrl(item),
                title: String(item.name).trim()
            });
        }
        return results;
    } catch (err) {
        console.log("searchResults error: " + err);
        return results;
    }
}

/* ------------------------------------------------------------------ */
/* extractDetails                                                      */
/* ------------------------------------------------------------------ */

async function extractDetails(url) {
    try {
        const titleId = objectId(url);
        if (!titleId) return { description: "", tags: [] };

        const response = await soraFetch(API + "/title/" + titleId, { method: "GET" });
        if (!response) return { description: "", tags: [] };

        const json = await response.json();
        const data = json && json.data ? json.data : null;
        if (!data) return { description: "", tags: [] };

        let description = "";
        if (Array.isArray(data.description)) {
            for (let i = 0; i < data.description.length; i++) {
                const d = data.description[i];
                if (typeof d === "string" && d.trim()) { description = d.trim(); break; }
                if (d && typeof d.description === "string" && d.description.trim()) {
                    description = d.description.trim(); break;
                }
            }
        } else if (typeof data.description === "string") {
            description = data.description.trim();
        }
        description = description.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

        const tags = [];
        if (Array.isArray(data.tags)) {
            for (let i = 0; i < data.tags.length; i++) {
                const t = data.tags[i];
                if (!t) continue;
                const name = typeof t === "string" ? t : t.name;
                if (name) tags.push(String(name).trim());
            }
        }

        return { description: description, tags: tags };
    } catch (err) {
        console.log("extractDetails error: " + err);
        return { description: "", tags: [] };
    }
}

/* ------------------------------------------------------------------ */
/* extractChapters                                                     */
/* ------------------------------------------------------------------ */

async function extractChapters(url) {
    try {
        const titleId = objectId(url);
        if (!titleId) return { en: [] };

        /* 1. pull every upload, all languages */
        const raw = [];
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages && page <= MAX_CHAPTER_PAGES) {
            const listUrl = API + "/title/chapter-listing"
                + "?title_id=" + titleId
                + "&page=" + page
                + "&limit=" + CHAPTER_LIMIT
                + "&sort_order=desc&language=&search=&user_id=";

            const response = await soraFetch(listUrl, { method: "GET" });
            if (!response) break;

            const json = await response.json();
            const data = json && Array.isArray(json.data) ? json.data : [];
            for (let i = 0; i < data.length; i++) raw.push(data[i]);

            if (json && json.pagination && json.pagination.total_pages) {
                totalPages = parseInt(json.pagination.total_pages, 10) || 1;
            }
            if (data.length === 0) break;
            page++;
        }

        if (raw.length === 0) return { en: [] };

        /* 2. bucket by language, then by chapter number */
        const byLang = {};

        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            if (!c) continue;
            const id = c.id || c._id;
            if (!id) continue;
            if (c.status && String(c.status) !== "published") continue;

            const numRaw = (c.chapter_number !== undefined && c.chapter_number !== null)
                ? c.chapter_number : c.number;
            const numVal = parseFloat(numRaw);
            if (isNaN(numVal)) continue;
            const numKey = String(numRaw);

            const lang = String(c.lang || "en").toLowerCase();
            const groupName = c.group_name || (c.group ? c.group.name : "");
            const rawName = c.name || "";

            const entry = {
                chapterId: String(id),
                number: numKey,
                numeric: numVal,
                lang: lang,
                site: String(c.site || "").toLowerCase(),
                rawName: rawName,
                realTitle: realChapterTitle(rawName, numKey, groupName),
                views: c.views_count || c.views || 0
            };

            if (!byLang[lang]) byLang[lang] = {};
            if (!byLang[lang][numKey]) byLang[lang][numKey] = [];
            byLang[lang][numKey].push(entry);
        }

        /* 3. rank each chapter's uploads, best scan first */
        const out = {};
        const langs = [];
        for (const l in byLang) { if (byLang.hasOwnProperty(l)) langs.push(l); }
        /* English first so the reader opens on it */
        langs.sort(function (a, b) {
            if (a === "en") return -1;
            if (b === "en") return 1;
            return a < b ? -1 : (a > b ? 1 : 0);
        });

        for (let li = 0; li < langs.length; li++) {
            const lang = langs[li];
            const buckets = byLang[lang];
            const chapterList = [];

            for (const numKey in buckets) {
                if (!buckets.hasOwnProperty(numKey)) continue;
                const entries = buckets[numKey];

                entries.sort(function (a, b) { return qualityScore(b) - qualityScore(a); });

                /* one real title for the whole chapter, taken from the best
                 * upload that actually has one */
                let chapterTitle = "";
                for (let k = 0; k < entries.length; k++) {
                    if (entries[k].realTitle) { chapterTitle = entries[k].realTitle; break; }
                }

                const label = displayTitle(numKey, chapterTitle);
                const variants = [];
                for (let k = 0; k < entries.length; k++) {
                    const e = entries[k];
                    variants.push({
                        id: SITE + "/chapter-detail/" + e.chapterId + "?chapter=" + e.number,
                        title: label,
                        chapter: e.numeric,
                        scanlation_group: siteLabel(e.site)
                    });
                }

                chapterList.push([numKey, variants]);
            }

            chapterList.sort(function (a, b) { return parseFloat(a[0]) - parseFloat(b[0]); });
            out[lang] = chapterList;
        }

        return out;
    } catch (err) {
        console.log("extractChapters error: " + err);
        return { en: [] };
    }
}

/* ------------------------------------------------------------------ */
/* extractImages                                                       */
/* ------------------------------------------------------------------ */

function collectPages(json) {
    const out = [];
    if (!json) return out;

    const candidates = [];
    const data = json.data || json;
    if (data) {
        if (data.chapter && Array.isArray(data.chapter.pages)) candidates.push(data.chapter.pages);
        if (Array.isArray(data.pages)) candidates.push(data.pages);
        if (Array.isArray(data.images)) candidates.push(data.images);
        if (data.chapter && Array.isArray(data.chapter.images)) candidates.push(data.chapter.images);
    }
    if (Array.isArray(json.pages)) candidates.push(json.pages);
    if (Array.isArray(json.images)) candidates.push(json.images);

    for (let i = 0; i < candidates.length; i++) {
        const arr = candidates[i];
        if (arr && arr.length > 0) {
            for (let j = 0; j < arr.length; j++) {
                const p = arr[j];
                const u = (typeof p === "string") ? p : (p && (p.url || p.src || p.image));
                if (u) out.push(httpsify(u));
            }
            if (out.length > 0) return out;
        }
    }
    return out;
}

async function extractImages(url) {
    try {
        const chapterId = objectId(url);
        if (!chapterId) return [];

        let chapterNum = "";
        const nm = /[?&]chapter=([^&]+)/.exec(String(url));
        if (nm) chapterNum = nm[1];

        const endpoints = [
            API + "/chapter-detail?chapter_id=" + chapterId
                + "&user_id=demo_user" + (chapterNum ? "&chapter=" + chapterNum : ""),
            API + "/chapter/detail?chapter_id=" + chapterId
        ];

        for (let i = 0; i < endpoints.length; i++) {
            const response = await soraFetch(endpoints[i], { method: "GET" });
            if (!response) continue;
            let json = null;
            try { json = await response.json(); } catch (e) { json = null; }
            const pages = collectPages(json);
            if (pages.length > 0) {
                console.log("extractImages count: " + pages.length);
                return pages;
            }
        }

        /* last resort: the server-rendered reader page */
        const htmlResponse = await soraFetch(httpsify(url), {
            method: "GET",
            headers: { "Accept": "text/html,application/xhtml+xml" }
        });
        if (!htmlResponse) return [];
        const html = await htmlResponse.text();

        const found = [];
        const seen = {};
        const re = /https?:\/\/[^"'\s]+\/storage\/[^"'\s]+?-\d{3,4}\.(?:webp|jpg|jpeg|png)/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            const u = httpsify(m[0]);
            if (!seen[u]) { seen[u] = true; found.push(u); }
        }

        /* the reader lazy-loads past page ~6, so rebuild the rest from the
         * first URL's pattern once we know the total page count */
        if (found.length > 0) {
            let total = found.length;
            const tm = /(?:\/\s*)(\d{1,4})\s*(?:pages|页)/i.exec(html) || /1\s*\/\s*(\d{1,4})/.exec(html);
            if (tm) {
                const t = parseInt(tm[1], 10);
                if (!isNaN(t) && t > total && t < 1000) total = t;
            }
            const pm = /^(.*-)(\d{3,4})(\.(?:webp|jpg|jpeg|png))$/i.exec(found[0]);
            if (pm && total > found.length) {
                const pad = pm[2].length;
                const rebuilt = [];
                for (let n = 1; n <= total; n++) {
                    let s = String(n);
                    while (s.length < pad) s = "0" + s;
                    rebuilt.push(pm[1] + s + pm[3]);
                }
                console.log("extractImages count: " + rebuilt.length);
                return rebuilt;
            }
        }

        console.log("extractImages count: " + found.length);
        return found;
    } catch (err) {
        console.log("extractImages error: " + err);
        return [];
    }
}
