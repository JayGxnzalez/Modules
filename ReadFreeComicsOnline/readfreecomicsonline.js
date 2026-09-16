function toAbsolute(u) {
    u = String(u || "").trim();
    if (u.indexOf("//") === 0) {
        u = "https:" + u;
    } else if (u.indexOf("http://") === 0) {
        u = "https://" + u.substring(7);
    } else if (u.indexOf("https://") !== 0 && u.length > 0) {
        u = "https://readfreecomicsonline.com" + (u.indexOf("/") === 0 ? "" : "/") + u;
    }
    return u;
}

function getArticleBlocks(html) {
    const blocks = [];
    const regex = /<article[^>]*id="post-[\s\S]*?<\/article>/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
        blocks.push(m[0]);
    }
    return blocks;
}

function parseArticle(block) {
    const titleMatch = /<h2 class="entry-title"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(block);
    if (!titleMatch) return null;

    const url = toAbsolute(titleMatch[1]);
    const title = String(titleMatch[2]).trim();

    let thumb = "";
    const imgRegex = /<img[^>]+src="([^"]+)"/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(block)) !== null) {
        if (imgMatch[1].indexOf("/wp-content/uploads/") !== -1) {
            thumb = toAbsolute(imgMatch[1]);
            break;
        }
    }

    const dateMatch = /<time class="entry-date published" datetime="([^"]+)"/.exec(block);
    const dateStr = dateMatch ? dateMatch[1] : "";
    const ts = dateStr ? new Date(dateStr).getTime() : 0;

    let tagUrl = "";
    let tagText = "";
    const tagLinkMatch = /<a href="([^"]+)"[^>]*rel="tag"[^>]*>([^<]+)<\/a>/.exec(block);
    if (tagLinkMatch) {
        tagUrl = toAbsolute(tagLinkMatch[1]);
        tagText = String(tagLinkMatch[2]).trim();
    }

    return { url: url, title: title, thumb: thumb, ts: ts, tagUrl: tagUrl, tagText: tagText };
}

async function searchResults(keyword) {
    const results = [];
    try {
        const response = await fetch("https://readfreecomicsonline.com/?s=" + encodeURIComponent(keyword));
        const html = await response.text();
        const blocks = getArticleBlocks(html);

        const seen = {};
        for (let i = 0; i < blocks.length; i++) {
            const item = parseArticle(blocks[i]);
            if (!item) continue;

            const seriesId = item.tagUrl || item.url;
            if (seen[seriesId]) continue;
            seen[seriesId] = true;

            let seriesTitle = item.title;
            if (item.tagText) {
                seriesTitle = item.tagText.split("–")[0].trim();
            }

            results.push({
                id: seriesId,
                imageURL: item.thumb,
                title: seriesTitle
            });
        }
        return results;
    } catch (err) {
        return results;
    }
}

async function extractDetails(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        let description = "";
        const descMatch = /<meta property="og:description" content="([^"]+)"/.exec(html);
        if (descMatch) description = descMatch[1].trim();

        const tags = [];
        const blocks = getArticleBlocks(html);
        if (blocks.length > 0) {
            const catRegex = /<a[^>]*rel="category tag"[^>]*>([^<]+)<\/a>/g;
            let cm;
            while ((cm = catRegex.exec(blocks[0])) !== null) {
                tags.push(String(cm[1]).trim());
            }
        }

        return { description: description, tags: tags };
    } catch (err) {
        return { description: "", tags: [] };
    }
}

async function extractChapters(url) {
    try {
        const base = url.replace(/\/$/, "");
        const issues = [];
        const seenUrls = {};

        for (let page = 1; page <= 30; page++) {
            const pageUrl = page === 1 ? url : base + "/page/" + page + "/";
            let html;
            try {
                const response = await fetch(pageUrl);
                html = await response.text();
            } catch (e) {
                break;
            }

            const blocks = getArticleBlocks(html);
            if (blocks.length === 0) break;

            let addedAny = false;
            for (let i = 0; i < blocks.length; i++) {
                const item = parseArticle(blocks[i]);
                if (!item || seenUrls[item.url]) continue;
                seenUrls[item.url] = true;
                addedAny = true;

                // Specials/one-shots (e.g. "... Special Issue 1 ...",
                // "... Noir Edition Issue 1 ...") are not part of the main
                // numbering, but the number in their own title usually
                // names which issue they're a companion to. Anchor them
                // there instead of placing them by their own publish date
                // on the site, which reflects upload timing, not reading
                // order (a Noir re-release of Issue 1 uploaded after
                // Issue 3 went live would otherwise land after Issue 3).
                const isSpecial = /\b(Special|Noir Edition|Annual|Variant)\b/i.test(item.title);
                let refNumber = 0;
                const numMatch = /Issue\s+(\d+(?:\.\d+)?)/i.exec(item.title);
                if (numMatch) refNumber = parseFloat(numMatch[1]);

                issues.push({
                    id: item.url,
                    title: item.title,
                    isSpecial: isSpecial,
                    refNumber: refNumber,
                    ts: item.ts
                });
            }

            if (!addedAny) break;
        }

        const numbered = issues.filter(function (x) { return !x.isSpecial && x.refNumber > 0; });
        const specials = issues.filter(function (x) { return x.isSpecial; });
        const unnumbered = issues.filter(function (x) { return !x.isSpecial && x.refNumber <= 0; });

        numbered.sort(function (a, b) { return a.refNumber - b.refNumber; });
        specials.sort(function (a, b) {
            if (a.refNumber !== b.refNumber) return a.refNumber - b.refNumber;
            return a.ts - b.ts;
        });
        unnumbered.sort(function (a, b) { return a.ts - b.ts; });

        const byAnchor = {};
        const orphanSpecials = [];
        for (let i = 0; i < specials.length; i++) {
            const s = specials[i];
            if (s.refNumber > 0) {
                if (!byAnchor[s.refNumber]) byAnchor[s.refNumber] = [];
                byAnchor[s.refNumber].push(s);
            } else {
                orphanSpecials.push(s);
            }
        }

        const merged = [];
        const usedAnchors = {};
        for (let i = 0; i < numbered.length; i++) {
            merged.push(numbered[i]);
            const key = numbered[i].refNumber;
            const group = byAnchor[key];
            if (group) {
                merged.push.apply(merged, group);
                usedAnchors[key] = true;
            }
        }
        // Specials referencing an issue number that wasn't found among the
        // numbered issues (or no number at all) get appended at the end.
        for (const key in byAnchor) {
            if (!usedAnchors[key]) merged.push.apply(merged, byAnchor[key]);
        }
        merged.push.apply(merged, orphanSpecials);
        merged.push.apply(merged, unnumbered);

        const results = [];
        let lastNumbered = 0;
        let specialOffset = 0;
        for (let i = 0; i < merged.length; i++) {
            const issue = merged[i];
            let chapterNum;
            if (!issue.isSpecial && issue.refNumber > 0) {
                chapterNum = issue.refNumber;
                lastNumbered = issue.refNumber;
                specialOffset = 0;
            } else {
                specialOffset += 1;
                const anchor = issue.refNumber > 0 ? issue.refNumber : lastNumbered;
                chapterNum = anchor + specialOffset * 0.1;
            }
            results.push([String(chapterNum), [{
                id: issue.id,
                title: issue.title,
                chapter: chapterNum
            }]]);
        }

        return { en: results };
    } catch (err) {
        return { en: [] };
    }
}

async function extractImages(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        // Scope to entry-content only. The featured-image block above it
        // reuses page 1's art under a filename that differs only by an
        // extra "-1" suffix, so a page-wide scan double-counts page 1.
        const startIdx = html.indexOf('<div class="entry-content"');
        const footerIdx = html.indexOf('<footer class="entry-meta"', startIdx === -1 ? 0 : startIdx);
        let scoped = html;
        if (startIdx !== -1) {
            scoped = footerIdx !== -1 ? html.substring(startIdx, footerIdx) : html.substring(startIdx);
        }

        const images = [];
        const seen = {};
        const imgRegex = /<img[^>]+src="([^"]+)"/g;
        let m;
        while ((m = imgRegex.exec(scoped)) !== null) {
            const src = m[1];
            if (src.indexOf("/wp-content/uploads/") === -1) continue;
            if (!/\.(webp|jpe?g|png)(\?.*)?$/i.test(src)) continue;

            const abs = toAbsolute(src);
            if (seen[abs]) continue;
            seen[abs] = true;
            images.push(abs);
        }

        return images;
    } catch (err) {
        return [];
    }
}
