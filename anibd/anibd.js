// ============================================================================
// anibd  (anibd.app)  —  SUB only
// Shirox / Sora / Luna module
//
// Playback chain (confirmed from anibd's own player JS):
//   search3.php ──► postid (+ maybe anilist)
//   single.php?postid=X ──► data.anilist  (only if search doesn't give it)
//   api2.php?epid={anilist} ──► [{ id, server_name, server_data:[{slug,name,link}] }]
//   apilink.php?data={ep.link} ──► [{ server, link }]   (link = play2.php iframe)
//   play2.php embed ──► ArtPlayer config.videoUrl (relative HLS)  [CONFIRMED]
//        embed body: const config = { videoUrl:"/r2/cachehd/{id}/index.m3u8", tracks:[] }
//        → absolutize against play host; SB mirrors under /b2/. Hardsub (tracks empty).
//
// Full chain verified end-to-end (search3 → api2 → apilink → play2 → m3u8).
// ============================================================================

const AB = {
    search:   'https://eng.animeapps.top/api/search3.php',
    single:   'https://eng.animeapps.top/api/single.php?postid=',
    episodes: 'https://epeng.animeapps.top/api2.php?epid=',
    links:    'https://epeng.animeapps.top/apilink.php?data=',
    // play2 host — apilink.php sometimes returns embed links host-relative
    playOrigin: 'https://playeng.animeapps.top',
    // drop servers whose m3u8 is dead (e.g. SB 404) so the picker shows only working streams
    validateStreams: true,
    // sub-only site: server id 10 = "S-sub" in the live page. null = "just take the first".
    subServerId: 10,
};

// These APIs 400 without a site referer — bake it into every request.
const AB_HEADERS = {
    'Referer': 'https://anibd.app/',
    'Origin':  'https://anibd.app',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
};

// ---- fetch wrapper: works on both fetchv2 (Sora/Shirox) and plain fetch ----
async function abFetch(url, headers) {
    const h = Object.assign({}, AB_HEADERS, headers || {});
    try {
        if (typeof fetchv2 !== 'undefined') {
            const r = await fetchv2(url, h, 'GET', null);
            const t = await r.text();
            return t;
        }
        const r = await fetch(url, { headers: h });
        return await r.text();
    } catch (e) {
        console.log('[anibd] fetch fail ' + url + ' :: ' + e);
        return '';
    }
}
function abJson(txt) { try { return JSON.parse(txt); } catch (e) { return null; } }
function enc(o) { return encodeURIComponent(JSON.stringify(o)); }
function dec(s) {
    // href may arrive raw-JSON or url-encoded depending on the app
    try { return JSON.parse(decodeURIComponent(s)); } catch (e) {}
    try { return JSON.parse(s); } catch (e) {}
    return { postid: String(s).replace(/\D/g, '') }; // last-ditch: treat as bare postid
}

// ============================================================================
// 1) SEARCH   [CONFIRMED against search3.php]
// GET search3.php?keyword=<kw>&page=1&limit=20
//   → { status, pagination, data:[ { postid, postname, anilist,
//         ani_cover_large(full AniList URL), anitypes, postyear, ... } ] }
// anilist ships in every row, so episodes need no single.php lookup.
// ============================================================================
async function searchResults(keyword) {
    // app usually passes the raw term; tolerate a full searchBaseUrl too
    let kw = String(keyword || '');
    if (/^https?:\/\//i.test(kw)) {
        const q = kw.match(/[?&](?:keyword|s|q)=([^&]+)/);
        kw = q ? decodeURIComponent(q[1]) : kw;
    }

    const url = AB.search + '?keyword=' + encodeURIComponent(kw) + '&page=1&limit=20';
    const raw = await abFetch(url);
    const j = abJson(raw);
    const rows = (j && Array.isArray(j.data)) ? j.data : [];

    const out = [];
    rows.forEach(function (it) {
        if (!it.postid) return;
        let img = it.ani_cover_large || '';
        if (img && !/^https?:\/\//i.test(img)) img = 'https://rez1.ims1.top/350x/' + img; // proxy only if relative
        out.push({
            title: it.postname || ('#' + it.postid),
            image: img,
            href:  enc({ postid: String(it.postid), anilist: String(it.anilist || '') }),
        });
    });

    console.log('[anibd] search results=' + out.length + ' for "' + kw + '"');
    return JSON.stringify(out);
}

// ============================================================================
// 2) DETAILS
// ============================================================================
async function extractDetails(url) {
    const ref = dec(url);
    const raw = await abFetch(AB.single + ref.postid);
    const j = abJson(raw);
    const d = (j && j.data) ? j.data : {};

    const aliases = [d.english, d.romaji, d.native, d.anisynonyms]
        .filter(Boolean).join(' | ');

    const details = [{
        description: (d.postcontent || 'No description available.').replace(/<[^>]+>/g, '').trim(),
        aliases:     aliases || '',
        airdate:     d.ani_start_date || d.postyear || '',
    }];
    return JSON.stringify(details);
}

// ============================================================================
// 3) EPISODES
// Ensures we have an anilist id (falls back to single.php), then reads api2.php.
// Each episode href carries {anilist, server, slug, link} so streaming needs
// only the apilink.php call — no extra round trips.
// ============================================================================
async function extractEpisodes(url) {
    const ref = dec(url);
    let anilist = ref.anilist;

    if (!anilist || anilist === 'undefined' || anilist === '') {
        const sraw = await abFetch(AB.single + ref.postid);
        const sj = abJson(sraw);
        anilist = (sj && sj.data && sj.data.anilist) ? String(sj.data.anilist) : '';
        console.log('[anibd] resolved anilist=' + anilist + ' from postid=' + ref.postid);
    }
    if (!anilist) { console.log('[anibd] no anilist — cannot list episodes'); return JSON.stringify([]); }

    const raw = await abFetch(AB.episodes + anilist);
    const servers = abJson(raw);
    if (!Array.isArray(servers) || !servers.length) {
        console.log('[anibd] api2 empty for epid=' + anilist);
        return JSON.stringify([]);
    }

    // sub-only: prefer the configured sub server, else the first one
    let sv = servers.find(function (s) { return s.id == AB.subServerId; }) || servers[0];
    const list = (sv.server_data || []).slice(); // api2 is ascending already

    const out = list.map(function (ep) {
        return {
            href: enc({
                anilist: String(anilist),
                postid:  String(ref.postid || ''),
                server:  sv.id,
                slug:    String(ep.slug),
                link:    ep.link,          // playerDataId for apilink.php
            }),
            number: parseInt(String(ep.name).replace(/\D/g, ''), 10) || 0,
        };
    }).filter(function (x) { return x.number > 0; });

    console.log('[anibd] episodes=' + out.length + ' server="' + sv.server_name + '"(' + sv.id + ')');
    return JSON.stringify(out);
}

// ============================================================================
// 4) STREAM
// apilink.php gives the embed list; resolveEmbed() turns each play2.php / playsub.php
// iframe into a playable m3u8 (+ softsub VTT if present). Dead servers (e.g. SB 404)
// are validated out so only working streams reach the picker. Sub-only, no dub filter.
// ============================================================================
async function extractStreamUrl(url) {
    const ref = dec(url);
    let link = ref.link;

    // If we somehow arrived without ep.link (e.g. href built elsewhere), rebuild it.
    if (!link && ref.anilist && ref.slug) {
        const eraw = await abFetch(AB.episodes + ref.anilist);
        const servers = abJson(eraw) || [];
        const sv = servers.find(function (s) { return s.id == (ref.server || AB.subServerId); }) || servers[0];
        const ep = (sv && sv.server_data || []).find(function (e) { return String(e.slug) === String(ref.slug); });
        link = ep ? ep.link : '';
    }
    if (!link) { console.log('[anibd] no ep.link — cannot resolve stream'); return JSON.stringify({ streams: [], subtitles: [] }); }

    const raw = await abFetch(AB.links + encodeURIComponent(link));
    const embeds = abJson(raw);
    if (!Array.isArray(embeds) || !embeds.length) {
        console.log('[anibd] apilink empty for data=' + link);
        return JSON.stringify({ streams: [], subtitles: [] });
    }

    // resolve every embed first (pre-validation)
    const resolvedAll = [];
    for (let i = 0; i < embeds.length; i++) {
        const em = embeds[i];
        const serverTag = em.server || ('Server ' + (i + 1));
        const resolved = await resolveEmbed(em.link, serverTag);
        if (resolved && resolved.streamUrl) resolvedAll.push(resolved);
        else console.log('[anibd] unresolved embed [' + serverTag + '] ' + em.link);
    }

    const streams = [];
    const allSubtitles = [];              // pool contract — deduped across every embed
    const seenSubs = {};
    function poolSubs(list) {
        if (!list) return;
        list.forEach(function (s) {
            if (!s || !s.url || seenSubs[s.url]) return;
            seenSubs[s.url] = 1;
            allSubtitles.push(s);
        });
    }

    // keep only servers whose playlist is actually live (SB currently 404s)
    for (let i = 0; i < resolvedAll.length; i++) {
        const r = resolvedAll[i];
        let live = true;
        if (AB.validateStreams) {
            const body = await abFetch(r.streamUrl, { 'Referer': (r.headers && r.headers.Referer) || AB.playOrigin + '/' });
            live = (typeof body === 'string' && body.indexOf('#EXTM3U') !== -1);
            if (!live) console.log('[anibd] dead stream skipped [' + r.title + '] ' + r.streamUrl);
        }
        if (live) { streams.push(r); poolSubs(r.subtitles); }
    }

    // safety net: never return an empty picker if validation nuked everything
    // (e.g. a transient fetch failure) — fall back to the unvalidated set.
    let finalStreams = streams;
    if (AB.validateStreams && streams.length === 0 && resolvedAll.length > 0) {
        console.log('[anibd] all failed validation — returning unvalidated set');
        finalStreams = resolvedAll;
        resolvedAll.forEach(function (r) { poolSubs(r.subtitles); });
    }

    // if two live mirrors share a label (e.g. both "SUB - 1080p"), tag them by
    // server so the picker isn't two identical rows; unique labels stay clean.
    const counts = {};
    finalStreams.forEach(function (s) { counts[s.title] = (counts[s.title] || 0) + 1; });
    finalStreams.forEach(function (s) {
        if (counts[s.title] > 1 && s.server) s.title = s.title + ' (' + s.server + ')';
        delete s.server;
    });

    console.log('[anibd] streams=' + finalStreams.length + ' subs=' + allSubtitles.length);
    return JSON.stringify({ streams: finalStreams, subtitles: allSubtitles });
}

// ============================================================================
// resolveEmbed   [CONFIRMED against live SR + m3u8 capture]
// play2.php ({r2|b2}/play2.php?id=aniN&url={id}) renders an ArtPlayer config:
//     const config = { videoUrl:"/r2/cachehd/{id}/index.m3u8", tracks:[] }
// The playlist is host-relative on playeng; its segments are absolute on a
// SEPARATE host (ani6.nukitashith.top), .jpg-camouflaged TS, unencrypted, VOD.
// Because segments are cross-origin, the browser sends only the ORIGIN as
// Referer — so that's the header the app must replay for the whole stream.
// ============================================================================
async function resolveEmbed(embedUrl, serverTag) {
    // apilink.php is inconsistent: SB comes back absolute, SR often host-relative
    // ("/r2/play2.php?..."). Pin any relative link to the play host first, so BOTH
    // the page fetch and the relative videoUrl absolutize to a real URL the player
    // accepts (the log showed SR playing back as a bare "/r2/cachehd/...").
    let emAbs = String(embedUrl || '');
    if (/^\/\//.test(emAbs)) emAbs = 'https:' + emAbs;
    else if (/^\//.test(emAbs)) emAbs = AB.playOrigin + emAbs;
    else if (!/^https?:\/\//i.test(emAbs)) emAbs = AB.playOrigin + '/' + emAbs;

    const raw = await abFetch(emAbs, { 'Referer': 'https://anibd.app/' });

    // primary: pull the relative HLS path straight out of the ArtPlayer config
    let m = raw.match(/videoUrl\s*:\s*["']([^"']+)["']/i);
    let path = m ? m[1] : '';

    // fallback: rebuild from the ?url= id if the site ever reshapes the config
    if (!path) {
        const idm = emAbs.match(/[?&]url=([^&]+)/);
        const seg = emAbs.match(/^(https?:\/\/[^\/]+\/[^\/]+)\//); // origin + /r2 or /b2
        if (idm && seg) path = seg[1] + '/cachehd/' + decodeURIComponent(idm[1]) + '/index.m3u8';
    }
    if (!path) { console.log('[anibd] no videoUrl in embed [' + serverTag + ']'); return null; }

    let streamUrl;
    try { streamUrl = new URL(path, emAbs).href; } catch (e) { streamUrl = path; }

    // origin-only Referer — matches the cross-origin segment fetch on ani*.nukitashith.top
    const origin = (function () { try { return new URL(emAbs).origin + '/'; } catch (e) { return AB.playOrigin + '/'; } })();

    // subtitles: ArtPlayer tracks:[{ file|url, label|name|lang, kind, default }].
    // Fields come in ANY order — real softsub embeds list "label" before "file" —
    // so parse each track object on its own instead of a fixed file-then-label seq.
    const subtitles = [];
    const tm = raw.match(/tracks\s*:\s*(\[[\s\S]*?\])/);
    if (tm) {
        const objs = tm[1].match(/\{[^{}]*\}/g) || [];
        objs.forEach(function (o) {
            const fm = o.match(/["']?(?:file|url|src)["']?\s*:\s*["']([^"']+)["']/i);
            if (!fm) return;
            const lm = o.match(/["']?(?:label|name|lang|language|srclang)["']?\s*:\s*["']([^"']+)["']/i);
            let u; try { u = new URL(fm[1], emAbs).href; } catch (e) { u = fm[1]; }
            subtitles.push({ url: u, lang: lm ? lm[1] : 'English' });
        });
    }

    // label: HSUB (burned-in: play2.php/cachehd, no tracks) vs SUB (softsub:
    // playsub.php/cachesub, carries VTT) + quality pulled from the stream id.
    const isSoft = /playsub\.php|cachesub|[?&]sub=/i.test(emAbs) || /cachesub/i.test(streamUrl) || subtitles.length > 0;
    const type = isSoft ? 'SUB' : 'HSUB';
    const qm = streamUrl.match(/(\d{3,4})p/);          // single-rendition playlists — no master/AUTO
    const quality = qm ? (qm[1] + 'p') : '';
    const title = type + (quality ? ' - ' + quality : '');

    console.log('[anibd] resolved [' + title + ' / ' + serverTag + '] ' + streamUrl + ' subs=' + subtitles.length);
    return {
        title: title,
        streamUrl: streamUrl,
        headers: { 'Referer': origin },
        subtitles: subtitles,
        server: serverTag,                              // kept only for de-duping mirror labels
    };
}
