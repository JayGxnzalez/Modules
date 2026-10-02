// KickAssAnime (kaa.lt) — Shirox module
// Flow: fsearch -> show/{slug}/episodes (per lang) -> watch page servers[].src
//       -> krussdomi cat-player props -> master.m3u8 (HLS) + VTT subtitle pool
//
// Notes on what is CONFIRMED vs INFERRED (from your Proxyman captures):
//  - CONFIRMED responses: /api/fsearch, /api/show/{slug}/episodes, /api/show/{slug}/language,
//    the watch page window.KAA.servers[].src, and the krussdomi cat-player props blob.
//  - INFERRED (flagged inline): the /api/fsearch REQUEST method/body (POST JSON {query}),
//    the /api/show/{slug} detail endpoint, and that episodes?lang= yields per-language slugs
//    (strongly implied by f897b3 vs aa83b7 for the same episode).
// Each inferred piece degrades gracefully — if one language fails to resolve, the others still play.

const BASE_URL = 'https://kaa.lt';
const KRUSS_HLS = 'https://hls.krussdomi.com';
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0';

// Human labels for the audio-track picker. Unknown codes fall back to the raw code.
const LANG_LABELS = {
    'ja-JP': 'SUB',
    'en-US': 'DUB',
    'es-419': 'DUB (LatAm)',
    'es-ES': 'DUB (ES)'
};
function langLabel(code) {
    return LANG_LABELS[code] || code;
}

function log(msg) {
    try { console.log('[KAA] ' + msg); } catch (_) {}
}

async function parseResponseJson(res) {
    if (!res) return null;
    try {
        if (typeof res.text === 'function') {
            const txt = await res.text();
            if (txt && typeof txt === 'string') return JSON.parse(txt);
        }
    } catch (_) {}
    try {
        if (typeof res.json === 'function') return await res.json();
    } catch (_) {}
    return null;
}

async function soraFetch(url, options = {}) {
    const opts = options || {};
    const headers = opts.headers || {};
    if (!headers['User-Agent']) headers['User-Agent'] = FIREFOX_UA;
    if (!headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
    const imp = opts.impersonate !== undefined ? opts.impersonate : false;
    try {
        return await fetchv2(url, headers, opts.method || 'GET', opts.body || null, imp ? { impersonate: imp } : {});
    } catch (e) {
        try {
            return await fetchv2(url, { method: opts.method || 'GET', headers: headers, body: opts.body || null, impersonate: imp });
        } catch (e2) {
            try {
                return await fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body || null, impersonate: imp });
            } catch (error) {
                return null;
            }
        }
    }
}

// kaa.lt image CDN: window.KAA.posterEndpoint = "/image/poster"
function posterUrl(poster) {
    if (!poster || !poster.hq) return '';
    return `${BASE_URL}/image/poster/${poster.hq}.webp`;
}

function showSlugFromUrl(url) {
    if (!url) return null;
    const m = String(url).match(/\/show\/([^/?#]+)/);
    return m ? m[1] : null;
}

// -----------------------------------------------------------------------------
// SEARCH
// -----------------------------------------------------------------------------
async function searchResults(keyword) {
    try {
        // INFERRED REQUEST: /api/fsearch is POST JSON {query}. Response shape {result[],maxPage}
        // is confirmed from your capture. If search returns empty, this body is the thing to change.
        const url = `${BASE_URL}/api/fsearch`;
        const response = await soraFetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Referer': `${BASE_URL}/`,
                'Origin': BASE_URL,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ query: keyword })
        });
        if (!response) { log('search: no response from /api/fsearch (network/CF?)'); return JSON.stringify([]); }
        const data = await parseResponseJson(response);
        if (!data) { log('search: response not JSON (CF challenge or wrong fsearch body?)'); return JSON.stringify([]); }
        const items = Array.isArray(data.result) ? data.result : [];
        if (!items.length) log('search: 0 results for "' + keyword + '" (check fsearch request body)');

        const results = items
            .filter(it => it && it.slug)
            .map(it => ({
                title: it.title_en || it.title || 'Unknown',
                image: posterUrl(it.poster),
                href: `${BASE_URL}/show/${it.slug}`
            }));

        return JSON.stringify(results);
    } catch (e) {
        log('search: exception ' + (e && e.message ? e.message : e));
        return JSON.stringify([]);
    }
}

// -----------------------------------------------------------------------------
// DETAILS
// -----------------------------------------------------------------------------
async function extractDetails(url) {
    try {
        const slug = showSlugFromUrl(url);
        if (!slug) return JSON.stringify([{ description: '', aliases: '', airdate: '' }]);

        // INFERRED ENDPOINT: /api/show/{slug} (standard REST). Non-blocking — empty on miss.
        const apiUrl = `${BASE_URL}/api/show/${slug}`;
        const response = await soraFetch(apiUrl, {
            headers: { 'Accept': 'application/json', 'Referer': `${BASE_URL}/` }
        });
        const data = await parseResponseJson(response);
        if (!data) return JSON.stringify([{ description: '', aliases: '', airdate: '' }]);

        const description = data.synopsis || '';

        const aliasSet = new Set();
        if (data.title && data.title_en && data.title !== data.title_en) aliasSet.add(data.title);
        if (data.title_en && data.title && data.title_en !== data.title) aliasSet.add(data.title_en);
        const aliases = Array.from(aliasSet).join(', ');

        const airdate = data.year ? String(data.year) : '';

        return JSON.stringify([{ description, aliases, airdate }]);
    } catch (e) {
        return JSON.stringify([{ description: '', aliases: '', airdate: '' }]);
    }
}

// -----------------------------------------------------------------------------
// EPISODES
// -----------------------------------------------------------------------------
async function pickListingLang(slug) {
    try {
        const res = await soraFetch(`${BASE_URL}/api/show/${slug}/language`, {
            headers: { 'Accept': 'application/json', 'Referer': `${BASE_URL}/` }
        });
        const data = await parseResponseJson(res);
        const langs = (data && Array.isArray(data.result)) ? data.result : [];
        if (langs.indexOf('ja-JP') !== -1) return { langs, listing: 'ja-JP' };   // subs are usually the most complete
        return { langs, listing: langs[0] || 'en-US' };
    } catch (e) {
        return { langs: ['ja-JP', 'en-US'], listing: 'ja-JP' };
    }
}

async function fetchEpisodePage(slug, lang, epAnchor) {
    const url = `${BASE_URL}/api/show/${slug}/episodes?ep=${epAnchor}&lang=${encodeURIComponent(lang)}`;
    const res = await soraFetch(url, { headers: { 'Accept': 'application/json', 'Referer': `${BASE_URL}/` } });
    return await parseResponseJson(res);
}

async function extractEpisodes(url) {
    try {
        const slug = showSlugFromUrl(url);
        if (!slug) return JSON.stringify([]);

        const { listing } = await pickListingLang(slug);

        const first = await fetchEpisodePage(slug, listing, 1);
        if (!first) { log('episodes: no response for ' + slug + ' (lang ' + listing + ')'); return JSON.stringify([]); }

        const byNum = new Map();
        function absorb(data) {
            if (!data || !Array.isArray(data.result)) return;
            for (const ep of data.result) {
                if (!ep) continue;
                const n = (typeof ep.episode_number === 'number')
                    ? ep.episode_number
                    : parseFloat(ep.episode_string || ep.episode_number);
                if (isNaN(n)) continue;
                if (!byNum.has(n)) byNum.set(n, true);
            }
        }
        absorb(first);

        // Paginate: the response lists every page range; pull each page we don't already have.
        const pages = Array.isArray(first.pages) ? first.pages : [];
        const current = first.current_page || 1;
        const extra = [];
        for (const p of pages) {
            if (!p || p.number === current) continue;
            const anchor = parseInt(p.from, 10);
            if (isNaN(anchor)) continue;
            extra.push(fetchEpisodePage(slug, listing, anchor));
        }
        if (extra.length) {
            const more = await Promise.all(extra);
            more.forEach(absorb);
        }

        const episodes = Array.from(byNum.keys())
            .sort((a, b) => a - b)
            .map(n => ({ number: n, href: `${BASE_URL}/watch/${slug}/${n}` }));

        return JSON.stringify(episodes);
    } catch (e) {
        return JSON.stringify([]);
    }
}

// -----------------------------------------------------------------------------
// STREAM
// -----------------------------------------------------------------------------
function htmlUnescape(s) {
    return String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#x2F;/g, '/')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

// Pull every krussdomi cat-player URL out of the watch page's window.KAA.servers[].src
function extractServerSrcs(html) {
    const out = [];
    const re = /"src"\s*:\s*"([^"]*(?:krussdomi|cat-player)[^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        out.push(htmlUnescape(m[1]));
    }
    return out;
}

// Parse the krussdomi cat-player astro-island props (devalue-encoded, HTML-escaped).
function parseKrussProps(html) {
    const text = htmlUnescape(html);

    let manifest = null;
    const mm = text.match(/"manifest"\s*:\s*\[\s*0\s*,\s*"([^"]+)"\s*\]/);
    if (mm) manifest = mm[1];
    if (!manifest) {
        const alt = text.match(/https?:\/\/[^"'\\]+master\.m3u8/);
        if (alt) manifest = alt[0];
    }

    const subs = [];
    // Each entry: "language":[0,"xx"],"name":[0,"Name"],"src":[0,"https://...vtt"]
    const subRe = /"language"\s*:\s*\[\s*0\s*,\s*"([^"]*)"\s*\]\s*,\s*"name"\s*:\s*\[\s*0\s*,\s*"([^"]*)"\s*\]\s*,\s*"src"\s*:\s*\[\s*0\s*,\s*"([^"]+)"\s*\]/g;
    let s;
    while ((s = subRe.exec(text)) !== null) {
        const lang = s[1];
        const name = s[2];
        const src = s[3];
        if (!src || /\.vtt/i.test(src) === false) {
            // still accept non-.vtt sub urls, but skip the thumbnails preview track
        }
        subs.push({ lang, name, src });
    }
    return { manifest, subs };
}

async function resolveLang(slug, epNum, lang) {
    try {
        // 1) this language's episode slug for epNum
        const epData = await fetchEpisodePage(slug, lang, epNum);
        if (!epData || !Array.isArray(epData.result)) {
            log(lang + ': episodes endpoint returned no result[] (lang may not exist for this show)');
            return null;
        }
        const ep = epData.result.find(e => {
            const n = (typeof e.episode_number === 'number') ? e.episode_number : parseFloat(e.episode_string);
            return n === epNum;
        });
        if (!ep || !ep.slug) {
            log(lang + ': ep ' + epNum + ' not found in this language');
            return null;
        }

        // 2) watch page -> krussdomi player url(s)
        const watchUrl = `${BASE_URL}/${slug}/ep-${epNum}-${ep.slug}`;
        const watchRes = await soraFetch(watchUrl, { headers: { 'Referer': `${BASE_URL}/` } });
        if (!watchRes) { log(lang + ': watch page no response ' + watchUrl); return null; }
        const watchHtml = await watchRes.text();
        if (!watchHtml) { log(lang + ': watch page empty body'); return null; }

        const srcs = extractServerSrcs(watchHtml);
        if (!srcs.length) {
            log(lang + ': no krussdomi server in watch page (servers[] shape changed?)');
            return null;
        }

        // 3) krussdomi cat-player -> manifest + subs (first resolving server wins per language)
        for (const src of srcs) {
            const playerUrl = src.startsWith('http') ? src : `https:${src}`;
            const pRes = await soraFetch(playerUrl, {
                headers: { 'Referer': `${BASE_URL}/`, 'Accept': 'text/html' }
            });
            if (!pRes) { log(lang + ': cat-player no response'); continue; }
            const pHtml = await pRes.text();
            if (!pHtml) { log(lang + ': cat-player empty body'); continue; }
            const { manifest, subs } = parseKrussProps(pHtml);
            if (manifest) {
                log(lang + ': OK manifest + ' + (subs ? subs.length : 0) + ' subs');
                return { manifest, subs };
            }
            log(lang + ': cat-player had no manifest in props (props shape changed?)');
        }
        return null;
    } catch (e) {
        log(lang + ': exception ' + (e && e.message ? e.message : e));
        return null;
    }
}

async function extractStreamUrl(url) {
    try {
        const m = String(url).match(/\/watch\/([^/]+)\/(\d+(?:\.\d+)?)/);
        if (!m) { log('stream: unparseable href ' + url); return JSON.stringify({ streams: [] }); }
        const slug = m[1];
        const epNum = parseFloat(m[2]);

        const { langs } = await pickListingLang(slug);
        const order = (langs && langs.length) ? langs : ['ja-JP', 'en-US', 'es-419', 'es-ES'];

        const streams = [];
        const allSubs = [];
        const seenSubs = new Set();
        const seenManifests = new Set();

        function addSub(src, label) {
            if (!src || typeof src !== 'string') return;
            if (seenSubs.has(src)) return;
            seenSubs.add(src);
            allSubs.push({ url: src, label: label || 'Subtitle' });
        }

        // Resolve all audio languages in parallel so one slow track doesn't block the rest.
        const resolved = await Promise.all(order.map(lang => resolveLang(slug, epNum, lang)));

        for (let i = 0; i < order.length; i++) {
            const r = resolved[i];
            if (!r || !r.manifest) continue;

            // Audio track -> one stream entry, labelled by language.
            if (!seenManifests.has(r.manifest)) {
                seenManifests.add(r.manifest);
                streams.push({
                    title: langLabel(order[i]),
                    streamUrl: r.manifest,
                    headers: {
                        'Referer': 'https://krussdomi.com/',
                        'Origin': 'https://krussdomi.com',
                        'User-Agent': FIREFOX_UA
                    }
                });
            }

            // Pool every subtitle track (deduped by url across all languages).
            if (Array.isArray(r.subs)) {
                for (const sub of r.subs) {
                    addSub(sub.src, sub.name || sub.lang);
                }
            }
        }

        const okLangs = [];
        for (let i = 0; i < order.length; i++) if (resolved[i] && resolved[i].manifest) okLangs.push(order[i]);
        log('ep=' + epNum + ' streams=' + streams.length + ' subs=' + allSubs.length +
            ' langs_ok=[' + okLangs.join(',') + '] of [' + order.join(',') + ']');
        if (!streams.length) {
            log('ep=' + epNum + ' FAILED: 0 playable streams — see per-language lines above for the stage that broke');
        }

        const result = { streams: streams };
        if (allSubs.length) result.allSubtitles = allSubs;
        return JSON.stringify(result);
    } catch (e) {
        return JSON.stringify({ streams: [] });
    }
}
