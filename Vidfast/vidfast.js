async function searchResults(keyword) {
    try {
        let transformedResults = [];

        const keywordGroups = {
            trending: ["!trending", "!hot", "!tr", "!!"],
            topRatedMovie: ["!top-rated-movie", "!topmovie", "!tm", "??"],
            topRatedTV: ["!top-rated-tv", "!toptv", "!tt", "::"],
            popularMovie: ["!popular-movie", "!popmovie", "!pm", ";;"],
            popularTV: ["!popular-tv", "!poptv", "!pt", "++"],
        };

        const skipTitleFilter = Object.values(keywordGroups).flat();

        const shouldFilter = !matchesKeyword(keyword, skipTitleFilter);

        const encodedKeyword = encodeURIComponent(keyword);
        let baseUrlTemplate = null;

        if (matchesKeyword(keyword, keywordGroups.trending)) {
            baseUrlTemplate = (page) => `https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/trending/all/week?api_key=9801b6b0548ad57581d111ea690c85c8&include_adult=false&page=${page}`)}&simple=true`;
        } else if (matchesKeyword(keyword, keywordGroups.topRatedMovie)) {
            baseUrlTemplate = (page) => `https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/movie/top_rated?api_key=9801b6b0548ad57581d111ea690c85c8&include_adult=false&page=${page}`)}&simple=true`;
        } else if (matchesKeyword(keyword, keywordGroups.topRatedTV)) {
            baseUrlTemplate = (page) => `https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/tv/top_rated?api_key=9801b6b0548ad57581d111ea690c85c8&include_adult=false&page=${page}`)}&simple=true`;
        } else if (matchesKeyword(keyword, keywordGroups.popularMovie)) {
            baseUrlTemplate = (page) => `https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/movie/popular?api_key=9801b6b0548ad57581d111ea690c85c8&include_adult=false&page=${page}`)}&simple=true`;
        } else if (matchesKeyword(keyword, keywordGroups.popularTV)) {
            baseUrlTemplate = (page) => `https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/tv/popular?api_key=9801b6b0548ad57581d111ea690c85c8&include_adult=false&page=${page}`)}&simple=true`;
        } else {
            baseUrlTemplate = (page) => `https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/search/multi?api_key=9801b6b0548ad57581d111ea690c85c8&query=${encodedKeyword}&include_adult=false&page=${page}`)}&simple=true`;
        }

        let dataResults = [];

        if (baseUrlTemplate) {
            const pagePromises = Array.from({ length: 5 }, (_, i) =>
                soraFetch(baseUrlTemplate(i + 1)).then(r => r.json())
            );
            const pages = await Promise.all(pagePromises);
            dataResults = pages.flatMap(p => p.results || []);
        }

        if (dataResults.length > 0) {
            transformedResults = transformedResults.concat(
                dataResults
                    .map(result => {
                        if (result.media_type === "movie" || result.title) {
                            return {
                                title: result.title || result.name || result.original_title || result.original_name || "Untitled",
                                image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : "",
                                href: `movie/${result.id}`,
                            };
                        } else if (result.media_type === "tv" || result.name) {
                            return {
                                title: result.name || result.title || result.original_name || result.original_title || "Untitled",
                                image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : "",
                                href: `tv/${result.id}/1/1`,
                            };
                        }
                    })
                    .filter(Boolean)
                    .filter(result => result.title !== "Overflow")
                    .filter(result => result.title !== "My Marriage Partner Is My Student, a Cocky Troublemaker")
                    .filter(r => !shouldFilter || r.title.toLowerCase().includes(keyword.toLowerCase()))
            );
        }

        console.log("Transformed Results: " + JSON.stringify(transformedResults));
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("Fetch error in searchResults: " + error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

function matchesKeyword(keyword, commands) {
    const lower = keyword.toLowerCase();
    return commands.some(cmd => lower.startsWith(cmd.toLowerCase()));
}

async function extractDetails(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await soraFetch(`https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/movie/${movieId}?api_key=ad301b7cc82ffe19273e55e4d4206885`)}&simple=true`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.runtime ? data.runtime + " minutes" : 'Unknown'}`,
                airdate: `Released: ${data.release_date ? data.release_date : 'Unknown'}`
            }];

            return JSON.stringify(transformedResults);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await soraFetch(`https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/tv/${showId}?api_key=ad301b7cc82ffe19273e55e4d4206885`)}&simple=true`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.episode_run_time && data.episode_run_time.length ? data.episode_run_time.join(', ') + " minutes" : 'Unknown'}`,
                airdate: `Aired: ${data.first_air_date ? data.first_air_date : 'Unknown'}`
            }];

            console.log(JSON.stringify(transformedResults));
            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);

            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];

            const movie = [
                { href: `/movie/${movieId}`, number: 1, title: "Full Movie" }
            ];

            console.log(movie);
            return JSON.stringify(movie);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)\/([^\/]+)\/([^\/]+)/);

            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];

            const showResponseText = await soraFetch(`https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/tv/${showId}?api_key=ad301b7cc82ffe19273e55e4d4206885`)}&simple=true`);
            const showData = await showResponseText.json();

            let allEpisodes = [];
            for (const season of showData.seasons) {
                const seasonNumber = season.season_number;

                if (seasonNumber === 0) continue;

                const seasonResponseText = await soraFetch(`https://post-eosin.vercel.app/api/proxy?url=${encodeURIComponent(`https://api.themoviedb.org/3/tv/${showId}/season/${seasonNumber}?api_key=ad301b7cc82ffe19273e55e4d4206885`)}&simple=true`);
                const seasonData = await seasonResponseText.json();

                if (seasonData.episodes && seasonData.episodes.length) {
                    const episodes = seasonData.episodes.map(episode => ({
                        href: `/tv/${showId}/${seasonNumber}/${episode.episode_number}`,
                        number: episode.episode_number,
                        title: episode.name || ""
                    }));
                    allEpisodes = allEpisodes.concat(episodes);
                }
            }

            console.log(allEpisodes);
            return JSON.stringify(allEpisodes);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Fetch error in extractEpisodes: ' + error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(ID) {
    console.log("VidFast module v1.3.2 (soraFetch page + en|token regex)");
    const startTime = Date.now();

    if (ID.includes('movie')) {
        const tmdbID = ID.replace('/movie/', '');
        const headersOne = {
            "Content-Type": "application/json",
            "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2NTQ0MWU0MTg4NjhhMWI0NDZiM2I0Mzg1MmE4OWQ2NyIsIm5iZiI6MTYzMDg4NDI0My40NzMsInN1YiI6IjYxMzU1MTkzZmQ0YTk2MDA0NDVkMTJjNiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.Hm0W-hUx-7ph-ASvk2TpMxZbMtwVa5DEXWcgNgcqXJM",
            "Referer": "https://player.smashystream.com/",
            "Origin": "https://player.smashystream.com",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
        };
        const tmdbResponse = await fetchv2(`https://api.themoviedb.org/3/movie/${tmdbID}?append_to_response=external_ids`, headersOne);
        const tmdbData = await tmdbResponse.json();
        const imdbID = tmdbData.imdb_id;

        const streamResponse = await ilovefeet(imdbID, false, null, null, 'm3u8');

        const streamHeaders = {
            "Referer": "https://vidfast.vc/",
            "Origin": "https://vidfast.vc",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
        };

        const streams = [];

        // Main option: "Auto" when it's a master (player adapts across variants),
        // otherwise generic "1080p" for a single-rendition media playlist.
        if (streamResponse && streamResponse.defaultUrl) {
            const mainLabel = streamResponse.isMaster ? "Auto" : "1080p";
            streams.push({ title: mainLabel, streamUrl: streamResponse.defaultUrl, headers: streamHeaders });
        }

        const final = {
            streams: streams,
            subtitles: streamResponse.subtitles || ""
        };

        const endTime = Date.now();
        const elapsed = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`Stream fetched in ${elapsed}s`);

        console.log(JSON.stringify(final));
        return JSON.stringify(final);
    } else if (ID.includes('tv')) {
        const parts = ID.split('/');
        const tmdbID = parts[2];
        const seasonNumber = parts[3];
        const episodeNumber = parts[4];
        console.log(`TMDB ID: ${tmdbID}, Season: ${seasonNumber}, Episode: ${episodeNumber}`);
        const headersOne = {
            "Content-Type": "application/json",
            "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2NTQ0MWU0MTg4NjhhMWI0NDZiM2I0Mzg1MmE4OWQ2NyIsIm5iZiI6MTYzMDg4NDI0My40NzMsInN1YiI6IjYxMzU1MTkzZmQ0YTk2MDA0NDVkMTJjNiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.Hm0W-hUx-7ph-ASvk2TpMxZbMtwVa5DEXWcgNgcqXJM",
            "Referer": "https://player.smashystream.com/",
            "Origin": "https://player.smashystream.com",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
        };
        const tmdbResponse = await fetchv2(`https://api.themoviedb.org/3/tv/${tmdbID}?append_to_response=external_ids`, headersOne);
        const tmdbData = await tmdbResponse.json();
        const imdbID = tmdbData.external_ids.imdb_id;

        const streamResponse = await ilovefeet(imdbID, true, seasonNumber, episodeNumber, 'm3u8');

        const streamHeaders = {
            "Referer": "https://vidfast.vc/",
            "Origin": "https://vidfast.vc",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
        };

        const streams = [];

        // Main option: "Auto" when it's a master (player adapts across variants),
        // otherwise generic "1080p" for a single-rendition media playlist.
        if (streamResponse && streamResponse.defaultUrl) {
            const mainLabel = streamResponse.isMaster ? "Auto" : "1080p";
            streams.push({ title: mainLabel, streamUrl: streamResponse.defaultUrl, headers: streamHeaders });
        }

        const final = {
            streams: streams,
            subtitles: streamResponse.subtitles || ""
        };

        const endTime = Date.now();
        const elapsed = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`Stream fetched in ${elapsed}s`);

        console.log(JSON.stringify(final));
        return JSON.stringify(final);
    }
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? 'GET',
            options.body ?? null,
            true,
            options.encoding ?? 'utf-8'
        );
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}

async function ilovefeet(imdbId, isSeries = false, season = null, episode = null, preferredFormat = null) {
    let baseUrl;
    if (isSeries) {
        baseUrl = `https://vidfast.vc/tv/${imdbId}/${season}/${episode}`;
    } else {
        baseUrl = `https://vidfast.vc/movie/${imdbId}`;
    }

    const headers = {
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        "Referer": baseUrl,
        "X-Requested-With": "XMLHttpRequest"
    };

    console.log(`Requesting Base URL: ${baseUrl}`);
    const pageResponse = await soraFetch(baseUrl, { headers: headers });
    if (!pageResponse) {
        throw new Error('Page fetch returned no response');
    }
    const pageText = await pageResponse.text();

    let match = pageText.match(/\\"(?:en|token)\\":\\"([^"]+)\\"/) ||
        pageText.match(/"(?:en|token)":"([^"]+)"/) ||
        pageText.match(/'(?:en|token)':'([^']+)'/) ||
        pageText.match(/["'](?:en|token)["']:\s*["']([^"']+)["']/);

    if (!match) {
        console.log(`Could not find data in page (body length: ${pageText ? pageText.length : 0}, preview: ${pageText ? pageText.slice(0, 200) : "empty"})`);
        throw new Error('Could not find data in page');
    }
    const rawData = match[1];
    console.log("Raw Data extracted:", rawData);

    const apiUrl = `https://enc-dec.app/api/enc-vidfast?text=${encodeURIComponent(rawData)}&version=1`;
    console.log(`Requesting Decrypt API: ${apiUrl}`);
    const apiResponse = await soraFetch(apiUrl);
    const apiData = await apiResponse.json();
    console.log("API Data from enc-dec.app:", JSON.stringify(apiData));

    if (apiData.status !== 200 || !apiData.result) {
        throw new Error('Failed to decrypt data via enc-dec.app API');
    }

    const apiServers = apiData.result.servers;
    const streamBase = apiData.result.stream;
    const csrfToken = apiData.result.token;

    if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken;
    }

    console.log(`Requesting Servers URL: ${apiServers}`);
    const serversResponse = await soraFetch(apiServers, { method: 'POST', headers: headers });
    const serversEncrypted = await serversResponse.text();

    const decServersResponse = await soraFetch('https://enc-dec.app/api/dec-vidfast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: serversEncrypted, version: "1" })
    });
    const decServersData = await decServersResponse.json();

    if (decServersData.status !== 200 || !decServersData.result) {
        throw new Error('Failed to decrypt servers data via enc-dec.app API');
    }
    const serverList = decServersData.result;

    if (!serverList || serverList.length === 0) {
        throw new Error('No servers available');
    }

    const testServer = async (serverObj, index) => {
        const server = serverObj.data;
        const apiStream = streamBase + '/' + server;

        try {
            console.log(`Requesting Stream URL for server ${index}: ${apiStream}`);
            const streamResponse = await soraFetch(apiStream, { method: 'POST', headers: headers });
            if (!streamResponse) {
                throw new Error(`Server ${index} no response`);
            }

            const streamEncrypted = await streamResponse.text();
            if (!streamEncrypted || streamEncrypted.includes("Attention Required") || streamEncrypted.includes("Cloudflare")) {
                throw new Error(`Server ${index} empty or Cloudflare-blocked`);
            }

            const decStreamResponse = await soraFetch('https://enc-dec.app/api/dec-vidfast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: streamEncrypted, version: "1" })
            });
            const decStreamData = await decStreamResponse.json();

            if (decStreamData.status !== 200 || !decStreamData.result) {
                throw new Error(`Server ${index} failed to decrypt stream`);
            }

            let data = decStreamData.result;

            if (!data.url) {
                throw new Error(`Server ${index} has no URL`);
            }

            let format = data.url.includes('.m3u8') ? 'm3u8' : data.url.includes('.mpd') ? 'mpd' : 'unknown';

            const hasEnglishSubs = data.tracks && Array.isArray(data.tracks) &&
                data.tracks.some(track => track.label && track.label.toLowerCase().includes('english') && track.file);

            if (preferredFormat === 'm3u8') {
                if (format === 'mpd') {
                    data.url = data.url.replace('.mpd', '.m3u8');
                    format = 'm3u8';
                }

                if (format !== 'm3u8') {
                    throw new Error(`Server ${index} has unsupported format: ${format}`);
                }

                // Classify the playlist: a master lists multiple variants
                // (#EXT-X-STREAM-INF) and lets the player negotiate a compatible
                // codec/bitrate; a media playlist is a single locked rendition.
                // We also note (but do NOT reject on) a body that isn't a real
                // playlist — logging only, so a flaky classify fetch can never
                // drop an otherwise-working server.
                let isMaster = false;
                try {
                    const plResp = await soraFetch(data.url, {
                        method: 'GET',
                        headers: {
                            "Referer": "https://vidfast.vc/",
                            "Origin": "https://vidfast.vc",
                            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
                        }
                    });
                    if (plResp && typeof plResp.text === 'function') {
                        const plBody = await plResp.text();
                        if (plBody && plBody.indexOf('#EXT-X-STREAM-INF') !== -1) {
                            isMaster = true;
                        } else if (plBody && (plBody.indexOf('<html') !== -1 || plBody.indexOf('<!DOCTYPE') !== -1)) {
                            console.log(`Server ${index} warning: URL returned HTML, not a playlist`);
                        }
                    }
                } catch (e) {
                    // If we can't read it, treat as non-master; selection still works.
                    console.log(`Server ${index} playlist classify failed: ${e}`);
                }

                console.log(`Server ${index} ready: ${isMaster ? 'master' : 'media'} playlist`);
                return { index, server, success: true, format, data, preferred: true, hasSubtitles: hasEnglishSubs, isMaster };
            }

            return { index, server, success: true, format, data, preferred: false, hasSubtitles: hasEnglishSubs, isMaster: false };

        } catch (error) {
            throw new Error(`Server ${index} failed: ${error.message}`);
        }
    };

    let selectedServer = null;

    try {
        const serverPromises = serverList.map((serverObj, index) => testServer(serverObj, index));

        if (preferredFormat === 'm3u8') {
            // Prefer a master playlist (multi-quality + codec negotiation). Resolve the
            // instant a master appears; otherwise once all servers settle, take the first
            // working media playlist. Timer-free so it works across all JS engines
            // (Sora/Luna's engines don't provide setTimeout).
            selectedServer = await new Promise((resolve, reject) => {
                let settledCount = 0;
                let firstWorking = null;
                let done = false;

                const finish = (server) => {
                    if (done) return;
                    done = true;
                    resolve(server);
                };

                serverPromises.forEach(p => {
                    p.then(result => {
                        settledCount++;
                        if (result && result.success) {
                            if (result.isMaster) {
                                finish(result);
                                return;
                            }
                            if (!firstWorking || result.index < firstWorking.index) {
                                firstWorking = result;
                            }
                        }
                        if (settledCount === serverPromises.length && !done) {
                            if (firstWorking) finish(firstWorking);
                            else reject(new Error('No working servers found'));
                        }
                    }).catch(() => {
                        settledCount++;
                        if (settledCount === serverPromises.length && !done) {
                            if (firstWorking) finish(firstWorking);
                            else reject(new Error('No working servers found'));
                        }
                    });
                });
            });

            console.log(`Selected server ${selectedServer.index} (${selectedServer.isMaster ? 'master' : 'media'} playlist)`);
        } else {
            selectedServer = await Promise.any(serverPromises);
            console.log(`Selected first live server ${selectedServer.index} with format ${selectedServer.format}`);
        }
    } catch (error) {
        console.log('All servers failed: ' + error);
        throw new Error('No working servers found');
    }

    if (preferredFormat === 'm3u8' && selectedServer.format === 'mpd') {
        selectedServer.data.url = selectedServer.data.url.replace('.mpd', '.m3u8');
        selectedServer.format = 'm3u8';
    }

    let englishSubtitles = null;
    try {
        if (selectedServer.data.tracks && Array.isArray(selectedServer.data.tracks)) {
            const englishTrack = selectedServer.data.tracks.find(track =>
                track.label && track.label.toLowerCase().includes('english') && track.file
            );
            if (englishTrack) {
                englishSubtitles = englishTrack.file;
            } else {
                console.log('No English subtitle track found in tracks array');
            }
        } else {
            console.log('No tracks array found in server response');
        }
    } catch (error) {
        console.log('Error extracting subtitles:' + error);
    }

    return {
        defaultUrl: selectedServer.data.url,
        referer: baseUrl,
        format: selectedServer.format,
        isMaster: selectedServer.isMaster === true,
        subtitles: englishSubtitles
    };
}
