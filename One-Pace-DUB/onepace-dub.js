async function searchResults(keyword) {
    const results = [];
    const response = await soraFetch(`https://onepace.net/en/watch`);
    const html = await response.text();

    // First, extract all images in order
    const allImages = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/g)].map(m => m[1])
                      .concat([...html.matchAll(/background-image:\s*url\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
    
    const arcSections = html.split('<h2');
    
    results.push({
        title: "Use «all» or «everything» to get all content.",
        href: "",
        image: "https://git.luna-app.eu/ibro/services/raw/branch/main/onepace/onepaceEngInstructions.jpg"
    });

    // Process each arc section starting from index 1 (skip the first split result)
    for (let i = 1; i < arcSections.length; i++) {
        const currentSection = arcSections[i];
        
        // Extract title from current section
        const titleMatch = currentSection.match(/>([^<]+)<\/a>/);
        if (!titleMatch) continue;
        let arcTitle = titleMatch[1].trim()
            .replace(/&#x27;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"');
        
        // Get image for this arc - shifted by 1 to align correctly
        let arcImage = '';
        if (allImages[i]) {
            arcImage = allImages[i].replace(/&amp;/g, '&');
            if (arcImage.startsWith('/_next')) {
                arcImage = 'https://onepace.net' + arcImage;
            }
        }
        
        // For the last arc, use the last image from the array
        if (i === arcSections.length - 1 && allImages[0]) {
            arcImage = allImages[0].replace(/&amp;/g, '&');
            if (arcImage.startsWith('/_next')) {
                arcImage = 'https://onepace.net' + arcImage;
            }
        }

        const episodeBlocks = currentSection.split('<span class="flex-1">');
        for (let j = 1; j < episodeBlocks.length; j++) {
            const block = episodeBlocks[j];
            
            let type = '';
            let prefix = '';

            if (block.includes('English Dub with Closed Captions')) {
                type = 'English Dub with Closed Captions';
                prefix = '[CC] ';
                if (block.includes('Extended')) type += ', Extended';
                if (block.includes('Alternate')) type += ', Alternate';
            } else if (block.includes('English Dub')) {
                type = 'English Dub';
                prefix = '';
                if (block.includes('Extended')) type += ', Extended';
                if (block.includes('Alternate')) type += ', Alternate';
            } else {
                continue; // Skip subs and anything else
            }

            // Get quality-specific links
            let qualityLinks = new Map();
            const qualityMatches = [...block.matchAll(/>\s*(480p|720p|1080p)\s*</g)];
            const linkMatches = [...block.matchAll(/href="(https:\/\/pixeldrain\.net\/l\/[^"]+)"/g)];
            
            // Match links with qualities in order
            if (qualityMatches.length > 0 && linkMatches.length > 0) {
                const uniqueQualities = [...new Set(qualityMatches.map(m => m[1]))];
                uniqueQualities.forEach((quality, index) => {
                    if (index < linkMatches.length) {
                        qualityLinks.set(quality, linkMatches[index][1]);
                    }
                });
            }
            
            // Add entries for all found qualities
            for (const [quality, href] of qualityLinks) {
                const title = `${prefix}${arcTitle} - ${quality.trim()}`;
                if (!keyword || title.toLowerCase().includes(keyword.toLowerCase()) || 
                    keyword.toLowerCase() === 'all' || 
                    keyword.toLowerCase() === 'everything') {
                    results.push({
                        title: title,
                        href: href,
                        image: arcImage
                    });
                }
            }
        }
    }

    if (results.length === 1) {
        results.push({ title: "Romance Dawn - 1080p", href: "https://pixeldrain.net/l/pvG4Abkj", image: "https://onepace.co/wp-content/uploads/2025/09/Season-1-Romance-Dawn-ALT.jpg" });
        results.push({ title: "Romance Dawn - 720p", href: "https://pixeldrain.net/l/8tTqRmqz", image: "https://onepace.co/wp-content/uploads/2025/09/Season-1-Romance-Dawn-ALT.jpg" });
        results.push({ title: "Romance Dawn - 480p", href: "https://pixeldrain.net/l/ffUWgo1D", image: "https://onepace.co/wp-content/uploads/2025/09/Season-1-Romance-Dawn-ALT.jpg" });
        results.push({ title: "[CC] Romance Dawn - 1080p", href: "https://pixeldrain.net/l/wizeJCj9", image: "https://onepace.co/wp-content/uploads/2025/09/Season-1-Romance-Dawn-ALT.jpg" });
        results.push({ title: "[CC] Romance Dawn - 720p", href: "https://pixeldrain.net/l/Ari5Ky2Y", image: "https://onepace.co/wp-content/uploads/2025/09/Season-1-Romance-Dawn-ALT.jpg" });
        results.push({ title: "[CC] Romance Dawn - 480p", href: "https://pixeldrain.net/l/hC2wxGhk", image: "https://onepace.co/wp-content/uploads/2025/09/Season-1-Romance-Dawn-ALT.jpg" });

        results.push({ title: "Orange Town - 1080p", href: "https://pixeldrain.net/l/iaNhR5m9", image: "https://onepace.co/wp-content/uploads/2025/09/Season-2-Orange-Town-ALT.jpg" });
        results.push({ title: "Orange Town - 720p", href: "https://pixeldrain.net/l/15ZENNeo", image: "https://onepace.co/wp-content/uploads/2025/09/Season-2-Orange-Town-ALT.jpg" });
        results.push({ title: "Orange Town - 480p", href: "https://pixeldrain.net/l/SMYKttMf", image: "https://onepace.co/wp-content/uploads/2025/09/Season-2-Orange-Town-ALT.jpg" });

        results.push({ title: "Syrup Village - 1080p", href: "https://pixeldrain.net/l/tMvvu6Yq", image: "https://onepace.co/wp-content/uploads/2025/09/Season-3-Syrup-Village-ALT.jpg" });
        results.push({ title: "Syrup Village - 720p", href: "https://pixeldrain.net/l/YYUazeje", image: "https://onepace.co/wp-content/uploads/2025/09/Season-3-Syrup-Village-ALT.jpg" });
        results.push({ title: "Syrup Village - 480p", href: "https://pixeldrain.net/l/JVkHktvL", image: "https://onepace.co/wp-content/uploads/2025/09/Season-3-Syrup-Village-ALT.jpg" });

        results.push({ title: "Gaimon - 1080p", href: "https://pixeldrain.net/l/c9i2eVL5", image: "https://onepace.co/wp-content/uploads/2025/09/Season-4-Gaimon-ALT.jpg" });
        results.push({ title: "Gaimon - 720p", href: "https://pixeldrain.net/l/FV9EJ5ve", image: "https://onepace.co/wp-content/uploads/2025/09/Season-4-Gaimon-ALT.jpg" });
        results.push({ title: "Gaimon - 480p", href: "https://pixeldrain.net/l/dPtUZAyk", image: "https://onepace.co/wp-content/uploads/2025/09/Season-4-Gaimon-ALT.jpg" });

        results.push({ title: "Baratie - 1080p", href: "https://pixeldrain.net/l/ZwgqE6ar", image: "https://onepace.co/wp-content/uploads/2025/09/Season-5-Baratie-ALT.jpg" });
        results.push({ title: "Baratie - 720p", href: "https://pixeldrain.net/l/3LcuJRuQ", image: "https://onepace.co/wp-content/uploads/2025/09/Season-5-Baratie-ALT.jpg" });
        results.push({ title: "Baratie - 480p", href: "https://pixeldrain.net/l/2f85nrQt", image: "https://onepace.co/wp-content/uploads/2025/09/Season-5-Baratie-ALT.jpg" });

        results.push({ title: "Arlong Park - 1080p", href: "https://pixeldrain.net/l/w2hAukxX", image: "https://onepace.co/wp-content/uploads/2025/09/Season-6-Arlong-Park-ALT.jpg" });
        results.push({ title: "Arlong Park - 720p", href: "https://pixeldrain.net/l/7yQEMBFq", image: "https://onepace.co/wp-content/uploads/2025/09/Season-6-Arlong-Park-ALT.jpg" });
        results.push({ title: "Arlong Park - 480p", href: "https://pixeldrain.net/l/6azKaGxc", image: "https://onepace.co/wp-content/uploads/2025/09/Season-6-Arlong-Park-ALT.jpg" });
        results.push({ title: "Arlong Park Extended - 1080p", href: "https://pixeldrain.net/l/7zWaSGZv", image: "https://onepace.co/wp-content/uploads/2025/09/Season-6-Arlong-Park-ALT.jpg" });
        results.push({ title: "Arlong Park Extended - 720p", href: "https://pixeldrain.net/l/jBLrC2Zq", image: "https://onepace.co/wp-content/uploads/2025/09/Season-6-Arlong-Park-ALT.jpg" });
        results.push({ title: "Arlong Park Extended - 480p", href: "https://pixeldrain.net/l/KL51iUeH", image: "https://onepace.co/wp-content/uploads/2025/09/Season-6-Arlong-Park-ALT.jpg" });

        results.push({ title: "The Adventures of Buggy's Crew - 720p", href: "https://pixeldrain.net/l/MbJLcYcA", image: "https://onepace.co/wp-content/uploads/2025/09/Season-7-The-Adventures-of-Buggys-Crew-ALT.jpg" });

        results.push({ title: "Loguetown - 480p", href: "https://pixeldrain.net/l/TBaw1Tp6", image: "https://onepace.co/wp-content/uploads/2025/09/Season-8-Loguetown-ALT-2.jpg" });

        results.push({ title: "Reverse Mountain - 720p", href: "https://pixeldrain.net/l/s4DEnuS5", image: "https://onepace.co/wp-content/uploads/2025/09/Season-9-Reverse-Mountain-ALT-2.jpg" });

        results.push({ title: "The Trials of Koby-Meppo - 720p", href: "https://pixeldrain.net/l/b9XwPSBA", image: "https://onepace.co/wp-content/uploads/2025/09/Season-11-The-Trials-of-Koby-Meppo-ALT.jpg" });

        results.push({ title: "Little Garden - 1080p", href: "https://pixeldrain.net/l/SrFc5Em4", image: "https://onepace.co/wp-content/uploads/2025/09/Season-12-Little-Garden-ALT-2.jpg" });
        results.push({ title: "Little Garden - 720p", href: "https://pixeldrain.net/l/G6P9DNFe", image: "https://onepace.co/wp-content/uploads/2025/09/Season-12-Little-Garden-ALT-2.jpg" });
        results.push({ title: "Little Garden - 480p", href: "https://pixeldrain.net/l/ABkpM5Nr", image: "https://onepace.co/wp-content/uploads/2025/09/Season-12-Little-Garden-ALT-2.jpg" });

        results.push({ title: "Drum Island - 720p", href: "https://pixeldrain.net/l/f4Kt9jzH", image: "https://onepace.co/wp-content/uploads/2025/09/Season-13-Drum-Island-ALT-2.jpg" });

        results.push({ title: "Alabasta - 1080p", href: "https://pixeldrain.net/l/TYiY6GU4", image: "https://onepace.co/wp-content/uploads/2025/09/Season-14-Alabasta-ALT.jpg" });
        results.push({ title: "Alabasta - 720p", href: "https://pixeldrain.net/l/9MzVKBPD", image: "https://onepace.co/wp-content/uploads/2025/09/Season-14-Alabasta-ALT.jpg" });
        results.push({ title: "Alabasta - 480p", href: "https://pixeldrain.net/l/9Y5TEMdV", image: "https://onepace.co/wp-content/uploads/2025/09/Season-14-Alabasta-ALT.jpg" });

        results.push({ title: "Jaya - 720p", href: "https://pixeldrain.net/l/mo4QoCFk", image: "https://onepace.co/wp-content/uploads/2025/09/Season-15-Jaya-ALT-2.jpg" });

        results.push({ title: "Skypiea - 1080p", href: "https://pixeldrain.net/l/HsuguvD3", image: "https://onepace.co/wp-content/uploads/2025/09/Season-16-Skypiea-ALT.jpg" });
        results.push({ title: "Skypiea - 720p", href: "https://pixeldrain.net/l/AeNHWRGL", image: "https://onepace.co/wp-content/uploads/2025/09/Season-16-Skypiea-ALT.jpg" });
        results.push({ title: "Skypiea - 480p", href: "https://pixeldrain.net/l/cqahHH4y", image: "https://onepace.co/wp-content/uploads/2025/09/Season-16-Skypiea-ALT.jpg" });
        results.push({ title: "Skypiea Alternate (G-8) - 1080p", href: "https://pixeldrain.net/l/7MkvW5o9", image: "https://onepace.co/wp-content/uploads/2025/09/Season-16-Skypiea-ALT.jpg" });
        results.push({ title: "Skypiea Alternate (G-8) - 720p", href: "https://pixeldrain.net/l/g4sDD6fM", image: "https://onepace.co/wp-content/uploads/2025/09/Season-16-Skypiea-ALT.jpg" });
        results.push({ title: "Skypiea Alternate (G-8) - 480p", href: "https://pixeldrain.net/l/xKt2ijfA", image: "https://onepace.co/wp-content/uploads/2025/09/Season-16-Skypiea-ALT.jpg" });

        results.push({ title: "Long Ring Long Land - 1080p", href: "https://pixeldrain.net/l/DK165Lfd", image: "https://onepace.co/wp-content/uploads/2025/09/Season-17-Long-Ring-Long-Land-ALT-2.jpg" });
        results.push({ title: "Long Ring Long Land - 720p", href: "https://pixeldrain.net/l/kTb436Vv", image: "https://onepace.co/wp-content/uploads/2025/09/Season-17-Long-Ring-Long-Land-ALT-2.jpg" });
        results.push({ title: "Long Ring Long Land - 480p", href: "https://pixeldrain.net/l/qe6NsBnd", image: "https://onepace.co/wp-content/uploads/2025/09/Season-17-Long-Ring-Long-Land-ALT-2.jpg" });

        results.push({ title: "Water Seven - 720p", href: "https://pixeldrain.net/l/59HCmx6N", image: "https://onepace.co/wp-content/uploads/2025/09/Season-18-Water-Seven-ALT.jpg" });

        results.push({ title: "Enies Lobby - 720p", href: "https://pixeldrain.net/l/mUdZdtXz", image: "https://onepace.co/wp-content/uploads/2025/09/Season-19-Enies-Lobby-ALT.jpg" });

        results.push({ title: "If You Could Go Anywhere... The Adventures of the Straw Hats - 720p", href: "https://pixeldrain.net/l/enZf6R88", image: "https://onepace.co/wp-content/uploads/2025/09/Season-25-If-You-Could-Go-Anywhere.-The-Adventures-of-the-Straw-Hats-ALT.jpg" });

        results.push({ title: "Post-War - 720p", href: "https://pixeldrain.net/l/WjxroZSq", image: "https://onepace.co/wp-content/uploads/2025/09/Season-27-Post-War-ALT.jpg" });

        results.push({ title: "Return to Sabaody - 720p", href: "https://pixeldrain.net/l/JNBvnBsg", image: "https://onepace.co/wp-content/uploads/2025/09/Season-28-Return-to-Sabaody-ALT.jpg" });

        results.push({ title: "Reverie - 1080p", href: "https://pixeldrain.net/l/HgqaUnRr", image: "https://onepace.co/wp-content/uploads/2025/09/Season-34-Reverie-ALT.jpg" });
        results.push({ title: "Reverie - 720p", href: "https://pixeldrain.net/l/zrfn5Vor", image: "https://onepace.co/wp-content/uploads/2025/09/Season-34-Reverie-ALT.jpg" });
        results.push({ title: "Reverie - 480p", href: "https://pixeldrain.net/l/WU4pgbvE", image: "https://onepace.co/wp-content/uploads/2025/09/Season-34-Reverie-ALT.jpg" });

        results.push({ title: "Wano - 1080p", href: "https://pixeldrain.net/l/ce5RfrJA", image: "https://onepace.co/wp-content/uploads/2025/09/Season-35-Wano-ALT.jpg" });
        results.push({ title: "Wano - 720p", href: "https://pixeldrain.net/l/1vPgfM3y", image: "https://onepace.co/wp-content/uploads/2025/09/Season-35-Wano-ALT.jpg" });
        results.push({ title: "Wano - 480p", href: "https://pixeldrain.net/l/teLAJnPL", image: "https://onepace.co/wp-content/uploads/2025/09/Season-35-Wano-ALT.jpg" });
        results.push({ title: "Wano Extended - 1080p", href: "https://pixeldrain.net/l/AgcNBUKh", image: "https://onepace.co/wp-content/uploads/2025/09/Season-35-Wano-ALT.jpg" });
        results.push({ title: "Wano Extended - 720p", href: "https://pixeldrain.net/l/6YpD1oDY", image: "https://onepace.co/wp-content/uploads/2025/09/Season-35-Wano-ALT.jpg" });
        results.push({ title: "Wano Extended - 480p", href: "https://pixeldrain.net/l/mtAAKA4Q", image: "https://onepace.co/wp-content/uploads/2025/09/Season-35-Wano-ALT.jpg" });

        results.push({ title: "Egghead - 1080p", href: "https://pixeldrain.net/l/G2iWxohw", image: "https://onepace.co/wp-content/uploads/2025/09/Season-36-Egghead-ALT.jpg" });
        results.push({ title: "Egghead - 720p", href: "https://pixeldrain.net/l/nKTEVT1f", image: "https://onepace.co/wp-content/uploads/2025/09/Season-36-Egghead-ALT.jpg" });
        results.push({ title: "Egghead - 480p", href: "https://pixeldrain.net/l/gZQ7qeUt", image: "https://onepace.co/wp-content/uploads/2025/09/Season-36-Egghead-ALT.jpg" });
        results.push({ title: "Egghead Extended - 1080p", href: "https://pixeldrain.net/l/7eicwoJt", image: "https://onepace.co/wp-content/uploads/2025/09/Season-36-Egghead-ALT.jpg" });
        results.push({ title: "Egghead Extended - 720p", href: "https://pixeldrain.net/l/MTiCn7cK", image: "https://onepace.co/wp-content/uploads/2025/09/Season-36-Egghead-ALT.jpg" });
        results.push({ title: "Egghead Extended - 480p", href: "https://pixeldrain.net/l/CLnfKrsG", image: "https://onepace.co/wp-content/uploads/2025/09/Season-36-Egghead-ALT.jpg" });
    }
    
    console.log(`Results: ${JSON.stringify(results)}`);
    return JSON.stringify(results);
}

async function extractDetails(url) {
    const match = url.match(/https:\/\/pixeldrain\.net\/l\/([^\/]+)/);
    if (!match) throw new Error("Invalid URL format");
            
    const arcId = match[1];

    const response = await soraFetch(`https://pixeldrain.net/api/list/${arcId}`);
    const data = await response.json();    

    const transformedResults = [{
        description: `Title: ${data.title}\nFile Count: ${data.file_count}`,
        aliases: `Title: ${data.title}\nFile Count: ${data.file_count}`,
        airdate: ''
    }];

    console.log(`Details: ${JSON.stringify(transformedResults)}`);
    return JSON.stringify(transformedResults);
}

async function extractEpisodes(url) {
    const match = url.match(/https:\/\/pixeldrain\.net\/l\/([^\/]+)/);
    if (!match) throw new Error("Invalid URL format");
            
    const arcId = match[1];

    const response = await soraFetch(`https://pixeldrain.net/api/list/${arcId}`);
    const data = await response.json();

    const transformedResults = data.files.map((result, index) => {
        return {
            href: `${result.id}`,
            number: index + 1,
        };
    });

    console.log(`Episodes: ${JSON.stringify(transformedResults)}`);
    return JSON.stringify(transformedResults);
}

async function extractStreamUrl(url) {
    return `https://pixeldrain.net/api/file/${url}?download`;
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null }) {
    try {
        return await fetchv2(url, options.headers ?? {}, options.method ?? 'GET', options.body ?? null);
    } catch(e) {
        try {
            return await fetch(url, options);
        } catch(error) {
            return null;
        }
    }
}
