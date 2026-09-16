async function searchResults(keyword, page) {
    try {
        if (page && page > 1) return await searchPage(keyword, page);

        const MAX_PAGES = 5;
        const seen = {};
        const all = [];
        for (let p = 1; p <= MAX_PAGES; p++) {
            const pageResults = await searchPage(keyword, p);
            if (!pageResults.length) break;
            for (let i = 0; i < pageResults.length; i++) {
                const r = pageResults[i];
                if (!seen[r.id]) { seen[r.id] = true; all.push(r); }
            }
            if (pageResults.length < 10) break;
        }
        console.log("[BatCave] search parsed:" + all.length);
        return all;
    } catch (err) {
        return [];
    }
}

async function searchPage(keyword, page) {
    const results = [];
    let url = "https://batcave.biz/search/" + encodeURIComponent(keyword) + "/";
    if (page > 1) url += "page/" + page + "/";

    const html = await guardFetch(url);
    const regex = /<a href="([^"]+)"[^>]*class="readed__img[^>]*>\s*<img[^>]*data-src="([^"]+)"[^>]*alt="([^"]+)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        results.push({
            id: toAbsolute(match[1]),
            imageURL: toAbsolute(match[2]),
            title: decodeEntities(match[3].trim())
        });
    }
    return results;
}

async function extractDetails(url) {
    try {
        const html = await guardFetch(url);

        let description = "";
        const descMatch = html.match(/<div class="page__text[^"]*">([\s\S]*?)<\/div>/);
        if (descMatch) description = decodeEntities(stripTags(descMatch[1]));

        const tags = [];
        const tagsBlock = html.match(/<div class="page__tags[^"]*">([\s\S]*?)<\/div>/);
        if (tagsBlock) {
            const tre = /<a[^>]*>([^<]+)<\/a>/g;
            let tm;
            while ((tm = tre.exec(tagsBlock[1])) !== null) tags.push(decodeEntities(tm[1].trim()));
        }
        const listBlock = html.match(/<ul class="page__list">([\s\S]*?)<\/ul>/);
        if (listBlock) {
            const lre = /<li><div>[^<]*<\/div>\s*(?:<a[^>]*>([^<]+)<\/a>|([^<]+))<\/li>/g;
            let lm;
            while ((lm = lre.exec(listBlock[1])) !== null) {
                const val = decodeEntities((lm[1] || lm[2] || "").trim());
                if (val) tags.push(val);
            }
        }

        return { description: String(description), tags: tags };
    } catch (err) {
        return { description: "", tags: [] };
    }
}

async function extractChapters(url) {
    const results = [];
    try {
        const html = await guardFetch(url);

        const dataMatch = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/);
        if (dataMatch) {
            const data = JSON.parse(dataMatch[1]);
            const newsId = data.news_id;
            const xhash = data.xhash || "";
            if (data.chapters && data.chapters.length) {
                for (const ch of data.chapters) {
                    results.push([
                        String(ch.posi),
                        [{
                            id: `https://batcave.biz/reader/${newsId}/${ch.id}${xhash}`,
                            title: decodeEntities(ch.title || `#${ch.posi}`),
                            chapter: ch.posi,
                            scanlation_group: ""
                        }]
                    ]);
                }
            }
        }

        console.log("[BatCave] chapters parsed:" + results.length);
        results.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
        return { en: results };
    } catch (err) {
        return { en: [] };
    }
}

async function extractImages(url) {
    try {
        const parts = url.replace(/\/+$/, "").split("/");
        const rawId = parts.pop();
        const newsId = parts.pop();
        const chapterId = (rawId.match(/^\d+/) || [rawId])[0];

        const apiUrl = "https://batcave.biz/engine/ajax/controller.php?mod=api&action=reader%2FgetChapterData";
        const apiOptions = {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
            body: JSON.stringify({ news_id: parseInt(newsId), chapter_id: parseInt(chapterId) })
        };

        let images = [];
        for (let attempt = 0; attempt < 3; attempt++) {
            const text = await guardFetch(apiUrl, apiOptions);
            try {
                const json = JSON.parse(text);
                if (json && json.data && json.data.images && json.data.images.length) {
                    images = json.data.images;
                    break;
                }
            } catch (e) {}
            if (guardSolving) { try { await guardSolving; } catch (e) {} }
        }

        console.log("[BatCave] images parsed:" + images.length);
        return images.map(toAbsolute);
    } catch (err) {
        return [];
    }
}

// ===== DLE Guard solver (proof-of-work challenge) =====

var guardCookies = {};
var guardSolving = null;

async function guardFetch(url, options) {
    let text = await soraFetchText(url, options);
    if (isGuardChallenge(text)) {
        if (guardSolving) {
            await guardSolving;
        } else {
            guardSolving = solveGuard(text);
            const ok = await guardSolving;
            guardSolving = null;
            console.log("[BatCave] guard: detected solved:" + ok + " trust:" + !!guardCookies["__guard_trust"]);
        }
        text = await soraFetchText(url, options);
        if (isGuardChallenge(text)) {
            if (guardSolving) {
                await guardSolving;
            } else {
                guardSolving = solveGuard(text);
                await guardSolving;
                guardSolving = null;
            }
            text = await soraFetchText(url, options);
        }
    }
    return text;
}

function isGuardChallenge(text) {
    return !!text && text.indexOf("token:") !== -1 && text.indexOf("/_v") !== -1 && text.indexOf("sendResult") !== -1;
}

async function solveGuard(html) {
    try {
        const m = html.match(/token:\s*"([^"]+)"/);
        if (!m) return false;
        const pToken = m[1];

        let nonce = 0, hash = "";
        while (true) {
            hash = sha256hex(pToken + ":" + nonce);
            if (hash.slice(0, 2) === "00") break;
            nonce++;
            if (nonce > 5000000) return false;
        }

        const body =
            "token=" + encodeURIComponent(pToken) +
            "&mode=modern&workTime=60&iterations=" + nonce + "&hasCrypto=1" +
            "&pow_nonce=" + nonce + "&pow_hash=" + hash +
            "&webdriver=0&touch=0&screen_w=1920&screen_h=1080&screen_cd=24" +
            "&wgv=" + encodeURIComponent("Google Inc. (NVIDIA)") +
            "&wgr=" + encodeURIComponent("ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0), or similar") +
            "&tz=0&dpr=1&cdp=0&cdpf=";

        await soraFetchText("https://batcave.biz/_v", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body
        });
        return true;
    } catch (err) {
        return false;
    }
}

// ===== transport + cookie jar =====

function storeCookies(setCookie) {
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (let i = 0; i < arr.length; i++) {
        const first = String(arr[i]).split(";")[0];
        const eq = first.indexOf("=");
        if (eq > 0) {
            const name = first.slice(0, eq).trim();
            const val = first.slice(eq + 1).trim();
            if (name) guardCookies[name] = val;
        }
    }
}

function cookieHeader() {
    const parts = [];
    for (const k in guardCookies) {
        if (guardCookies.hasOwnProperty(k)) parts.push(k + "=" + guardCookies[k]);
    }
    return parts.join("; ");
}

async function soraFetchText(url, options) {
    options = options || {};
    const headers = options.headers || {};
    if (!headers["User-Agent"]) {
        headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    }
    if (!headers["Referer"]) headers["Referer"] = "https://batcave.biz/";
    const ck = cookieHeader();
    if (ck && !headers["Cookie"]) headers["Cookie"] = ck;

    const method = options.method || "GET";
    const body = options.body || null;

    let res = null;
    try {
        res = await fetchv2(url, headers, method, body);
    } catch (e) {
        try { res = await fetch(url, { method: method, headers: headers, body: body }); } catch (e2) { res = null; }
    }
    if (!res) return "";
    try {
        if (res.headers) storeCookies(res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    } catch (e) {}
    try { return await res.text(); } catch (e) { return ""; }
}

// ===== pure-JS SHA-256 (JSC-safe, no crypto.subtle) =====

function sha256hex(ascii) {
    function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
    var K = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bytes = [];
    for (var i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
        for (var t = 0; t < 16; t++) {
            w[t] = ((bytes[off+t*4]<<24)|(bytes[off+t*4+1]<<16)|(bytes[off+t*4+2]<<8)|(bytes[off+t*4+3]))|0;
        }
        for (var t = 16; t < 64; t++) {
            var s0 = rotr(7,w[t-15])^rotr(18,w[t-15])^(w[t-15]>>>3);
            var s1 = rotr(17,w[t-2])^rotr(19,w[t-2])^(w[t-2]>>>10);
            w[t] = (w[t-16]+s0+w[t-7]+s1)|0;
        }
        var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for (var t = 0; t < 64; t++) {
            var S1 = rotr(6,e)^rotr(11,e)^rotr(25,e);
            var ch = (e&f)^((~e)&g);
            var t1 = (h+S1+ch+K[t]+w[t])|0;
            var S0 = rotr(2,a)^rotr(13,a)^rotr(22,a);
            var maj = (a&b)^(a&c)^(b&c);
            var t2 = (S0+maj)|0;
            h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
        }
        H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
        H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
    }
    var out = "";
    for (var i = 0; i < 8; i++) out += ("00000000" + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
}

// ===== helpers =====

function toAbsolute(url) {
    if (!url) return "";
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return "https://batcave.biz" + url;
    if (url.startsWith("http://")) return url.replace("http://", "https://");
    if (url.startsWith("https://")) return url;
    return "https://batcave.biz/" + url;
}

function decodeEntities(str) {
    if (!str) return "";
    return str
        .replace(/&#0?39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&mdash;/g, "\u2014");
}

function stripTags(html) {
    return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
