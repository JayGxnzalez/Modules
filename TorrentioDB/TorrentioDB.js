// ---- USER CONFIG ----
// 1. Configure Torrentio at https://torrentio.strem.fun with YOUR debrid
//    service (Real-Debrid / AllDebrid / Premiumize / TorBox / etc.) + API key.
// 2. Copy the final install URL it gives you — the whole thing, ending in
//    /manifest.json is fine, it's trimmed automatically.
// 3. Paste it between the quotes below.
//
//    e.g. "https://torrentio.strem.fun/providers=...|realdebrid=YOURKEY/manifest.json"
const TORRENTIO_URL = "PASTE_YOUR_TORRENTIO_URL_HERE";

// --- optional knobs (fine to leave as-is) ----------------------------------
const CACHED_ONLY   = false; // true = hide uncached results (debrid must download
                             // those first). false keeps them, tagged "⬇".
const MIN_RES       = 0;     // e.g. 720 to hide anything under 720p. 0 = all.
const MIN_SEEDERS   = 0;     // e.g. 3 to hide near-dead torrents. 0 = all.
const MAX_RESULTS   = 40;    // picker cap.
const SUBS_ENABLED  = true;  // OpenSubtitles for movies/series (anime relies on
                             // the release's own embedded subs).

const CINEMETA = "https://v3-cinemeta.strem.io";
const KITSU     = "https://anime-kitsu.strem.fun";
const STREMIO_OPENSUBTITLES_URL = "https://opensubtitles-v3.strem.io";
const METAHUB_POSTER = "https://images.metahub.space/poster/original/";

// Normalise the pasted URL into a clean base with no trailing /manifest.json
// and no trailing slash, so <base>/stream/... always builds correctly.
function torrentioBase() {
  let u = String(TORRENTIO_URL || "").trim();
  u = u.replace(/\/manifest\.json\s*$/i, "");
  u = u.replace(/\/+$/, "");
  return u;
}
function configured() {
  const u = torrentioBase();
  return u && u.indexOf("PASTE_YOUR_TORRENTIO_URL") === -1 && /^https?:\/\//i.test(u);
}

// ---- helpers ----
async function getJSON(url, headers) {
  const res = await fetchv2(url, headers || {}, "GET", null);
  return await res.json();
}

// Resolution rank + label from Torrentio's name/title strings.
function resInfo(hayRaw) {
  const hay = String(hayRaw || "").toLowerCase();
  const mp = hay.match(/(\d{3,4})p\b/);
  if (mp) { const n = parseInt(mp[1], 10); return { rank: n, label: n >= 2160 ? "4K" : mp[1] + "p" }; }
  if (hay.indexOf("2160") > -1 || hay.indexOf("4k") > -1 || hay.indexOf("uhd") > -1) return { rank: 2160, label: "4K" };
  const mb = hay.match(/\b(2160|1440|1080|720|480|360)\b/);
  if (mb) return { rank: parseInt(mb[1], 10), label: mb[1] + "p" };
  return { rank: 0, label: "" };
}

// Pull size (💾), seeders (👤) and source (⚙️) out of a Torrentio title line.
function sizeToGB(str) {
  const m = String(str || "").match(/💾\s*([\d.]+)\s*(GB|MB)/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  return m[2].toUpperCase() === "MB" ? v / 1024 : v;
}
function seedersOf(str) {
  const m = String(str || "").match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
function sizeLabel(str) {
  const m = String(str || "").match(/💾\s*([\d.]+\s*(?:GB|MB))/i);
  return m ? m[1].replace(/\s+/g, "") : "";
}
function sourceOf(str) {
  const m = String(str || "").match(/⚙️\s*([^\n👤💾🌐]+)/);
  return m ? m[1].trim() : "";
}
// Debrid cache marker: Torrentio prefixes name with "[RD+]" (cached) or
// "[RD download]" (uncached) etc. "+]" => cached and instant.
function cacheInfo(name) {
  const n = String(name || "");
  const m = n.match(/\[([A-Za-z]{2,3})\+?\s*(download|downloading)?\]/);
  if (!m) return { debrid: "", cached: true, tag: "" }; // no debrid prefix: treat as direct
  const svc = m[1].toUpperCase();
  const cached = n.indexOf("+]") > -1 && !/download/i.test(n);
  return { debrid: svc, cached: cached, tag: cached ? "⚡" : "⬇" };
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function formatAirdate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const name = MONTH_NAMES[parseInt(m[2], 10) - 1];
  if (!name) return m[1] + "-" + m[2] + "-" + m[3];
  return name + " " + parseInt(m[3], 10) + ", " + m[1];
}

// ---- subtitles (OpenSubtitles via keyless Stremio addon; xdfkenny's method) ----
// Carried verbatim from the PenguPlay port.
const SUB_LANG_RANK = {
  eng: 0, spa: 1, por: 2, pob: 3, fre: 4, deu: 5, ita: 6,
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
  spl: "Spanish (LatAm)", chi: "Chinese (Simplified)"
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
      lang: lang, url: byLang[lang].url, headers: byLang[lang].headers || {},
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
async function resolveStremioSubtitles(osId, type) {
  if (!SUBS_ENABLED || !osId) return [];
  try {
    const url = STREMIO_OPENSUBTITLES_URL + "/subtitles/" + type + "/" + encodeURIComponent(osId) + ".json";
    const data = await getJSON(url, { "Accept": "application/json", "Referer": "https://app.strem.io/" });
    const list = ((data && data.subtitles) || [])
      .filter(function (it) { return it && it.url; })
      .map(function (it) { return { url: it.url, lang: String(it.lang || "").toLowerCase(), label: subLabel(it) }; });
    console.log("[torrentio] opensubtitles -> " + list.length + " tracks");
    return list;
  } catch (e) {
    console.log("[torrentio] opensubtitles error: " + e);
    return [];
  }
}

// ---- href scheme ----
// search entry href: <metaUrl>#meta=<src>:<type>:<baseId>
//   src  = cm (Cinemeta) | kt (Kitsu)
//   type = movie | series   (metadata / Torrentio route)
//   baseId = tt123 | kitsu:123
// episode href:      <metaUrl>#stream=<route>:<streamId>
//   route    = movie | series   (Torrentio route)
//   streamId = tt123 | tt123:1:5 | kitsu:123 | kitsu:123:5
function metaFrag(href) {
  const i = href.indexOf("#meta=");
  const metaUrl = i > -1 ? href.slice(0, i) : href.split("#")[0];
  const frag = i > -1 ? href.slice(i + 6) : "";
  const c = frag.indexOf(":");
  const src = frag.slice(0, c);
  const rest = frag.slice(c + 1);
  const c2 = rest.indexOf(":");
  const type = rest.slice(0, c2);
  const baseId = rest.slice(c2 + 1);
  return { metaUrl: metaUrl, src: src, type: type, baseId: baseId };
}
function streamFrag(href) {
  const i = href.indexOf("#stream=");
  const frag = i > -1 ? href.slice(i + 8) : "";
  const c = frag.indexOf(":");
  const route = frag.slice(0, c);
  const streamId = frag.slice(c + 1);
  return { route: route, streamId: streamId };
}

// ---- 1. SEARCH ----
async function searchResults(keyword) {
  const q = encodeURIComponent(keyword);
  const out = [];
  try {
    const [mv, sr, an] = await Promise.all([
      getJSON(CINEMETA + "/catalog/movie/top/search=" + q + ".json").catch(function () { return { metas: [] }; }),
      getJSON(CINEMETA + "/catalog/series/top/search=" + q + ".json").catch(function () { return { metas: [] }; }),
      getJSON(KITSU + "/catalog/anime/kitsu-anime-list/search=" + q + ".json").catch(function () { return { metas: [] }; })
    ]);

    const cmEntry = function (it, type) {
      return {
        title: it.name + (it.releaseInfo ? " (" + it.releaseInfo + ")" : ""),
        image: it.poster || "",
        href: CINEMETA + "/meta/" + type + "/" + it.id + ".json#meta=cm:" + type + ":" + it.id
      };
    };
    const ktEntry = function (it) {
      // Kitsu metas carry type movie|series; default to series.
      const type = (it.type === "movie") ? "movie" : "series";
      const yr = it.releaseInfo ? (" (" + String(it.releaseInfo).slice(0, 4) + ")") : "";
      return {
        title: it.name + yr + " — Anime",
        image: it.poster || "",
        href: KITSU + "/meta/" + type + "/" + it.id + ".json#meta=kt:" + type + ":" + it.id
      };
    };

    const mvList = (mv.metas || []).filter(function (it) { return it && it.id; }).map(function (it) { return cmEntry(it, "movie"); });
    const srList = (sr.metas || []).filter(function (it) { return it && it.id; }).map(function (it) { return cmEntry(it, "series"); });
    const anList = (an.metas || []).filter(function (it) { return it && it.id; }).map(ktEntry);

    // Interleave movie / series / anime so the best of each sits near the top
    // instead of burying one category behind another's full list.
    const n = Math.max(mvList.length, srList.length, anList.length);
    for (let i = 0; i < n; i++) {
      if (i < mvList.length) out.push(mvList[i]);
      if (i < srList.length) out.push(srList[i]);
      if (i < anList.length) out.push(anList[i]);
    }
    console.log("[torrentio] search '" + keyword + "' -> movies=" + mvList.length +
                " series=" + srList.length + " anime=" + anList.length + " total=" + out.length);
  } catch (e) {
    console.log("[torrentio] search error: " + e);
  }
  return JSON.stringify(out);
}

// ---- 2. DETAILS ----
async function extractDetails(url) {
  const details = [{ description: "", aliases: "", airdate: "" }];
  try {
    const { metaUrl } = metaFrag(url);
    const data = await getJSON(metaUrl);
    const meta = data.meta || {};
    details[0].description = meta.description || meta.overview || "";
    details[0].aliases = meta.genres ? meta.genres.join(", ") : "";
    details[0].airdate = formatAirdate(meta.released || meta.releaseInfo || "");
  } catch (e) {
    console.log("[torrentio] details error: " + e);
  }
  return JSON.stringify(details);
}

// ---- 3. EPISODES ----
async function extractEpisodes(url) {
  const info = metaFrag(url);
  const eps = [];
  try {
    if (info.type === "movie") {
      // route=movie, streamId=baseId (tt123 or kitsu:123)
      eps.push({ href: info.metaUrl + "#stream=movie:" + info.baseId, number: 1 });
    } else {
      const data = await getJSON(info.metaUrl);
      const meta = data.meta || {};
      const vids = (meta.videos || []).filter(function (v) { return v; });

      if (info.src === "kt") {
        // Kitsu: episode ids are kitsu:ID:EP (no season). Use the episode number.
        vids.forEach(function (v) {
          const ep = (v.episode != null) ? v.episode : v.number;
          if (ep == null) return;
          v._ep = ep;
        });
        vids.filter(function (v) { return v._ep != null; })
            .sort(function (a, b) { return a._ep - b._ep; })
            .forEach(function (v) {
              const streamId = info.baseId + ":" + v._ep;
              eps.push({ href: info.metaUrl + "#stream=series:" + streamId, number: v._ep });
            });
      } else {
        // Cinemeta series: ids are tt123:S:E. number must be per-season episode
        // so Shirox detects season boundaries by the number resetting.
        const real = vids.filter(function (v) { return v.season && v.season > 0; });
        real.sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); });
        real.forEach(function (v) {
          const streamId = info.baseId + ":" + v.season + ":" + v.episode;
          eps.push({ href: info.metaUrl + "#stream=series:" + streamId, number: v.episode });
        });
      }
    }
    console.log("[torrentio] episodes -> " + eps.length);
  } catch (e) {
    console.log("[torrentio] episodes error: " + e);
  }
  return JSON.stringify(eps);
}

// ---- 4. STREAMS ----
async function extractStreamUrl(url) {
  const empty = JSON.stringify({ stream: "", streams: [], subtitle: "", subtitles: [], subtitlesHeaders: {}, allSubtitles: [] });
  if (!configured()) {
    console.log("[torrentio] NO URL SET — paste your Torrentio install URL into TORRENTIO_URL at the top of the module.");
    return empty;
  }

  const { route, streamId } = streamFrag(url);
  const base = torrentioBase();
  const streamURL = base + "/stream/" + route + "/" + streamId + ".json";

  // OpenSubtitles only for IMDb ids (anime/kitsu rely on embedded subs).
  const osId = (streamId.indexOf("tt") === 0) ? streamId : "";
  const osType = route; // movie | series

  const streams = [];
  let skippedUncached = 0, skippedMagnet = 0, belowRes = 0, belowSeed = 0;
  let subtitles = [];

  try {
    const [sData, osSubs] = await Promise.all([
      getJSON(streamURL).catch(function () { return { streams: [] }; }),
      resolveStremioSubtitles(osId, osType).catch(function () { return []; })
    ]);

    (sData.streams || []).forEach(function (s) {
      if (!s) return;
      // Only debrid-resolved http(s) links play. A raw magnet (infoHash, no url)
      // is unplayable in Shirox — means debrid isn't configured in the URL.
      if (!s.url) { if (s.infoHash) skippedMagnet++; return; }

      const hay = (s.name || "") + "\n" + (s.title || "");
      const ri = resInfo(hay);
      if (ri.rank < MIN_RES) { belowRes++; return; }

      const seeders = seedersOf(s.title);
      if (seeders < MIN_SEEDERS) { belowSeed++; return; }

      const cache = cacheInfo(s.name);
      if (CACHED_ONLY && cache.debrid && !cache.cached) { skippedUncached++; return; }

      const sizeL = sizeLabel(s.title);
      const src = sourceOf(s.title);

      // Row: "01. 4K ⚡ • 12.4GB • 👤120 • BluRay [RD]"
      const bits = [];
      if (ri.label) bits.push(ri.label + (cache.tag ? " " + cache.tag : ""));
      else if (cache.tag) bits.push(cache.tag);
      if (sizeL) bits.push(sizeL);
      if (seeders) bits.push("👤" + seeders);
      if (src) bits.push(src);
      let title = bits.join(" • ");
      if (cache.debrid) title += " [" + cache.debrid + "]";
      if (!title) title = s.name || "Torrentio";

      streams.push({
        _rank: ri.rank, _cached: cache.cached ? 1 : 0, _seed: seeders, _size: sizeToGB(s.title),
        title: title, name: title, quality: ri.label || title,
        streamUrl: s.url, url: s.url,
        headers: (s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) || {}
      });
    });

    // Best first: cached > resolution > seeders > size.
    streams.sort(function (a, b) {
      return (b._cached - a._cached) || (b._rank - a._rank) || (b._seed - a._seed) || (b._size - a._size);
    });
    if (streams.length > MAX_RESULTS) streams.length = MAX_RESULTS;

    // Shirox re-sorts the picker LEXICALLY ASCENDING by title, so carry a
    // zero-padded "NN." prefix to reproduce this order on-device.
    const width = Math.max(2, String(streams.length).length);
    streams.forEach(function (s, i) {
      const nn = String(i + 1);
      const pad = nn.length >= width ? nn : new Array(width - nn.length + 1).join("0") + nn;
      s.title = pad + ". " + s.title;
      s.name = s.title;
      delete s._rank; delete s._cached; delete s._seed; delete s._size;
    });

    subtitles = osSubs || [];

    console.log("[torrentio] streams=" + streams.length +
                (skippedMagnet ? " magnet-skipped=" + skippedMagnet + " (debrid not in URL?)" : "") +
                (skippedUncached ? " uncached-hidden=" + skippedUncached : "") +
                (belowRes ? " below-res=" + belowRes : "") +
                (belowSeed ? " below-seed=" + belowSeed : "") +
                " subs=" + subtitles.length + " (" + route + "/" + streamId + ")");
  } catch (e) {
    console.log("[torrentio] stream error: " + e);
  }

  // Subtitles (English-first, one per language).
  const curated = curatedSubtitleEntries(subtitles);
  const subtitlePairs = [];
  curated.forEach(function (t) { subtitlePairs.push(t.label, t.url); });
  const allSubtitles = curated.map(function (t) {
    return { url: t.url, label: t.label, kind: "subtitles", headers: t.headers || {} };
  });
  const english = curated.filter(isEnglishSub);
  const preferred = english.find(function (t) { return !/forced|signs|sdh|hi\b/i.test(String(t.label || "")); }) || english[0] || curated[0];
  const subtitle = (preferred && preferred.url) ? preferred.url : "";

  const primaryStream = streams.length ? (streams[0].streamUrl || streams[0].url) : "";

  return JSON.stringify({
    stream: primaryStream,
    streams: streams,
    subtitle: subtitle,
    subtitles: subtitlePairs.length >= 2 ? subtitlePairs : (subtitle || []),
    subtitlesHeaders: {},
    allSubtitles: allSubtitles
  });
}
