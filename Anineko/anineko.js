// AniNeko SUB + DUB Module
// Scrapes anineko.to — parses embed URLs directly from page HTML
// HD-1: vivibebe.site — HD-2: morning-credit-3bcc.vibevibe.workers.dev

// ==========================================
// SORA FETCH WRAPPER
// ==========================================

async function soraFetch(url, options) {
    options = options || { headers: {}, method: 'GET', body: null };
    try {
        if (typeof fetchv2 !== 'undefined') {
            return await fetchv2(url, options.headers || {}, options.method || 'GET', options.body || null, true, options.encoding || 'utf-8');
        } else {
            return await fetch(url, options);
        }
    } catch(e) {
        try { return await fetch(url, options); } catch(err) { return null; }
    }
}

async function getText(res) {
    if (!res) return '';
    try {
        return typeof res.text === 'function' ? await res.text() : (res.body || '');
    } catch(e) { return ''; }
}

// ==========================================
// URL BUILDERS
// ==========================================

function buildHD1Url(videoId) {
    return 'https://vivibebe.site/public/stream/' + videoId + '/master.m3u8';
}

function buildHD2Url(bibiembId) {
    return 'https://morning-credit-3bcc.vibevibe.workers.dev/' + bibiembId + '/master.m3u8';
}

function normalizeVtt(raw) {
    if (!raw) return '';
    var decoded = decodeURIComponent(raw);
    if (decoded.indexOf('http') === 0) return decoded;
    return 'https://cdn.anizara.store/' + decoded;
}

// ==========================================
// MODULE FUNCTIONS
// ==========================================

async function searchResults(keyword) {
    try {
        var url = 'https://anineko.to/browser?keyword=' + encodeURIComponent(keyword);
        var res = await soraFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        var html = await getText(res);

        var results = [];
        var cardRe = /<article class="nv-anime-card[^"]*">[\s\S]*?href="\/watch\/([^"]+)"[\s\S]*?<img src="([^"]+)"[\s\S]*?<h3 class="nv-anime-title"><a[^>]*>([^<]+)<\/a>/g;
        var m;
        while ((m = cardRe.exec(html)) !== null) {
            results.push({ title: m[3], image: m[2], href: 'https://anineko.to/watch/' + m[1] });
        }

        return JSON.stringify(results);
    } catch(e) {
        console.log('[AniNeko] searchResults error: ' + e.message);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        var res = await soraFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        var html = await getText(res);

        var descMatch = html.match(/<p class="nv-desc">([^<]+)<\/p>/);
        var desc = descMatch
            ? descMatch[1]
                .replace(/&#039;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
            : 'No description available.';

        return JSON.stringify([{ description: desc, aliases: '', airdate: '' }]);
    } catch(e) {
        console.log('[AniNeko] extractDetails error: ' + e.message);
        return JSON.stringify([{ description: 'No description available.', aliases: '', airdate: '' }]);
    }
}

async function extractEpisodes(url) {
    try {
        var res = await soraFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        var html = await getText(res);

        var slugMatch = url.match(/\/watch\/([^/]+)/);
        var slug = slugMatch ? slugMatch[1] : '';

        var episodes = [];
        var epRe = /href="\/watch\/[^/]+\/(ep-(\d+))"/g;
        var seen = {};
        var m;
        while ((m = epRe.exec(html)) !== null) {
            var n = parseInt(m[2]);
            if (!seen[n]) {
                seen[n] = true;
                episodes.push({ href: 'https://anineko.to/watch/' + slug + '/' + m[1], number: n });
            }
        }
        episodes.sort(function(a, b) { return a.number - b.number; });

        return JSON.stringify(episodes);
    } catch(e) {
        console.log('[AniNeko] extractEpisodes error: ' + e.message);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        console.log('[AniNeko v1.0.5] fetchEp: ' + url);

        var res = await soraFetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://anineko.to/' }
        });
        var html = await getText(res);

        // Split HTML by lang-group panel opening tags to get panel content slices
        var panelOpenRe = /<div[^>]*class="[^"]*lang-group[^"]*"[^>]*data-id="(sub|dub|hsub)">/g;
        var positions = [];
        var pm;
        while ((pm = panelOpenRe.exec(html)) !== null) {
            positions.push({ type: pm[1], start: pm.index + pm[0].length });
        }

        var serversByType = {};
        for (var i = 0; i < positions.length; i++) {
            var end = i + 1 < positions.length ? positions[i + 1].start : html.length;
            var content = html.substring(positions[i].start, end);
            var panelType = positions[i].type;

            var vv = content.match(/data-video="https:\/\/vivibebe\.site\/([^?"]+)(?:\?sub=([^"]+))?"/);
            var bb = content.match(/data-video="https:\/\/bibiemb\.xyz\/(ag[^?"]+)(?:\?sub(?:_e)?=([^"&]+))?/);

            serversByType[panelType] = {
                hd1: vv ? { streamUrl: buildHD1Url(vv[1]), subVtt: normalizeVtt(vv[2] || '') } : null,
                hd2: bb ? { streamUrl: buildHD2Url(bb[1]), subVtt: normalizeVtt(bb[2] || '') } : null
            };
        }

        console.log('[AniNeko v1.0.5] panels: ' + Object.keys(serversByType).join(','));

        var streams = [];
        var subtitles = '';
        var allSubtitles = [];

        var order = ['sub', 'dub', 'hsub'];
        for (var i = 0; i < order.length; i++) {
            var type = order[i];
            var panel = serversByType[type];
            if (!panel) continue;
            var typeLabel = type === 'sub' ? 'SUB' : (type === 'dub' ? 'DUB' : 'HSUB');

            if (panel.hd1) {
                console.log('[AniNeko v1.0.5] ' + typeLabel + ' HD-1: ' + panel.hd1.streamUrl);
                streams.push({
                    title: typeLabel + ' - HD 1',
                    streamUrl: panel.hd1.streamUrl,
                    headers: { 'Referer': 'https://anineko.to/', 'Origin': 'https://anineko.to' }
                });
                if (panel.hd1.subVtt && !subtitles) {
                    subtitles = panel.hd1.subVtt;
                    allSubtitles.push({ file: panel.hd1.subVtt, label: 'English', kind: 'captions' });
                }
            }

            if (panel.hd2) {
                console.log('[AniNeko v1.0.5] ' + typeLabel + ' HD-2: ' + panel.hd2.streamUrl);
                streams.push({
                    title: typeLabel + ' - HD 2',
                    streamUrl: panel.hd2.streamUrl,
                    headers: { 'Referer': 'https://anineko.to/', 'Origin': 'https://anineko.to' }
                });
                if (panel.hd2.subVtt && !subtitles) {
                    subtitles = panel.hd2.subVtt;
                    allSubtitles.push({ file: panel.hd2.subVtt, label: 'English', kind: 'captions' });
                }
            }
        }

        if (streams.length === 0) {
            console.log('[AniNeko v1.0.5] No streams found for: ' + url);
        }

        return JSON.stringify({
            streams: streams,
            subtitles: subtitles,
            subtitlesHeaders: {},
            allSubtitles: allSubtitles
        });

    } catch(e) {
        console.log('[AniNeko v1.0.5] error: ' + e.message);
        return JSON.stringify({ streams: [], subtitles: '', subtitlesHeaders: {}, allSubtitles: [] });
    }
}
