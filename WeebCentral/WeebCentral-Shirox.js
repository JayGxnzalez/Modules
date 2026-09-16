async function searchResults(keyword, page=0) {
    const results = [];
    try {
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded"
        };
        const postData = `text=${encodeURIComponent(keyword)}`;

        const response = await fetch(`https://weebcentral.com/search/simple?location=main`, {
            method: "POST",
            headers: headers,
            body: postData
        });

        const html = await response.text();
        const regex = /<a href="([^"]+)"[^>]*>[\s\S]*?<source srcset="([^"]+)"[^>]*>[\s\S]*?<div class="flex-1[^"]*">([^<]+)<\/div>/g;

        let match;
        while ((match = regex.exec(html)) !== null) {
            results.push({
                id: match[1].trim(),
                imageURL: match[2].trim(),
                title: match[3].trim().replace(/&#39;/g, "'")
            });
        }

        return results;
    } catch (err) {
        return [];
    }
}

async function extractDetails(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();
        
        const descMatch = html.match(/<strong>Description<\/strong>\s*<p class="whitespace-pre-wrap break-words">([\s\S]*?)<\/p>/);
        const description = descMatch ? descMatch[1].trim().replace(/&#39;/g, "'") : "";
        
        const tagsMatch = html.match(/<strong>Associated Name\(s\)<\/strong>\s*<ul class="list-disc list-inside">([\s\S]*?)<\/ul>/);
        let tags = [];
        if (tagsMatch) {
            const ulContent = tagsMatch[1];
            const liRegex = /<li>([^<]+)<\/li>/g;
            let liMatch;
            while ((liMatch = liRegex.exec(ulContent)) !== null) {
                tags.push(liMatch[1].trim().replace(/&#39;/g, "'"));
            }
        }
        
        return {
            description,
            tags
        };
    } catch (err) {
        return {
            description: "Error",
            tags: []
        };
    }
}

async function extractChapters(url) {
    const results = [];
    try {
        const fullUrl = url.replace(/\/[^/]+$/, "/full-chapter-list");
        const response = await fetch(fullUrl);
        const html = await response.text();
        
        const regex = /<div class="flex items-center"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<span class="">([^<]+)<\/span>/g;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            let chapterUrl = match[1].trim();
            if (chapterUrl && !chapterUrl.startsWith("http")) {
                chapterUrl = "https://weebcentral.com" + chapterUrl;
            }
            const title = match[2].trim();
            const chapterNum = parseInt(title.split(' ')[1]);
            
            results.push([
                String(chapterNum),
                [{
                    id: chapterUrl,
                    title: title,
                    chapter: chapterNum,
                    scanlation_group: ""
                }]
            ]);
        }

        return { en: results };
    } catch (err) {
        return { en: [] };
    }
}

async function extractImages(url) {
    const results = [];
    try {
        const fullUrl = url + "/images?is_prev=False&current_page=1&reading_style=long_strip";
        const response = await fetch(fullUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
            }
        });
        const html = await response.text();
        
        const regex = /<img[^>]+src="([^"]+)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            results.push(match[1].trim());
        }

        return results;
    } catch (err) {
        return [];
    }
}
