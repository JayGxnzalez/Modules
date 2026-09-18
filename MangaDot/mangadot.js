async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    const headers = options.headers || {};
    try {
        return await fetchv2(url, headers, options.method || 'GET', options.body || null);
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}

function toAbsolute(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("http://") === 0) return "https://" + u.substring(7);
    if (u.indexOf("https://") === 0) return u;
    return "https://mangadot.net" + (u.indexOf("/") === 0 ? "" : "/") + u;
}

function extractMangaId(url) {
    const match = /\/manga\/(\d+)/.exec(String(url));
    return match ? match[1] : null;
}

function extractChapterId(url) {
    const match = /\/chapter\/(\d+)/.exec(String(url));
    return match ? match[1] : null;
}

/* mangadot's /*.data routes return React Router turbo-stream: a single JSON
 * array acting as a flat, deduped reference graph. Element 0 is the root;
 * objects use "_<idx>" keys whose key AND value are indices into the array;
 * arrays hold indices; negative numbers are null; anything else is a literal.
 * Cache is seeded before recursing so shared/cyclic refs are safe. Pure JS —
 * no setTimeout / crypto.subtle / new URL, so it is JavaScriptCore-safe. */
function decodeTurbo(arr) {
    const cache = new Array(arr.length);
    function res(idx) {
        if (typeof idx !== "number") return idx;
        if (idx < 0) return null;
        if (idx in cache) return cache[idx];
        const v = arr[idx];
        if (v === null || typeof v !== "object") { cache[idx] = v; return v; }
        if (Array.isArray(v)) {
            const out = [];
            cache[idx] = out;
            for (let j = 0; j < v.length; j++) out.push(res(v[j]));
            return out;
        }
        const keys = Object.keys(v);
        const turbo = keys.length > 0 && keys[0].charAt(0) === "_";
        const out = {};
        cache[idx] = out;
        for (let k = 0; k < keys.length; k++) {
            const rk = keys[k];
            if (turbo) out[res(parseInt(rk.slice(1), 10))] = res(v[rk]);
            else out[rk] = v[rk];
        }
        return out;
    }
    return res(0);
}

function routeData(root, routeId) {
    const node = root && root[routeId];
    return node && node.data ? node.data : null;
}

/* Chapter titles on mangadot are per-upload and inconsistent: most groups
 * store a generic "Chapter N", while others carry the real name — often
 * buried under "Chapter N - Volume M (Group) {f}" scaffolding. Strip the
 * scaffolding, then keep whatever real title remains. */
function cleanChapterTitle(t) {
    if (!t) return "";
    t = String(t).trim();
    // drop up to two trailing (group)/{flag}/[tag] blocks
    t = t.replace(/\s*[\(\{\[][^)\}\]]*[\)\}\]]\s*$/, "").trim();
    t = t.replace(/\s*[\(\{\[][^)\}\]]*[\)\}\]]\s*$/, "").trim();
    // drop leading "Chapter N", optional "- Volume M", and any separator
    t = t.replace(/^chapter\s*[0-9]+(?:\.[0-9]+)?\s*(?:-\s*volume\s*[0-9]+)?\s*[-:]?\s*/i, "").trim();
    return t;
}

/* Is a cleaned title an actual name (vs. a number / junk watermark)? */
function isRealTitle(t) {
    if (!t) return false;
    if (/^(?:chapter|ch\.?|episode|ep\.?|vol(?:ume)?)?\s*[0-9]+(?:\.[0-9]+)?$/i.test(t)) return false;
    if (!/[a-z]/i.test(t)) return false;              // needs letters
    if (!/\s/.test(t) && /[0-9]/.test(t)) return false; // single digit-laced token, e.g. "1r0n"
    return true;
}

/* higher = more descriptive; generic/junk scores 0 */
function titleScore(t) {
    if (!isRealTitle(t)) return 0;
    const words = t.split(/\s+/).filter(function (w) { return /[a-z]/i.test(w); });
    return words.length * 100 + t.replace(/[^a-z]/gi, "").length;
}

/* pick the best real title across a chapter's group uploads, ignoring any
 * candidate that is really just a scanlation-group name (some uploaders drop
 * the bare group name, e.g. "DigitalMangaFan", into the title field) */
function bestChapterTitle(entries, num, groupNames) {
    let best = "", bestScore = 0;
    for (let i = 0; i < entries.length; i++) {
        const c = cleanChapterTitle(entries[i]._rawTitle);
        if (groupNames && groupNames[c.toLowerCase()]) continue; // group name, not a title
        const s = titleScore(c);
        if (s > bestScore) { bestScore = s; best = c; }
    }
    return bestScore > 0 ? best : ("Chapter " + num);
}

async function searchResults(keyword, page = 1) {
    const results = [];
    try {
        const url = "https://mangadot.net/search.data?search=" + encodeURIComponent(keyword);
        const response = await soraFetch(url);
        if (!response) return results;

        const root = decodeTurbo(JSON.parse(await response.text()));
        const data = routeData(root, "pages/SearchPage");
        const list = data && data.payload && Array.isArray(data.payload.manga_list)
            ? data.payload.manga_list : [];

        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            if (!m || m.id == null) continue;
            results.push({
                id: "https://mangadot.net/manga/" + m.id,
                imageURL: toAbsolute(m.photo),
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
        const id = extractMangaId(url);
        if (!id) return { description: "Error", tags: [] };

        const response = await soraFetch("https://mangadot.net/manga/" + id + ".data");
        if (!response) return { description: "Error", tags: [] };

        const root = decodeTurbo(JSON.parse(await response.text()));
        const data = routeData(root, "pages/MangaDetailPage");
        const m = (data && data.mangaData && data.mangaData.manga) ? data.mangaData.manga : {};

        const description = String(m.description || "").trim();
        const tags = Array.isArray(m.genres) ? m.genres.map(function (g) { return String(g).trim(); }) : [];

        return { description: description, tags: tags };
    } catch (err) {
        return { description: "Error", tags: [] };
    }
}

async function extractChapters(url) {
    try {
        const id = extractMangaId(url);
        if (!id) return { en: [] };

        const response = await soraFetch("https://mangadot.net/api/manga/" + id + "/chapters/list?lang=en");
        if (!response) return { en: [] };

        const list = JSON.parse(await response.text());
        if (!Array.isArray(list)) return { en: [] };

        // collect every group/scanlator name so we can keep them out of titles
        const groupNames = {};
        for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (!c) continue;
            if (c.group_name) groupNames[String(c.group_name).toLowerCase().trim()] = 1;
            if (c.scanlator_name) groupNames[String(c.scanlator_name).toLowerCase().trim()] = 1;
        }

        // group every scanlator upload under its chapter number
        const groups = {};      // number -> entries[]
        const order = [];       // number, first-seen order
        for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (!c || c.id == null) continue;
            const num = parseFloat(c.chapter_number);
            if (isNaN(num)) continue;
            if (!groups[num]) { groups[num] = []; order.push(num); }
            groups[num].push({
                id: "https://mangadot.net/chapter/" + c.id,
                chapter: num,
                scanlation_group: String(c.group_name || c.scanlator_name || ""),
                _rawTitle: c.chapter_title,
                _date: String(c.date_added || "")
            });
        }

        order.sort(function (a, b) { return b - a; }); // newest chapter first
        const results = [];
        for (let i = 0; i < order.length; i++) {
            const num = order[i];
            const entries = groups[num];
            // one canonical title per chapter, taken from the best-named upload
            const title = bestChapterTitle(entries, num, groupNames);
            entries.sort(function (a, b) { return a._date > b._date ? -1 : (a._date < b._date ? 1 : 0); });
            for (let j = 0; j < entries.length; j++) {
                entries[j].title = title;
                delete entries[j]._date;
                delete entries[j]._rawTitle;
            }
            results.push([String(num), entries]);
        }

        return { en: results };
    } catch (err) {
        return { en: [] };
    }
}

async function extractImages(url) {
    const results = [];
    try {
        const chId = extractChapterId(url);
        if (!chId) return results;

        const response = await soraFetch("https://mangadot.net/api/uploads/" + chId + "/images");
        if (!response) return results;

        const json = JSON.parse(await response.text());
        const imgs = json && Array.isArray(json.images) ? json.images : [];
        for (let i = 0; i < imgs.length; i++) {
            const u = imgs[i] && imgs[i].url;
            if (u) results.push(toAbsolute(u));
        }
        return results;
    } catch (err) {
        return results;
    }
}
