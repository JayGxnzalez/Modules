// NFL WebCast Live Module
// Schedule + game info from ESPN API, streams from nflwebcast.com
// Adapted from JayGxnzalez/MLB-Webcast

async function soraFetch(url, options) {
    options = options || {};
    try {
        if (typeof fetchv2 !== "undefined") {
            return await fetchv2(url, options.headers || {}, options.method || "GET", options.body || null, true, "utf-8");
        }
        return await fetch(url, options);
    } catch (e) {
        try { return await fetch(url, options); } catch (e2) { return null; }
    }
}

async function getText(res) {
    if (!res) return "";
    try {
        if (typeof res.text === "function") return await res.text();
        return String(res);
    } catch (e) { return ""; }
}

async function getJson(res) {
    if (!res) return null;
    try {
        if (typeof res.json === "function") return await res.json();
        var t = typeof res.text === "function" ? await res.text() : String(res);
        return JSON.parse(t);
    } catch (e) { return null; }
}

var UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
var ICON = "https://raw.githubusercontent.com/JayGxnzalez/NFL-Webcast/refs/heads/main/Icon.png";
var ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

// Map ESPN team abbreviations to nflwebcast.com slugs
var ESPN_TO_SLUG = {
    "ARI": "arizona-cardinals-live-stream-online-free", "ATL": "atlanta-falcons-live-stream-online-free",
    "BAL": "baltimore-ravens-live-stream-online-free", "BUF": "buffalo-bills-live-stream-online-free",
    "CAR": "carolina-panthers-live-stream-online-free", "CHI": "chicago-bears-live-stream-online-free",
    "CIN": "cincinnati-bengals-live-stream-online-free", "CLE": "cleveland-browns-live-stream-online-free",
    "DAL": "dallas-cowboys-live-stream-online-free", "DEN": "denver-broncos-live-stream-online-free",
    "DET": "detroit-lions-live-stream-online-free", "GB": "green-bay-packers-live-stream-online-free",
    "HOU": "houston-texans-live-stream-online-free", "IND": "indianapolis-colts-live-stream-online-free",
    "JAX": "jacksonville-jaguars-live-stream-online-free", "KC": "kansas-city-chiefs-live-stream-online-free",
    "LAC": "los-angeles-chargers-live-stream-online-free", "LAR": "los-angeles-rams-live-stream-online-free",
    "LV": "las-vegas-raiders-live-stream-online-free", "MIA": "miami-dolphins-live-stream-online-free",
    "MIN": "minnesota-vikings-live-stream-online-free", "NE": "new-england-patriots-live-stream-online-free",
    "NO": "new-orleans-saints-live-stream-online-free", "NYG": "new-york-giants-live-stream-online-free",
    "NYJ": "new-york-jets-live-stream-online-free", "PHI": "philadelphia-eagles-live-stream-online-free",
    "PIT": "pittsburgh-steelers-live-stream-online-free", "SF": "san-francisco-49ers-live-stream-online-free",
    "SEA": "seattle-seahawks-live-stream-online-free", "TB": "tampa-bay-buccaneers-live-stream-online-free",
    "TEN": "tennessee-titans-live-stream-online-free", "WSH": "washington-commanders-live-stream-online-free"
};

var TEAMS = [
    { name: "Arizona Cardinals", slug: "arizona-cardinals-live-stream-online-free", abbr: "ARI" },
    { name: "Atlanta Falcons", slug: "atlanta-falcons-live-stream-online-free", abbr: "ATL" },
    { name: "Baltimore Ravens", slug: "baltimore-ravens-live-stream-online-free", abbr: "BAL" },
    { name: "Buffalo Bills", slug: "buffalo-bills-live-stream-online-free", abbr: "BUF" },
    { name: "Carolina Panthers", slug: "carolina-panthers-live-stream-online-free", abbr: "CAR" },
    { name: "Chicago Bears", slug: "chicago-bears-live-stream-online-free", abbr: "CHI" },
    { name: "Cincinnati Bengals", slug: "cincinnati-bengals-live-stream-online-free", abbr: "CIN" },
    { name: "Cleveland Browns", slug: "cleveland-browns-live-stream-online-free", abbr: "CLE" },
    { name: "Dallas Cowboys", slug: "dallas-cowboys-live-stream-online-free", abbr: "DAL" },
    { name: "Denver Broncos", slug: "denver-broncos-live-stream-online-free", abbr: "DEN" },
    { name: "Detroit Lions", slug: "detroit-lions-live-stream-online-free", abbr: "DET" },
    { name: "Green Bay Packers", slug: "green-bay-packers-live-stream-online-free", abbr: "GB" },
    { name: "Houston Texans", slug: "houston-texans-live-stream-online-free", abbr: "HOU" },
    { name: "Indianapolis Colts", slug: "indianapolis-colts-live-stream-online-free", abbr: "IND" },
    { name: "Jacksonville Jaguars", slug: "jacksonville-jaguars-live-stream-online-free", abbr: "JAX" },
    { name: "Kansas City Chiefs", slug: "kansas-city-chiefs-live-stream-online-free", abbr: "KC" },
    { name: "Los Angeles Chargers", slug: "los-angeles-chargers-live-stream-online-free", abbr: "LAC" },
    { name: "Los Angeles Rams", slug: "los-angeles-rams-live-stream-online-free", abbr: "LAR" },
    { name: "Las Vegas Raiders", slug: "las-vegas-raiders-live-stream-online-free", abbr: "LV" },
    { name: "Miami Dolphins", slug: "miami-dolphins-live-stream-online-free", abbr: "MIA" },
    { name: "Minnesota Vikings", slug: "minnesota-vikings-live-stream-online-free", abbr: "MIN" },
    { name: "New England Patriots", slug: "new-england-patriots-live-stream-online-free", abbr: "NE" },
    { name: "New Orleans Saints", slug: "new-orleans-saints-live-stream-online-free", abbr: "NO" },
    { name: "New York Giants", slug: "new-york-giants-live-stream-online-free", abbr: "NYG" },
    { name: "New York Jets", slug: "new-york-jets-live-stream-online-free", abbr: "NYJ" },
    { name: "Philadelphia Eagles", slug: "philadelphia-eagles-live-stream-online-free", abbr: "PHI" },
    { name: "Pittsburgh Steelers", slug: "pittsburgh-steelers-live-stream-online-free", abbr: "PIT" },
    { name: "San Francisco 49ers", slug: "san-francisco-49ers-live-stream-online-free", abbr: "SF" },
    { name: "Seattle Seahawks", slug: "seattle-seahawks-live-stream-online-free", abbr: "SEA" },
    { name: "Tampa Bay Buccaneers", slug: "tampa-bay-buccaneers-live-stream-online-free", abbr: "TB" },
    { name: "Tennessee Titans", slug: "tennessee-titans-live-stream-online-free", abbr: "TEN" },
    { name: "Washington Commanders", slug: "washington-commanders-live-stream-online-free", abbr: "WSH" },
    { name: "NFL Network", slug: "nflnetwork", abbr: "" },
    { name: "NFL Red Zone", slug: "nflredzone", abbr: "" },
    { name: "ESPN USA", slug: "espnusa", abbr: "" }
];

function teamLogo(abbr) {
    if (!abbr) return ICON;
    return "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/" + abbr.toLowerCase() + ".png";
}

function teamPageUrl(slug) {
    return "https://nflwebcast.com/" + slug + "/";
}

function formatGameTime(dateStr) {
    try {
        var d = new Date(dateStr);
        // Convert to PT (UTC-7 during PDT, UTC-8 during PST) — matches the MLB module
        var month = d.getUTCMonth(); // 0-indexed
        var isDST = month >= 2 && month <= 10; // Mar-Nov
        var offset = isDST ? -7 : -8;
        var ptMs = d.getTime() + offset * 3600000;
        var pt = new Date(ptMs);
        var h = pt.getUTCHours();
        var m = pt.getUTCMinutes();
        var ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return h + ":" + (m < 10 ? "0" + m : m) + " " + ampm + " PT";
    } catch (e) { return ""; }
}

function buildGameInfo(comp) {
    try {
        var away = null, home = null;
        for (var i = 0; i < comp.competitors.length; i++) {
            if (comp.competitors[i].homeAway === "away") away = comp.competitors[i];
            if (comp.competitors[i].homeAway === "home") home = comp.competitors[i];
        }
        if (!away || !home) return null;

        var status = comp.status.type;
        var statusStr = "";
        if (status.state === "in") {
            statusStr = "LIVE";
        } else if (status.state === "pre") {
            statusStr = formatGameTime(comp.date);
        } else {
            statusStr = "Final";
        }

        var awayRecord = "";
        var homeRecord = "";
        for (var r = 0; r < (away.records || []).length; r++) {
            if (away.records[r].type === "total") awayRecord = away.records[r].summary;
        }
        for (var r = 0; r < (home.records || []).length; r++) {
            if (home.records[r].type === "total") homeRecord = home.records[r].summary;
        }

        var awayAbbr = away.team.abbreviation;
        var homeAbbr = home.team.abbreviation;
        var awaySlug = ESPN_TO_SLUG[awayAbbr] || "";
        var homeSlug = ESPN_TO_SLUG[homeAbbr] || "";

        var venueName = comp.venue && comp.venue.fullName ? comp.venue.fullName : "";
        var venueCity = comp.venue && comp.venue.address && comp.venue.address.city ? comp.venue.address.city : "";

        var parts = [];
        parts.push(statusStr === "LIVE" ? "Status: LIVE" : statusStr === "Final" ? "Status: Final" : "Time: " + statusStr);
        if (venueName) parts.push("\uD83C\uDFDF " + venueName + (venueCity ? ", " + venueCity : ""));
        parts.push(away.team.displayName + " (" + awayRecord + ") @ " + home.team.displayName + " (" + homeRecord + ")");

        return {
            title: away.team.shortDisplayName + " @ " + home.team.shortDisplayName,
            image: teamLogo(homeAbbr),
            awayLogo: teamLogo(awayAbbr),
            homeLogo: teamLogo(homeAbbr),
            description: parts.join("\n"),
            statusState: status.state,
            statusStr: statusStr,
            awayScore: away.score,
            homeScore: home.score,
            awaySlug: awaySlug,
            homeSlug: homeSlug,
            homeAbbr: homeAbbr,
            awayAbbr: awayAbbr
        };
    } catch (e) { return null; }
}

// Cache ESPN data per session
var espnCache = null;

async function fetchESPN() {
    if (espnCache) return espnCache;
    try {
        var res = await soraFetch(ESPN_API);
        var data = await getJson(res);
        if (data && data.events) {
            espnCache = data.events;
            return espnCache;
        }
    } catch (e) {}
    return [];
}

var TODAY_URL = "https://nflwebcast.com/nfl-today/";

// Scrape the site's own schedule table. These are the only games the site actually
// carries links for, so this — not ESPN — decides what appears in the list.
async function fetchTodaySlate() {
    try {
        var res = await soraFetch(TODAY_URL, { headers: { "User-Agent": UA } });
        var html = await getText(res);

        // Some hosts reject the custom UA — retry bare before giving up.
        if (!html || html.length < 500) {
            var res2 = await soraFetch(TODAY_URL);
            var html2 = await getText(res2);
            if (html2 && html2.length > (html ? html.length : 0)) html = html2;
        }
        if (!html) {
            console.log("[NFLWebCast] nfl-today fetch returned empty");
            return [];
        }

        // Match any anchor pointing at a team page, then strip nested tags from its
        // inner HTML. WP wraps team names / dates in spans, so the text is rarely flat.
        var re = /<a\b[^>]*href="(?:[^"]*?nflwebcast\.com)?\/([a-z0-9-]+-live-stream-online-free)\/?[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        var seen = {};
        var games = [];
        while ((m = re.exec(html)) !== null) {
            var slug = m[1];
            var text = m[2]
                .replace(/<[^>]*>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&#0?64;/g, "@")
                .replace(/&amp;/gi, "&")
                .replace(/\s+/g, " ")
                .trim();

            // Matchup cells contain "@"; logo cells and "Watch" buttons don't.
            if (text.indexOf("@") === -1) continue;

            // Trim the trailing date ("Steelers @ Bills August 27, 2026" -> "Steelers @ Bills")
            var title = text
                .replace(/\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?,?\s*\d{2,4}\s*$/i, "")
                .replace(/\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/, "")
                .trim();
            if (!title || title === "@") continue;

            var key = slug + "|" + title.toLowerCase();
            if (seen[key]) continue;
            seen[key] = true;
            games.push({ slug: slug, title: title });
        }

        console.log("[NFLWebCast] nfl-today parsed " + games.length + " games");
        return games;
    } catch (e) { return []; }
}

async function searchResults(keyword) {
    var results = [];
    var kw = keyword.toLowerCase().trim();

    if (kw === "" || kw === "all") {
        var games = await fetchTodaySlate();
        var events = await fetchESPN();

        // Index ESPN games by home slug so we can attach LIVE status / kickoff time
        var bySlug = {};
        for (var e = 0; e < events.length; e++) {
            var g = buildGameInfo(events[e].competitions[0]);
            if (!g) continue;
            if (g.homeSlug) bySlug[g.homeSlug] = g;
        }

        var slate = [];
        for (var i = 0; i < games.length; i++) {
            var info = bySlug[games[i].slug] || null;

            var label = games[i].title;
            if (info && info.statusStr) label = label + " - " + info.statusStr;

            // Rank for ordering: live first, then upcoming, then finished last.
            var rank = 1;
            if (info && info.statusState === "in") rank = 0;
            else if (info && info.statusState === "post") rank = 2;

            slate.push({
                title: label,
                image: info ? info.image : ICON,
                href: teamPageUrl(games[i].slug),
                _rank: rank,
                _order: i
            });
        }

        // Live first, then upcoming, then finals — each keeping the site's listing order
        slate.sort(function (a, b) {
            if (a._rank !== b._rank) return a._rank - b._rank;
            return a._order - b._order;
        });

        for (var s = 0; s < slate.length; s++) {
            results.push({ title: slate[s].title, image: slate[s].image, href: slate[s].href });
        }

        // Scrape failed or nothing scheduled — fall back to the team list
        if (results.length === 0) {
            for (var i = 0; i < TEAMS.length; i++) {
                results.push({
                    title: TEAMS[i].name,
                    image: teamLogo(TEAMS[i].abbr),
                    href: teamPageUrl(TEAMS[i].slug)
                });
            }
        }
        return JSON.stringify(results);
    }

    for (var i = 0; i < TEAMS.length; i++) {
        if (TEAMS[i].name.toLowerCase().indexOf(kw) !== -1) {
            results.push({
                title: TEAMS[i].name,
                image: teamLogo(TEAMS[i].abbr),
                href: teamPageUrl(TEAMS[i].slug)
            });
        }
    }

    // No name match (typo, or a term like "nfl"/"football") — show the full team list
    // rather than an empty screen.
    if (results.length === 0) {
        for (var i = 0; i < TEAMS.length; i++) {
            results.push({
                title: TEAMS[i].name,
                image: teamLogo(TEAMS[i].abbr),
                href: teamPageUrl(TEAMS[i].slug)
            });
        }
    }
    return JSON.stringify(results);
}

async function extractDetails(url) {
    try {
        var slugMatch = url.match(/nflwebcast\.com\/([^\/]+)\/?$/);
        var slug = slugMatch ? slugMatch[1] : "";

        var events = await fetchESPN();
        var info = null;
        for (var i = 0; i < events.length; i++) {
            var comp = events[i].competitions[0];
            var g = buildGameInfo(comp);
            if (g && (g.homeSlug === slug || g.awaySlug === slug)) {
                info = g;
                break;
            }
        }

        if (info) {
            var scoreStr = info.statusState === "in" || info.statusState === "post"
                ? info.awayAbbr + " " + info.awayScore + " - " + info.homeAbbr + " " + info.homeScore
                : "";
            return JSON.stringify([{
                title: info.title + (scoreStr ? " (" + scoreStr + ")" : ""),
                image: info.image,
                description: info.description,
                aliases: scoreStr || "Upcoming",
                airdate: info.statusStr,
                href: url
            }]);
        }

        // Fallback — derive team name from slug
        var teamName = slug.replace(/-live-stream-online-free$/, "").replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        return JSON.stringify([{
            title: teamName || "NFL Stream",
            image: ICON,
            description: "Live NFL stream \u2014 multiple feeds (HOME / AWAY / LINK 3 / LINK 4) available.",
            aliases: "NFL WebCast",
            airdate: "Live",
            href: url
        }]);
    } catch (e) {
        return JSON.stringify([{ title: "NFL Stream", image: ICON, description: "Live NFL stream.", aliases: "NFL WebCast", airdate: "Live", href: url }]);
    }
}

async function extractEpisodes(url) {
    try {
        var res = await soraFetch(url, { headers: { "User-Agent": UA } });
        var html = await getText(res);
        if (!html) {
            console.log("[NFLWebCast] team page fetch returned empty");
            return JSON.stringify([]);
        }

        // Collect every /live/*.html feed link first, then filter — accepts relative hrefs too.
        var re = /<a\b[^>]*href="(?:[^"]*?nflwebcast\.com)?(\/live\/[^"]+?\.html)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        var seen = {};
        var all = [];
        while ((m = re.exec(html)) !== null) {
            var link = "https://nflwebcast.com" + m[1].split("?")[0];
            if (seen[link]) continue;
            seen[link] = true;
            var label = m[2]
                .replace(/<[^>]*>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/\s+/g, " ")
                .trim();
            all.push({ label: label, link: link });
        }

        console.log("[NFLWebCast] found " + all.length + " /live/ links");
        if (all.length === 0) return JSON.stringify([]);

        // Prefer HOME/AWAY (substring match, not exact — markup varies).
        // LINK 3 / LINK 4 are iframe embeds; hdtv.html is a generic channel feed.
        var picked = [];
        for (var i = 0; i < all.length; i++) {
            var up = all[i].label.toUpperCase();
            if (up.indexOf("HOME") !== -1 || up.indexOf("AWAY") !== -1) picked.push(all[i]);
        }

        // Nothing matched the labels — fall back to every feed except the generic
        // channel page, so a markup change can't leave the picker empty.
        if (picked.length === 0) {
            console.log("[NFLWebCast] no HOME/AWAY labels matched, using all feeds");
            for (var j = 0; j < all.length; j++) {
                if (all[j].link.indexOf("/hdtv.html") !== -1) continue;
                picked.push(all[j]);
            }
        }

        if (picked.length === 0) return JSON.stringify([]);

        var pairs = [];
        for (var k = 0; k < picked.length; k++) {
            pairs.push(picked[k].label + "~~" + picked[k].link);
        }

        return JSON.stringify([{ number: 1, title: "Live Stream", href: pairs.join("|") }]);
    } catch (e) {
        console.log("[NFLWebCast] extractEpisodes error: " + e);
        return JSON.stringify([]);
    }
}

// Derive the team name from a /live/ filename: bills.html -> "Bills", 49ers.html -> "49ers"
function teamNameFromUrl(htmlUrl) {
    var m = htmlUrl.match(/\/([^\/]+)\.html$/);
    if (!m) return "";
    var name = m[1].replace(/[0-9]+$/, "").replace(/-/g, " ").trim();
    if (!name) return "";
    return name.charAt(0).toUpperCase() + name.slice(1);
}

// Picker label is just the team name; fall back to HOME/AWAY if the filename is unusable
function buildLabel(anchorLabel, htmlUrl) {
    return teamNameFromUrl(htmlUrl) || anchorLabel || "Stream";
}

// Resolve a single /live/*.html feed page to an m3u8.
// NOTE: mirrors the MLB operator's `var _d = [...]` + check_stream.php flow.
// The inner-page JS wasn't inspectable remotely — verify param names live via Proxyman
// and adjust the regex / query keys here if the NFL pages differ.
async function fetchStreamFromHtml(htmlUrl) {
    try {
        htmlUrl = htmlUrl.split("?")[0];
        var res = await soraFetch(htmlUrl, { headers: { "User-Agent": UA, "Referer": "https://nflwebcast.com/" } });
        var html = await getText(res);
        var dMatch = html.match(/var\s+_d\s*=\s*\[(\d+)\s*,\s*'([^']+)'\s*,\s*'([^']+)'\]/);
        if (!dMatch) return null;
        var base = htmlUrl.substring(0, htmlUrl.lastIndexOf("/") + 1);
        var checkUrl = base + "check_stream.php?id=" + dMatch[1] + "&ts=" + dMatch[2] + "&pt=" + dMatch[3];
        var checkRes = await soraFetch(checkUrl, { headers: { "Referer": htmlUrl, "User-Agent": UA } });
        var data = await getJson(checkRes);
        return (data && data.url) ? data.url : null;
    } catch (e) { return null; }
}

async function extractStreamUrl(url) {
    try {
        var streams = [];
        var items = url.split("|");
        var tasks = [];
        for (var i = 0; i < items.length; i++) {
            var parts = items[i].split("~~");
            var label = parts.length > 1 ? parts[0] : "";
            var link = parts.length > 1 ? parts[1] : parts[0];
            if (!link) continue;
            tasks.push({ label: buildLabel(label, link), link: link });
        }

        var resolved = await Promise.all(tasks.map(async function (t) {
            var m3u8 = await fetchStreamFromHtml(t.link);
            // Manifest lives on the s3.thegamehd.top CDN. Segments carry their own
            // in-URL token (?token=...), so AVPlayer fetches them fine without headers;
            // these headers apply only to the manifest request, in case the CDN checks Referer.
            return m3u8 ? { title: t.label, streamUrl: m3u8, headers: { "Referer": "https://nflwebcast.com/", "User-Agent": UA } } : null;
        }));

        for (var j = 0; j < resolved.length; j++) {
            if (resolved[j]) streams.push(resolved[j]);
        }

        if (streams.length === 0) return JSON.stringify(null);
        return JSON.stringify({ streams: streams, subtitles: "" });
    } catch (e) {
        return JSON.stringify(null);
    }
}
