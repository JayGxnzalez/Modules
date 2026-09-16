// MLB WebCast Live Module
// Schedule + game info from ESPN API, streams from mlbwebcast.com

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
var ICON = "https://raw.githubusercontent.com/JayGxnzalez/MLB-Webcast/main/MLBWC.png";
var ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard";

// Map ESPN team abbreviations to mlbwebcast.com slugs
var ESPN_TO_SLUG = {
    "ARI": "arizona-diamondbacks-live", "ATL": "atlanta-braves-live",
    "BAL": "baltimore-orioles-live", "BOS": "boston-red-sox-live",
    "CHC": "chicago-cubs-live", "CWS": "chicago-white-sox-live",
    "CIN": "cincinnati-reds-live", "CLE": "cleveland-guardians-live",
    "COL": "colorado-rockies-live", "DET": "detroit-tigers-live",
    "HOU": "houston-astros-live", "KC": "kansas-city-royals-live",
    "LAA": "los-angeles-angels-live", "LAD": "los-angeles-dodgers-live",
    "MIA": "miami-marlins-live", "MIL": "milwaukee-brewers-live",
    "MIN": "minnesota-twins-live", "NYM": "new-york-mets-live",
    "NYY": "new-york-yankees-live", "OAK": "oakland-athletics-live",
    "PHI": "philadelphia-phillies-live", "PIT": "pittsburgh-pirates-live",
    "SD": "san-diego-padres-live", "SF": "san-francisco-giants-live",
    "SEA": "seattle-mariners-live", "STL": "st-louis-cardinals-live",
    "TB": "tampa-bay-rays-live", "TEX": "texas-rangers-live",
    "TOR": "toronto-blue-jays-live", "WSH": "washington-nationals-live"
};

var TEAMS = [
    { name: "Arizona Diamondbacks", slug: "arizona-diamondbacks-live", abbr: "ARI" },
    { name: "Atlanta Braves", slug: "atlanta-braves-live", abbr: "ATL" },
    { name: "Baltimore Orioles", slug: "baltimore-orioles-live", abbr: "BAL" },
    { name: "Boston Red Sox", slug: "boston-red-sox-live", abbr: "BOS" },
    { name: "Chicago Cubs", slug: "chicago-cubs-live", abbr: "CHC" },
    { name: "Chicago White Sox", slug: "chicago-white-sox-live", abbr: "CWS" },
    { name: "Cincinnati Reds", slug: "cincinnati-reds-live", abbr: "CIN" },
    { name: "Cleveland Guardians", slug: "cleveland-guardians-live", abbr: "CLE" },
    { name: "Colorado Rockies", slug: "colorado-rockies-live", abbr: "COL" },
    { name: "Detroit Tigers", slug: "detroit-tigers-live", abbr: "DET" },
    { name: "Houston Astros", slug: "houston-astros-live", abbr: "HOU" },
    { name: "Kansas City Royals", slug: "kansas-city-royals-live", abbr: "KC" },
    { name: "Los Angeles Angels", slug: "los-angeles-angels-live", abbr: "LAA" },
    { name: "Los Angeles Dodgers", slug: "los-angeles-dodgers-live", abbr: "LAD" },
    { name: "Miami Marlins", slug: "miami-marlins-live", abbr: "MIA" },
    { name: "Milwaukee Brewers", slug: "milwaukee-brewers-live", abbr: "MIL" },
    { name: "Minnesota Twins", slug: "minnesota-twins-live", abbr: "MIN" },
    { name: "New York Mets", slug: "new-york-mets-live", abbr: "NYM" },
    { name: "New York Yankees", slug: "new-york-yankees-live", abbr: "NYY" },
    { name: "Oakland Athletics", slug: "oakland-athletics-live", abbr: "OAK" },
    { name: "Philadelphia Phillies", slug: "philadelphia-phillies-live", abbr: "PHI" },
    { name: "Pittsburgh Pirates", slug: "pittsburgh-pirates-live", abbr: "PIT" },
    { name: "San Diego Padres", slug: "san-diego-padres-live", abbr: "SD" },
    { name: "San Francisco Giants", slug: "san-francisco-giants-live", abbr: "SF" },
    { name: "Seattle Mariners", slug: "seattle-mariners-live", abbr: "SEA" },
    { name: "St. Louis Cardinals", slug: "st-louis-cardinals-live", abbr: "STL" },
    { name: "Tampa Bay Rays", slug: "tampa-bay-rays-live", abbr: "TB" },
    { name: "Texas Rangers", slug: "texas-rangers-live", abbr: "TEX" },
    { name: "Toronto Blue Jays", slug: "toronto-blue-jays-live", abbr: "TOR" },
    { name: "Washington Nationals", slug: "washington-nationals-live", abbr: "WSH" },
    { name: "MLB Network", slug: "mlb-network-live", abbr: "" },
    { name: "Fox Sports", slug: "fox-sports-live", abbr: "" }
];

function teamLogo(abbr) {
    if (!abbr) return ICON;
    return "https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/" + abbr.toLowerCase() + ".png";
}

function formatGameTime(dateStr) {
    try {
        var d = new Date(dateStr);
        // Convert to PT (UTC-7 during PDT, UTC-8 during PST)
        // Use UTC-7 for Mar-Nov (roughly PDT), UTC-8 otherwise
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
            statusStr = "Finished";
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

        // Build description
        var parts = [];
        parts.push(statusStr === "LIVE" ? "Status: LIVE" : statusStr === "Finished" ? "Status: Finished" : "Time: " + statusStr);
        parts.push("\uD83C\uDFDF " + comp.venue.fullName + ", " + comp.venue.address.city);
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

async function searchResults(keyword) {
    var results = [];
    var kw = keyword.toLowerCase().trim();

    if (kw === "" || kw === "all" || kw === "mlb") {
        var events = await fetchESPN();
        for (var i = 0; i < events.length; i++) {
            var comp = events[i].competitions[0];
            var info = buildGameInfo(comp);
            if (!info) continue;
            var homeSlug = info.homeSlug || "";
            var watchUrl = homeSlug ? "https://mlbwebcast.com/" + homeSlug + "/" : "";
            if (!watchUrl) continue;
            results.push({
                title: info.title + " - " + info.statusStr,
                image: info.image,
                href: watchUrl
            });
        }
        if (results.length === 0) {
            for (var i = 0; i < TEAMS.length; i++) {
                results.push({
                    title: TEAMS[i].name,
                    image: teamLogo(TEAMS[i].abbr),
                    href: "https://mlbwebcast.com/" + TEAMS[i].slug + "/"
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
                href: "https://mlbwebcast.com/" + TEAMS[i].slug + "/"
            });
        }
    }
    return JSON.stringify(results);
}

async function extractDetails(url) {
    try {
        // Extract slug from URL
        var slugMatch = url.match(/mlbwebcast\.com\/([^\/]+)\/?$/);
        var slug = slugMatch ? slugMatch[1] : "";

        // Find matching ESPN game
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

        // Fallback — find team name from slug
        var teamName = slug.replace(/-live$/, "").replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        return JSON.stringify([{
            title: teamName,
            image: ICON,
            description: "Live MLB stream \u2014 HOME and AWAY feeds available.",
            aliases: "MLB WebCast",
            airdate: "Live",
            href: url
        }]);
    } catch (e) {
        return JSON.stringify([{ title: "MLB Stream", image: ICON, description: "Live MLB stream.", aliases: "MLB WebCast", airdate: "Live", href: url }]);
    }
}

async function extractEpisodes(url) {
    try {
        var res = await soraFetch(url, { headers: { "User-Agent": UA } });
        var html = await getText(res);

        // Match HOME and AWAY stream HTML links
        var homeMatch = html.match(/href="(https:\/\/mlbwebcast\.com\/stream\/[^"]+\.html)[^"]*"[^>]*>[\s\S]{0,200}?HOME/);
        var awayMatch = html.match(/href="(https:\/\/mlbwebcast\.com\/stream\/[^"]+\.html)[^"]*"[^>]*>[\s\S]{0,200}?AWAY/);

        if (!homeMatch && !awayMatch) return JSON.stringify([]);

        var homeUrl = homeMatch ? homeMatch[1] : "";
        var awayUrl = awayMatch ? awayMatch[1] : "";
        var combinedHref = homeUrl + "|" + awayUrl;

        return JSON.stringify([{ number: 1, title: "Live Stream", href: combinedHref }]);
    } catch (e) {
        return JSON.stringify([]);
    }
}

function teamNameFromUrl(htmlUrl) {
    var m = htmlUrl.match(/\/([^\/]+)\.html$/);
    if (!m) return "";
    var name = m[1].replace(/[0-9]+$/, "").replace(/-/g, " ");
    return name.charAt(0).toUpperCase() + name.slice(1);
}

async function fetchStreamFromHtml(htmlUrl) {
    try {
        htmlUrl = htmlUrl.split("?")[0];
        var res = await soraFetch(htmlUrl, { headers: { "User-Agent": UA, "Referer": "https://mlbwebcast.com/" } });
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
        var parts = url.split("|");
        var homeUrl = parts[0] || "";
        var awayUrl = parts[1] || "";

        if (homeUrl) {
            var m3u8 = await fetchStreamFromHtml(homeUrl);
            if (m3u8) streams.push({ title: teamNameFromUrl(homeUrl), streamUrl: m3u8, headers: {} });
        }
        if (awayUrl) {
            var m3u8 = await fetchStreamFromHtml(awayUrl);
            if (m3u8) streams.push({ title: teamNameFromUrl(awayUrl), streamUrl: m3u8, headers: {} });
        }

        if (streams.length === 0) return JSON.stringify(null);
        return JSON.stringify({ streams: streams, subtitles: "" });
    } catch (e) {
        return JSON.stringify(null);
    }
}
