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

async function getCsrfToken() {
    const response = await soraFetch("https://mangaball.net/");
    if (!response) throw new Error("CSRF fetch failed");
    const html = await response.text();
    const match = /<meta name="csrf-token" content="([^"]+)">/.exec(html);
    if (!match) throw new Error("CSRF token not found");
    return match[1];
}

function extractTitleId(url) {
    const match = /([a-f0-9]{24})\/?$/.exec(url);
    return match ? match[1] : null;
}

function toAbsolute(u) {
    u = String(u || "").trim();
    if (u.indexOf("//") === 0) {
        u = "https:" + u;
    } else if (u.indexOf("http://") === 0) {
        u = "https://" + u.substring(7);
    } else if (u.indexOf("https://") !== 0 && u.length > 0) {
        u = "https://mangaball.net" + (u.indexOf("/") === 0 ? "" : "/") + u;
    }
    return u;
}

async function searchResults(keyword, page = 1) {
    const results = [];
    try {
        const csrfToken = await getCsrfToken();
        const postData = "search_input=" + encodeURIComponent(keyword);

        const response = await soraFetch("https://mangaball.net/api/v1/smart-search/search/", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-CSRF-Token": csrfToken,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://mangaball.net",
                "Referer": "https://mangaball.net/search-advanced/"
            },
            body: postData
        });

        if (!response) return results;
        const json = await response.json();
        const manga = json.data && Array.isArray(json.data.manga) ? json.data.manga : [];
        for (let i = 0; i < manga.length; i++) {
            const item = manga[i];
            if (!item || !item.url || !item.title) continue;
            results.push({
                id: toAbsolute(item.url),
                imageURL: String(item.img || "").trim(),
                title: String(item.title).trim()
            });
        }
        return results;
    } catch (err) {
        return results;
    }
}

async function extractDetails(url) {
    try {
        const response = await soraFetch(url);
        if (!response) return { description: "Error", tags: [] };
        const html = await response.text();

        const descMatch = /<div class="description-text">[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(html);
        const description = descMatch ? descMatch[1].trim() : "";

        const tags = [];
        const tagRegex = /data-tag-id="[^"]*"[^>]*>([^<]+)<\/span>/g;
        let tagMatch;
        while ((tagMatch = tagRegex.exec(html)) !== null) {
            tags.push(String(tagMatch[1]).trim());
        }

        return { description: String(description), tags: tags };
    } catch (err) {
        return { description: "Error", tags: [] };
    }
}

async function extractChapters(url) {
    try {
        const titleId = extractTitleId(url);
        if (!titleId) return { en: [] };

        const csrfToken = await getCsrfToken();
        const postData = "title_id=" + titleId + "&userSettingsEnabled=false";

        const response = await soraFetch("https://mangaball.net/api/v1/chapter/chapter-listing-by-title-id/", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-CSRF-Token": csrfToken,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://mangaball.net",
                "Referer": "https://mangaball.net/"
            },
            body: postData
        });

        if (!response) return { en: [] };
        const json = await response.json();
        if (json.code !== 200 || !Array.isArray(json.ALL_CHAPTERS)) {
            return { en: [] };
        }

        const results = [];
        for (let i = 0; i < json.ALL_CHAPTERS.length; i++) {
            const chapter = json.ALL_CHAPTERS[i];
            const translations = Array.isArray(chapter.translations) ? chapter.translations : [];
            const entries = [];
            for (let j = 0; j < translations.length; j++) {
                const t = translations[j];
                if (!t || !t.url) continue;
                entries.push({
                    id: toAbsolute(t.url),
                    title: String(t.name || ("Chapter " + chapter.number)),
                    chapter: parseFloat(chapter.number_float) || 0,
                    scanlation_group: String((t.group && t.group.name) ? t.group.name : "")
                });
            }
            if (entries.length > 0) {
                results.push([String(chapter.number), entries]);
            }
        }

        return { en: results };
    } catch (err) {
        return { en: [] };
    }
}

async function extractImages(url) {
    try {
        const response = await soraFetch(url);
        if (!response) return [];
        const html = await response.text();

        const match = /const chapterImages = JSON\.parse\(`([\s\S]*?)`\)/.exec(html);
        if (!match) return [];

        const images = JSON.parse(match[1]);
        const out = [];
        for (let i = 0; i < images.length; i++) {
            if (images[i]) out.push(String(images[i]).trim());
        }
        return out;
    } catch (err) {
        return [];
    }
}
