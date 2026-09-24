// PenguPlay -> Shirox source module
// PenguPlay is a Stremio STREAM addon only (resources: stream + subtitles for
// movie/series). It has no catalog/meta for movie/series, so it can't drive
// search on its own. We bridge search + metadata through Cinemeta (Stremio's
// free, no-auth metadata addon), which returns the exact IMDb ids PenguPlay eats.
//
// Flow:
//   searchResults  -> Cinemeta catalog search (movie + series in parallel)
//   extractDetails -> Cinemeta /meta
//   extractEpisodes-> Cinemeta /meta .videos  (movie = single entry)
//   extractStreamUrl-> PenguPlay /stream (+ /subtitles), header-forwarded
//
// JavaScriptCore constraints honored: no setTimeout, no new URL(), no crypto.subtle.
// All four outputs are JSON.stringify'd (Shirox video-module requirement).

// ---- USER CONFIG ----------------------------------------------------------
const AUTH_TOKEN = "SCLz87P2nS1zZo1bUrt_thOZFcq6ERJr5L00glctYmQ";  // required, no streams without it
const SERVER_FILTERS = {};  // PenguPlay-side filters, e.g. { res_360: "unchecked" }
const MIN_RES = 0;          // on-device: e.g. 480 to hide anything below 480p
const BLOCK_SOURCES = [];   // on-device: e.g. ["MovieBox"] to hide a provider

// PenguPlay takes its config as a URL-encoded JSON path segment.
const CONFIG_SEG = AUTH_TOKEN
  ? "/" + encodeURIComponent(JSON.stringify(
      Object.assign({ auth_token: AUTH_TOKEN }, SERVER_FILTERS)))
  : "";

const PP_BASE = "https://pengu.uk";
const CINEMETA = "https://v3-cinemeta.strem.io";

// Subtitles. PenguPlay's own /subtitles endpoint returns an empty array for
// every title tested (movies and series, tokenless), and several VAPlayer
// streams are flagged "No included subtitles" — so OpenSubtitles is the only
// practical subtitle source for this module.
//
// Credits: xdfkenny (https://github.com/xdfkenny) — original author of this
// method: resolving subtitles with no API key or login by querying the keyless
// Stremio OpenSubtitles addon directly, with the Referer the addon expects.
// Ported from the HydraHD module, trimmed to the v3 provider alone: HydraHD
// also runs Stremio Community Subtitles and the rest.opensubtitles.org REST
// path to cover series, but v3 serves series here (verified: 102 tracks for
// tt0903747:1:1), so those fallbacks aren't needed.
const STREMIO_OPENSUBTITLES_URL = "https://opensubtitles-v3.strem.io";
const SUBS_ENABLED = true;   // set false to ship PenguPlay-native subs only

// ---- helpers --------------------------------------------------------------
async function getJSON(url, headers) {
  const res = await fetchv2(url, headers || {}, "GET", null);
  return await res.json();
}

// Resolution rank + label, pulled from PenguPlay's `name`/`filename` strings.
// Parsed generically: VAPlayer returns odd ladders (266p, 144p) that a fixed
// 2160/1080/720/480/360 list would silently drop to rank 0 and mislabel.
function resInfo(s) {
  const hay = ((s.name || "") + " " + ((s.behaviorHints && s.behaviorHints.filename) || "")).toLowerCase();
  if (hay.indexOf("2160") > -1 || hay.indexOf("4k") > -1 || hay.indexOf("uhd") > -1) {
    return { rank: 2160, label: "4K" };
  }
  // Any <digits>p token, e.g. 1080p / 720p / 266p / 144p.
  const mp = hay.match(/(\d{3,4})p/);
  if (mp) return { rank: parseInt(mp[1], 10), label: mp[1] + "p" };
  // Bare height, e.g. "1080 adaptive".
  const mb = hay.match(/\b(2160|1440|1080|720|480|360|240)\b/);
  if (mb) return { rank: parseInt(mb[1], 10), label: mb[1] + "p" };
  return { rank: 0, label: "" };
}

// ISO-639 codes PenguPlay/Stremio use for English tracks.
function isEnglishSub(t) {
  const l = String((t && (t.lang || t.language || t.label)) || "").toLowerCase();
  return l === "en" || l === "eng" || l === "english" || l.indexOf("english") > -1;
}

// Preferred picker order: English first (the app auto-loads the first track),
// then by how common the language is, then alphabetically. Unknown sorts last.
const SUB_LANG_RANK = {
  eng: 0,
  spa: 1, por: 2, pob: 3, fre: 4, deu: 5, ita: 6,
  zho: 7, zht: 8, jpn: 9, kor: 10, rus: 11, ara: 12, tur: 13,
  pol: 14, hin: 15, ind: 16, vie: 17, tha: 18, msa: 19,
  nld: 20, ell: 21, swe: 22, fin: 23, dan: 24, nor: 25,
  hun: 26, cze: 27, ces: 27, bul: 28, hrv: 29, srp: 30, bos: 31,
  ukr: 32, ron: 33, heb: 34, est: 35, lav: 36, lit: 37, slk: 38, slv: 39
};

// Human-readable names; emitting these is what makes the picker show
// "English", "Spanish", ... instead of "Subtitle 1/2/3".
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
  // ISO 639-2/B variants and OpenSubtitles' own codes. These showed up as raw
  // uppercase labels (MAY, PER, TGL, KUR, MAC, SLO, SPL) in real device logs
  // because only the /T spellings were mapped above.
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

// Collapse a subtitle list to ONE entry per language, English first.
// OpenSubtitles returns many duplicate-language tracks (37 for Fight Club,
// 102 for one Breaking Bad episode) — without this the picker is unusable.
// Within a language a clean UTF-8 URL beats a legacy cp1250 one (?senc=),
// which would otherwise render as mojibake.
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
      // Keep any fetch headers — losing them makes the subtitle request 403
      // and the track renders empty.
      byLang[lang] = { url: url, headers: item.headers || null };
    }
  });
  const entries = Object.keys(byLang).map(function (lang) {
    return {
      lang: lang,
      url: byLang[lang].url,
      headers: byLang[lang].headers || {},
      label: subLabel({ lang: lang }),
      rank: Object.prototype.hasOwnProperty.call(SUB_LANG_RANK, lang)
        ? SUB_LANG_RANK[lang] : 999
    };
  });
  entries.sort(function (a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.lang < b.lang ? -1 : (a.lang > b.lang ? 1 : 0);
  });
  return entries;
}

// Query the keyless Stremio OpenSubtitles addon (xdfkenny's method).
// `ppId` is already in the addon's own id form: "tt123" / "tt123:1:2".
async function resolveStremioSubtitles(ppId, type) {
  if (!SUBS_ENABLED) return [];
  try {
    const url = STREMIO_OPENSUBTITLES_URL + "/subtitles/" + type + "/" +
                encodeURIComponent(ppId) + ".json";
    const data = await getJSON(url, {
      "Accept": "application/json",
      "Referer": "https://app.strem.io/"
    });
    const list = ((data && data.subtitles) || [])
      .filter(function (it) { return it && it.url; })
      .map(function (it) {
        return { url: it.url, lang: String(it.lang || "").toLowerCase(), label: subLabel(it) };
      });
    console.log("[penguplay] opensubtitles -> " + list.length + " tracks");
    return list;
  } catch (e) {
    console.log("[penguplay] opensubtitles error: " + e);
    return [];
  }
}

// Pull "type" (movie|series) and the pp id out of the internal href.
// detail href : https://v3-cinemeta.strem.io/meta/<type>/<id>.json
// episode href: ...same... #<ppId>   (ppId = "tt123" for movie, "tt123:S:E" for series)
function parseHref(href) {
  const m = href.match(/\/meta\/(movie|series)\/([^/.#]+)/);
  const type = m ? m[1] : "movie";
  const id = m ? m[2] : "";
  const frag = href.indexOf("#") > -1 ? href.split("#")[1] : "";
  const ppId = frag || id;
  return { type: type, ppId: ppId };
}

// ---- 1. SEARCH ------------------------------------------------------------
async function searchResults(keyword) {
  const q = encodeURIComponent(keyword);
  const urls = [
    CINEMETA + "/catalog/movie/top/search=" + q + ".json",
    CINEMETA + "/catalog/series/top/search=" + q + ".json"
  ];
  const out = [];
  try {
    const [mv, sr] = await Promise.all(urls.map(function (u) {
      return getJSON(u).catch(function () { return { metas: [] }; });
    }));
    const push = function (metas, type) {
      (metas || []).forEach(function (it) {
        if (!it || !it.id) return;
        out.push({
          title: it.name + (it.releaseInfo ? " (" + it.releaseInfo + ")" : ""),
          image: it.poster || "",
          href: CINEMETA + "/meta/" + type + "/" + it.id + ".json"
        });
      });
    };
    push(mv.metas, "movie");
    push(sr.metas, "series");
    console.log("[penguplay] search '" + keyword + "' -> " + out.length + " results");
  } catch (e) {
    console.log("[penguplay] search error: " + e);
  }
  return JSON.stringify(out);
}

// ---- 2. DETAILS -----------------------------------------------------------
async function extractDetails(url) {
  const details = [{ description: "", aliases: "", airdate: "" }];
  try {
    const data = await getJSON(url);
    const meta = data.meta || {};
    details[0].description = meta.description || meta.overview || "";
    details[0].aliases = meta.genres ? meta.genres.join(", ") : "";
    details[0].airdate = meta.released || meta.releaseInfo || "";
  } catch (e) {
    console.log("[penguplay] details error: " + e);
  }
  return JSON.stringify(details);
}

// ---- 3. EPISODES ----------------------------------------------------------
async function extractEpisodes(url) {
  const parsed = parseHref(url);
  const eps = [];
  try {
    if (parsed.type === "movie") {
      eps.push({ href: url + "#" + parsed.ppId, number: 1 });
    } else {
      const data = await getJSON(url);
      const meta = data.meta || {};
      const vids = (meta.videos || []).filter(function (v) {
        return v && v.season && v.season > 0; // drop specials (season 0)
      });
      vids.sort(function (a, b) {
        return (a.season - b.season) || (a.episode - b.episode);
      });
      vids.forEach(function (v, i) {
        const ppId = parsed.ppId + ":" + v.season + ":" + v.episode;
        eps.push({ href: url + "#" + ppId, number: i + 1 });
      });
    }
    console.log("[penguplay] episodes -> " + eps.length);
  } catch (e) {
    console.log("[penguplay] episodes error: " + e);
  }
  return JSON.stringify(eps);
}

// ---- 4. STREAMS -----------------------------------------------------------
async function extractStreamUrl(url) {
  const { type, ppId } = parseHref(url);
  const streamURL = PP_BASE + CONFIG_SEG + "/stream/" + type + "/" + ppId + ".json";
  const subsURL = PP_BASE + CONFIG_SEG + "/subtitles/" + type + "/" + ppId + ".json";

  const streams = [];
  const subtitles = [];
  let osList = [];
  let nativeCount = 0;
  let authBlocked = false;

  try {
    // All three in parallel — OpenSubtitles adds no wall-clock time.
    const [sData, subData, osSubs] = await Promise.all([
      getJSON(streamURL).catch(function () { return { streams: [] }; }),
      getJSON(subsURL).catch(function () { return { subtitles: [] }; }),
      resolveStremioSubtitles(ppId, type)
    ]);
    osList = osSubs || [];

    (sData.streams || []).forEach(function (s) {
      if (!s || !s.url) return; // skips the donate entry (externalUrl only)
      // Auth stub: PenguPlay answers an unauthenticated (or over-quota, or
      // revoked) request with ONE entry pointing at signin.mp4 instead of
      // streams — for movies as well as series. Without this guard it would sit
      // in the picker looking like a playable stream.
      if (s.url.indexOf("/signin.mp4") > -1) {
        authBlocked = true;
        return;
      }
      const bh = s.behaviorHints || {};
      const ri = resInfo(s);
      if (ri.rank < MIN_RES) return;
      const source = (s.name || "").replace(/^.*?[•·]\s*/, "").trim(); // provider tail after the badge
      if (BLOCK_SOURCES.some(function (b) {
        return source.toLowerCase().indexOf(b.toLowerCase()) > -1;
      })) return;
      const title = [ri.label, source].filter(Boolean).join(" • ") ||
                    (s.name || "PenguPlay");
      // Dual-key emission (HydraHD convention): different Shirox/Sora/Luna
      // builds read different keys, so emit both spellings of each. Each app
      // reads the key it knows and ignores the other.
      streams.push({
        _rank: ri.rank,
        _size: bh.videoSize || 0,
        title: title, name: title, quality: ri.label || title,
        streamUrl: s.url, url: s.url,
        // VAPlayer/MovieBox 403 without these; forward them verbatim.
        headers: (bh.proxyHeaders && bh.proxyHeaders.request) || {}
      });
    });

    streams.sort(function (a, b) {
      return (b._rank - a._rank) || (b._size - a._size);
    });
    streams.forEach(function (s) { delete s._rank; delete s._size; });

    (subData.subtitles || []).forEach(function (t) {
      if (!t || !t.url) return;
      const lang = String(t.lang || t.id || "").toLowerCase();
      subtitles.push({ url: t.url, lang: lang, label: subLabel(t) });
    });

    // Merge OpenSubtitles after PenguPlay's own tracks, de-duped by URL so a
    // native track always wins over an OS one for the same file.
    nativeCount = subtitles.length;
    const seenSubs = {};
    subtitles.forEach(function (t) { seenSubs[t.url] = true; });
    osList.forEach(function (t) {
      if (seenSubs[t.url]) return;
      seenSubs[t.url] = true;
      subtitles.push(t);
    });

    if (authBlocked) {
      console.log("[penguplay] AUTH REQUIRED for " + type + "/" + ppId + " — " +
                  (AUTH_TOKEN
                    ? "token present but rejected (invalid, revoked or out of quota)."
                    : "no AUTH_TOKEN set; PenguPlay returns no streams without one."));
    }
    console.log("[penguplay] streams=" + streams.length +
                " rawsubs=" + subtitles.length +
                " (native=" + nativeCount + " os=" + osList.length + ")" +
                " (" + type + "/" + ppId + ")");
  } catch (e) {
    console.log("[penguplay] stream error: " + e);
  }

  // One entry per language, English first.
  const curated = curatedSubtitleEntries(subtitles);

  // Sora convention: flat [label, url, label, url, ...] pair array.
  const subtitlePairs = [];
  curated.forEach(function (t) { subtitlePairs.push(t.label, t.url); });

  // Shirox-family convention: in-player menu reads `allSubtitles`.
  const allSubtitles = curated.map(function (t) {
    return { url: t.url, label: t.label, kind: "subtitles", headers: t.headers || {} };
  });

  // Auto-load default: first non-forced English track, else first English,
  // else first available. Curation already put English at the front.
  const english = curated.filter(isEnglishSub);
  const preferred = english.find(function (t) {
    return !/forced|signs|sdh|hi\b/i.test(String(t.label || ""));
  }) || english[0] || curated[0];
  const subtitle = (preferred && preferred.url) ? preferred.url : "";
  console.log("[penguplay] subs curated=" + curated.length + " [" +
              curated.map(function (t) { return t.label; }).join(",") + "]");

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
