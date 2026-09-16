// KanzenBundle.htmlparse2
// KanzenBundle.cssSelect
const baseUrl = `https://weebcentral.com`

async function searchContent(input,page=0)
{ 

    const url =     `${baseUrl}/search/data?limit=${32}&offset=${page*32}&text=${input}&sort=Best+Match&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Full+Display`
    const response = await fetch(url, {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        Referer: "https://weebcentral.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
        
      },)
    const text = await response.text()
    const dom = KanzenBundle.htmlparser2.parseDocument(text)
    return parseSearchContent(dom)
}
async function getContentData(id) {
    console.log("id is ")
    console.log(id)
    const url = `${id}`
    const response = await fetch(url)
    const text = await response.text()
    const dom = KanzenBundle.htmlparser2.parseDocument(text)
    const output = parseContentData(dom)
    return output

    
}
async function getChapters(id) {
    const url = `${id}/full-chapter-list`
    const response = await fetch(url)
    const text = await response.text()
    const dom = KanzenBundle.htmlparser2.parseDocument(text)
    const chapters = parseChapters(dom)
    return chapters
}
async function getChapterImages(params) {
    const url = `${params}/images?is_prev=False&current_page=1&reading_style=long_strip`
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
            }
        })
        console.log("status: " + response.status)
        const text = await response.text()
        console.log("text length: " + text.length)
        const dom = KanzenBundle.htmlparser2.parseDocument(text)
        const arr = parseChapterImages(dom)
        return arr
    } catch (e) {
        console.log("ERROR: " + e.message)
        return []
    }
}
//util Functions
function parseSearchContent(dom)
{
    const articles = KanzenBundle.cssSelect.selectAll('article', dom);
// Emulate :has(section)
const withSection = articles.filter(article =>
  KanzenBundle.cssSelect.selectAll('section', article).length > 0

);

return withSection.map(ele=>{
            //title
        const titleMatches = KanzenBundle.cssSelect.selectAll("section:nth-of-type(2) a", ele);
        const title = getText(titleMatches[0])
        //img
         const imgMatches = KanzenBundle.cssSelect.selectAll("img",ele)
         const img = imgMatches[0].attribs?.src
        //id
        const id = titleMatches[0].attribs?.href.split("/").slice(0, -1).join("/")
       return  {'title': title,'id': id,'imageURL': img} 
})
}

function parseContentData(dom){
    const obj = {}
    //Description
    const descriptionNode = KanzenBundle.cssSelect.selectAll("li > p", dom)
    let description = ""
    for (const p of descriptionNode) {
        // find its previous sibling <strong> and check text manually
        const strong = KanzenBundle.cssSelect.selectOne("strong", p.parent);
        if (strong && strong.children?.[0]?.data?.includes("Description")) {
            description = p.children?.[0]?.data ?? "";
            break;
        }
    }

    //Tags
    const { selectOne, selectAll } = KanzenBundle.cssSelect;
    // Find the li with "Tags(s):" strong tag
    const tagLi = selectAll('li', dom).find((li) => {
    const strong = li.children.find(
        (child) => child.type === 'tag' && child.name === 'strong'
    );
    return strong && getText(strong).includes('Tag');
    });

    // Extract genre links from that li
    const genres = tagLi
    ? selectAll('a', tagLi).map((a) => getText(a))
    : [];
    obj['tags'] = genres
    obj['description'] = description
    return obj
}

function parseChapters(dom){
   const  chapterObj = {}
    var chapterNodes = KanzenBundle.cssSelect.selectAll("div[x-data] > a", dom);
    chapterNodes = chapterNodes.reverse()
    let chapters = []
    for(let x = 0; x < chapterNodes.length; x = x + 1)
        {
            const titleNode = KanzenBundle.cssSelect.selectAll("span.flex > span", chapterNodes[x]);
            const text = getText(titleNode[0])
            //console.log(text)
            let href = chapterNodes[x].attribs?.href ?? "";
            if (href && !href.startsWith("http")) {
                href = baseUrl + href
            }
            chapterData = {"id":href,"scanlation_group":"Weeb Central","title":text}
            
            chapters.push([chapterData])
            //console.log([(chapterNodes.length - x),chapterData])
        }
    chapterObj["eng"] = chapters
                 for (const key in chapterObj)
    {
      chapterObj[key] = Object.entries(chapterObj[key])
  .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    }
    return chapterObj
}

function parseChapterImages(dom){
    const imgs = KanzenBundle.cssSelect.selectAll('section.flex > img', dom);
    const imgUrl = []
    console.log(imgs.length)
// 3️⃣ Work with results
for (const img of imgs) {
  console.log(img.attribs.src);
  imgUrl.push(img.attribs.src)
}
return imgUrl
}

function getText(node) {
  if (!node) return "";
  if (node.type === "text") return node.data;
  if (Array.isArray(node.children)) {
    return node.children.map(getText).join("");
  }
  return "";
}
//searchContent("btooom").then( x => { console.log(x[0]);getChapters(x[0]['id']).then( x => { getChapterImages(x["eng"][0][1][0]["id"]).then(console.log) }) })
