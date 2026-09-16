// AllManga (SUB) Module
// Pure JS AES-256-GCM decryption + aaReq auth + clock.json resolution + subtitle extraction

var ALLANIME_API = 'https://api.allanime.day/api';
var ALLANIME_REFR = 'https://mkissa.to';
var ALLANIME_KEY = 'a254aa27c410f297bd04ba33a0c0df7ff4e706bf3ae27271c6703f84e750f552';
var ALLANIME_W = null;
var ALLANIME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
var SEARCH_HASH = 'a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c';
var EPISODES_HASH = '043448386c7a686bc2aabfbb6b80f6074e795d350df48015023b079527b0848a';
var SOURCES_HASH = 'd405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec';

var HEADERS = {
    'User-Agent': ALLANIME_UA,
    'Origin': ALLANIME_REFR,
    'Referer': ALLANIME_REFR + '/'
};

var SOURCES_HEADERS = {
    'User-Agent': ALLANIME_UA,
    'Origin': 'https://youtu-chan.com',
    'Referer': 'https://youtu-chan.com'
};

var HEX_MAP = {
    '79':'A','7a':'B','7b':'C','7c':'D','7d':'E','7e':'F','7f':'G','70':'H','71':'I','72':'J',
    '73':'K','74':'L','75':'M','76':'N','77':'O','68':'P','69':'Q','6a':'R','6b':'S','6c':'T',
    '6d':'U','6e':'V','6f':'W','60':'X','61':'Y','62':'Z','59':'a','5a':'b','5b':'c','5c':'d',
    '5d':'e','5e':'f','5f':'g','50':'h','51':'i','52':'j','53':'k','54':'l','55':'m','56':'n',
    '57':'o','48':'p','49':'q','4a':'r','4b':'s','4c':'t','4d':'u','4e':'v','4f':'w','40':'x',
    '41':'y','42':'z','08':'0','09':'1','0a':'2','0b':'3','0c':'4','0d':'5','0e':'6','0f':'7',
    '00':'8','01':'9','15':'-','16':'.','67':'_','46':'~','02':':','17':'/','07':'?','1b':'#',
    '63':'[','65':']','78':'@','19':'!','1c':'$','1e':'&','10':'(','11':')','12':'*','13':'+',
    '14':',','03':';','05':'=','1d':'%'
};

var SBOX = [
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];

// aaReq credential cache
var aaCreds = null;
var aaCredsTime = 0;
var aaCredsPromise = null;

function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) bytes[i/2] = parseInt(hex.substr(i,2),16);
    return bytes;
}

function base64ToBytes(b64) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var str = String(b64).replace(/=+$/, '');
    var output = new Uint8Array(Math.floor(str.length * 3 / 4) + 3);
    var bc = 0, bs = 0, idx = 0;
    for (var i = 0; i < str.length; i++) {
        var buffer = chars.indexOf(str.charAt(i));
        if (~buffer) {
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4) output[idx++] = 255 & bs >> (-2 * bc & 6);
        }
    }
    return output.slice(0, idx);
}

function bytesToBase64(bytes) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var result = '';
    for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i], b1 = bytes[i+1] || 0, b2 = bytes[i+2] || 0;
        result += chars[b0 >> 2];
        result += chars[((b0 & 3) << 4) | (b1 >> 4)];
        result += i+1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
        result += i+2 < bytes.length ? chars[b2 & 63] : '=';
    }
    return result;
}

function xtime(a) { return ((a<<1)^(a&0x80?0x1b:0))&0xff; }
function aesSubBytes(s){for(var i=0;i<16;i++)s[i]=SBOX[s[i]];}
function aesShiftRows(s){var t;t=s[1];s[1]=s[5];s[5]=s[9];s[9]=s[13];s[13]=t;t=s[2];s[2]=s[10];s[10]=t;t=s[6];s[6]=s[14];s[14]=t;t=s[15];s[15]=s[11];s[11]=s[7];s[7]=s[3];s[3]=t;}
function aesMixColumns(s){for(var i=0;i<16;i+=4){var s0=s[i],s1=s[i+1],s2=s[i+2],s3=s[i+3],h=s0^s1^s2^s3;s[i]^=h^xtime(s0^s1);s[i+1]^=h^xtime(s1^s2);s[i+2]^=h^xtime(s2^s3);s[i+3]^=h^xtime(s3^s0);}}
function aesAddRoundKey(s,w,r){for(var i=0;i<16;i++)s[i]^=w[r*16+i];}

function aesKeyExpansion(key) {
    var RCON=[0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
    var w=new Uint8Array(240); w.set(key);
    for(var i=8;i<60;i++){var t=w.slice((i-1)*4,i*4);
    if(i%8===0)t=new Uint8Array([SBOX[t[1]]^RCON[i/8-1],SBOX[t[2]],SBOX[t[3]],SBOX[t[0]]]);
    else if(i%8===4)t=new Uint8Array([SBOX[t[0]],SBOX[t[1]],SBOX[t[2]],SBOX[t[3]]]);
    for(var j=0;j<4;j++)w[i*4+j]=w[(i-8)*4+j]^t[j];}
    return w;
}

function aesEncryptBlock(block, w) {
    var s=new Uint8Array(block); aesAddRoundKey(s,w,0);
    for(var r=1;r<14;r++){aesSubBytes(s);aesShiftRows(s);aesMixColumns(s);aesAddRoundKey(s,w,r);}
    aesSubBytes(s);aesShiftRows(s);aesAddRoundKey(s,w,14); return s;
}

function aesGcmDecrypt(ciphertextWithTag, keyHex, iv) {
    if(!ALLANIME_W) ALLANIME_W = aesKeyExpansion(hexToBytes(keyHex));
    var w=ALLANIME_W, ctLen=ciphertextWithTag.length-16, ciphertext=ciphertextWithTag.slice(0,ctLen);
    var j0=new Uint8Array(16); for(var i=0;i<12;i++)j0[i]=iv[i]; j0[15]=1;
    var plaintext=new Uint8Array(ciphertext.length);
    for(var pos=0;pos<ciphertext.length;pos+=16){
        var ctr=new Uint8Array(j0), blockNum=Math.floor(pos/16)+2;
        ctr[12]=(blockNum>>>24)&0xff;ctr[13]=(blockNum>>>16)&0xff;ctr[14]=(blockNum>>>8)&0xff;ctr[15]=blockNum&0xff;
        var keystream=aesEncryptBlock(ctr,w), blockSize=Math.min(16,ciphertext.length-pos);
        for(var k=0;k<blockSize;k++)plaintext[pos+k]=ciphertext[pos+k]^keystream[k];
    }
    return plaintext;
}

function decodeTobeparsed(tobeparsed, keyHex) {
    try {
        var b64=tobeparsed, pad=b64.length%4;
        if(pad) b64+='===='.slice(pad);
        var data=base64ToBytes(b64), iv=data.slice(1,13), ct=data.slice(13);
        var plain=aesGcmDecrypt(ct, keyHex || ALLANIME_KEY, iv);
        var result=''; for(var i=0;i<plain.length;i++) result+=String.fromCharCode(plain[i]);
        try{return decodeURIComponent(escape(result));}catch(e){return result;}
    } catch(e) { return null; }
}

function decodeProviderUrl(encoded) {
    if(encoded.indexOf('--')!==0) return encoded;
    var hex=encoded.slice(2), result='';
    for(var i=0;i<hex.length;i+=2) result+=HEX_MAP[hex.substr(i,2)]||'';
    return result.replace('/clock','/clock.json');
}

async function soraFetch(url, options) {
    options = options || { headers:{}, method:'GET', body:null };
    try {
        if(typeof fetchv2!=='undefined') return await fetchv2(url,options.headers||{},options.method||'GET',options.body||null,true,options.encoding||'utf-8');
        return await fetch(url, options);
    } catch(e) { try{return await fetch(url,options);}catch(err){return null;} }
}

// aaReq generation using pure JS crypto (no crypto.subtle)
async function fetchCreds() {
    try {
        var bootstrapRes = await soraFetch('https://api.allanime.day/client-crypto/v1/bootstrap?buildId=13', {
            method: 'GET',
            headers: { 'User-Agent': ALLANIME_UA, 'x-build-id': '13', 'Origin': ALLANIME_REFR, 'Referer': ALLANIME_REFR + '/' }
        });
        var epoch = null, partB = null;
        if (bootstrapRes) {
            var bText = typeof bootstrapRes.text === 'function' ? await bootstrapRes.text() : null;
            if (bText) {
                try {
                    var bJson = JSON.parse(bText);
                    epoch = bJson.epoch !== undefined ? String(bJson.epoch) : null;
                    partB = bJson.partB || null;
                } catch(e) {}
            }
        }

        if (!epoch || !partB) {
            var res = await soraFetch(ALLANIME_REFR, { method: 'GET', headers: { 'User-Agent': ALLANIME_UA } });
            if (res) {
                var html = typeof res.text === 'function' ? await res.text() : null;
                if (html) {
                    var epochMatch = html.match(/"epoch":(\d+)/);
                    if (!epoch) epoch = epochMatch ? epochMatch[1] : null;
                    var partBMatch = html.match(/"partB":"([^"]+)"/);
                    if (!partB) partB = partBMatch ? partBMatch[1] : null;
                }
            }
        }

        var htmlRes = await soraFetch(ALLANIME_REFR, { method: 'GET', headers: { 'User-Agent': ALLANIME_UA } });
        if (!htmlRes) return null;
        var html = typeof htmlRes.text === 'function' ? await htmlRes.text() : null;
        if (!html) return null;
        var appjsMatch = html.match(/https:\/\/cdn\.allanime\.day\/all\/mk\/_app\/immutable\/entry\/app\.[^"']+\.js/);
        var appjsUrl = appjsMatch ? appjsMatch[0] : null;

        if (!epoch || !partB || !appjsUrl) {
            console.log('fetchCreds: missing epoch/partB/appjs epoch=' + epoch + ' partB=' + (partB||'null').substring(0,10) + ' appjs=' + !!appjsUrl);
            return null;
        }

        var appRes = await soraFetch(appjsUrl, { method: 'GET', headers: { 'User-Agent': ALLANIME_UA } });
        if (!appRes) return null;
        var appText = typeof appRes.text === 'function' ? await appRes.text() : null;
        if (!appText) return null;

        var chunkMatch = appText.match(/from\s*["']\.\.(\/chunks\/[^"'\s]+?\.[a-z0-9]+)["']\s*;\s*import/i);
        var chunkPath = chunkMatch ? chunkMatch[1] : null;
        if (!chunkPath) {
            console.log('fetchCreds: missing chunk path');
            return null;
        }

        var chunkUrl = 'https://cdn.allanime.day/all/mk/_app/immutable' + chunkPath;
        var chunkRes = await soraFetch(chunkUrl, { method: 'GET', headers: { 'User-Agent': ALLANIME_UA } });
        if (!chunkRes) return null;
        var chunkText = typeof chunkRes.text === 'function' ? await chunkRes.text() : null;
        if (!chunkText) return null;

        var maskMatch = chunkText.match(/[0-9a-f]{64}/i);
        var mask = maskMatch ? maskMatch[0] : null;
        var buildIdMatch = chunkText.match(/[0-9a-f]{64}[^;]*?"(\d+)"/i);
        var buildId = buildIdMatch ? buildIdMatch[1] : null;

        if (!mask || !buildId) {
            console.log('fetchCreds: missing mask/buildId');
            return null;
        }

        console.log('fetchCreds: ok epoch=' + epoch + ' buildId=' + buildId);
        return { epoch: epoch, partB: partB, mask: mask, buildId: buildId };
    } catch(e) {
        return null;
    }
}

async function getCreds() {
    var now = Date.now();
    if (aaCreds && (now - aaCredsTime < 300000)) return aaCreds;
    if (!aaCredsPromise) {
        aaCredsPromise = fetchCreds().then(function(c) {
            if (c) { aaCreds = c; aaCredsTime = Date.now(); }
            aaCredsPromise = null;
            return c;
        });
    }
    return aaCredsPromise;
}

function deriveAaKey(creds) {
    try {
        var maskBytes = hexToBytes(creds.mask);
        var partBBytes = base64ToBytes(creds.partB);
        var key = new Uint8Array(32);
        for (var i = 0; i < 32; i++) key[i] = partBBytes[i] ^ maskBytes[i % maskBytes.length];
        return key;
    } catch(e) { return null; }
}

function puresha256(strInput) {
    var bytes = stringToUtf8Bytes(strInput);
    var hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var l = bytes.length;
    var words = new Uint32Array((((l+8)>>6)+1)<<4);
    for(var i=0;i<l;i++) words[i>>2]|=bytes[i]<<(24-(i&3)*8);
    words[l>>2]|=0x80<<(24-(l&3)*8);
    words[words.length-1]=l*8;
    var w=new Uint32Array(64);
    for(var i=0;i<words.length;i+=16){
        for(var j=0;j<16;j++) w[j]=words[i+j];
        for(var j=16;j<64;j++){var s0=((w[j-15]>>>7)|(w[j-15]<<25))^((w[j-15]>>>18)|(w[j-15]<<14))^(w[j-15]>>>3);var s1=((w[j-2]>>>17)|(w[j-2]<<15))^((w[j-2]>>>19)|(w[j-2]<<13))^(w[j-2]>>>10);w[j]=w[j-16]+s0+w[j-7]+s1;}
        var a=hash[0],b=hash[1],c=hash[2],d=hash[3],e=hash[4],f=hash[5],g=hash[6],h=hash[7];
        for(var j=0;j<64;j++){var S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));var ch=(e&f)^(~e&g);var t1=h+S1+ch+k[j]+w[j];var S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));var maj=(a&b)^(a&c)^(b&c);var t2=S0+maj;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
        hash[0]=(hash[0]+a)|0;hash[1]=(hash[1]+b)|0;hash[2]=(hash[2]+c)|0;hash[3]=(hash[3]+d)|0;hash[4]=(hash[4]+e)|0;hash[5]=(hash[5]+f)|0;hash[6]=(hash[6]+g)|0;hash[7]=(hash[7]+h)|0;
    }
    var result=new Uint8Array(32);
    for(var i=0;i<8;i++){result[i*4]=hash[i]>>>24;result[i*4+1]=hash[i]>>>16;result[i*4+2]=hash[i]>>>8;result[i*4+3]=hash[i];}
    return result;
}

function stringToUtf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) bytes.push(0xc0|(code>>6), 0x80|(code&0x3f));
        else bytes.push(0xe0|(code>>12), 0x80|((code>>6)&0x3f), 0x80|(code&0x3f));
    }
    return new Uint8Array(bytes);
}

function aesGcmEncryptPure(key, iv, plaintext) {
    var w = aesKeyExpansion(key);
    var H = aesEncryptBlock(new Uint8Array(16), w);
    var j0 = new Uint8Array(16);
    for (var i = 0; i < 12; i++) j0[i] = iv[i];
    j0[15] = 1;
    var ct = new Uint8Array(plaintext.length);
    var counter = new Uint8Array(j0);
    for (var i = 0; i < plaintext.length; i += 16) {
        for (var c = 15; c >= 12; c--) { if (counter[c] === 255) counter[c] = 0; else { counter[c]++; break; } }
        var ks = aesEncryptBlock(counter, w);
        var chunk = Math.min(16, plaintext.length - i);
        for (var j = 0; j < chunk; j++) ct[i+j] = plaintext[i+j] ^ ks[j];
    }
    var ctLen = ct.length, adLen = 0;
    var adPad = (16 - (adLen%16))%16, ctPad = (16 - (ctLen%16))%16;
    var ghIn = new Uint8Array(adLen+adPad+ctLen+ctPad+16);
    ghIn.set(ct, adLen+adPad);
    var lo = adLen+adPad+ctLen+ctPad;
    var ctBits = ctLen*8;
    ghIn[lo+12]=ctBits>>>24;ghIn[lo+13]=(ctBits>>>16)&0xff;ghIn[lo+14]=(ctBits>>>8)&0xff;ghIn[lo+15]=ctBits&0xff;
    function gfmul(x,y){var r=new Uint8Array(16),v=new Uint8Array(x);for(var i=0;i<128;i++){var bit=(y[i>>3]>>>(7-(i&7)))&1;if(bit)for(var j=0;j<16;j++)r[j]^=v[j];var carry=v[15]&1;for(var j=15;j>0;j--)v[j]=(v[j]>>>1)|((v[j-1]&1)<<7);v[0]=v[0]>>>1;if(carry)v[0]^=0xe1;}return r;}
    var Y=new Uint8Array(16);
    for(var i=0;i<ghIn.length;i+=16){for(var j=0;j<16;j++)Y[j]^=ghIn[i+j];Y=gfmul(Y,H);}
    var j0enc=aesEncryptBlock(j0,w);
    var tag=new Uint8Array(16);
    for(var j=0;j<16;j++) tag[j]=Y[j]^j0enc[j];
    var out=new Uint8Array(ct.length+16);
    out.set(ct);out.set(tag,ct.length);
    return out;
}

async function buildAaReq(queryHash) {
    try {
        var creds = await getCreds();
        if (!creds) return null;
        var rawKey = deriveAaKey(creds);
        if (!rawKey) return null;
        var interval = 5 * 60 * 1000;
        var ts = Math.floor(Date.now() / interval) * interval;
        var epoch = creds.epoch;
        var buildId = creds.buildId;
        var iv = puresha256(epoch + ':' + buildId + ':' + queryHash + ':' + ts).slice(0, 12);
        var payload = JSON.stringify({ v: 1, ts: ts, epoch: parseInt(epoch), buildId: String(buildId), qh: queryHash });
        var plaintext = stringToUtf8Bytes(payload);
        var ctWithTag = aesGcmEncryptPure(rawKey, iv, plaintext);
        var result = new Uint8Array(1 + 12 + ctWithTag.length);
        result[0] = 1;
        result.set(iv, 1);
        result.set(ctWithTag, 13);
        return bytesToBase64(result);
    } catch(e) {
        return null;
    }
}

async function allanimeGet(variables, hash, customHeaders, includeAaReq) {
    var encoded = encodeURIComponent(JSON.stringify(variables));
    var extObj = { persistedQuery: { version: 1, sha256Hash: hash } };
    if (includeAaReq) {
        var aaReq = await buildAaReq(hash);
        if (aaReq) extObj.aaReq = aaReq;
    }
    var ext = encodeURIComponent(JSON.stringify(extObj));
    var url = ALLANIME_API + '?variables=' + encoded + '&extensions=' + ext;
    var headers = customHeaders || HEADERS;
    try {
        var res = await soraFetch(url, { headers: headers, method: 'GET', body: null });
        if (!res) return null;
        var text = typeof res.text === 'function' ? await res.text() : null;
        if (!text || text.trim().indexOf('<') === 0) return null;
        return JSON.parse(text);
    } catch(e) { if (includeAaReq) console.log('[AM] allanimeGet error: ' + e); return null; }
}

function extractSubtitlesFromLinks(links) {
    var subtitles = [];
    if (!links || !links.length) return subtitles;
    for (var i = 0; i < links.length; i++) {
        var link = links[i];
        var tracks = link.subtitles || link.captions || link.tracks || [];
        for (var j = 0; j < tracks.length; j++) {
            var t = tracks[j];
            var url = t.src || t.file || t.url || '';
            var label = t.label || t.language || t.srcLang || 'Unknown';
            var lang = t.srcLang || t.language || t.lang || 'en';
            if (url && url.indexOf('http') === 0) {
                subtitles.push({ url: url, language: lang, label: label });
            }
        }
    }
    return subtitles;
}

async function resolveStreamUrl(source) {
    try {
        var rawUrl = source.sourceUrl;
        var decoded = decodeProviderUrl(rawUrl);
        if (!decoded) return null;
        if (decoded.indexOf('/') === 0) decoded = 'https://allanime.day' + decoded;
        if (decoded.indexOf('http') !== 0) return null;
        if (decoded.indexOf('clock.json') !== -1) {
            var fetchPromise = soraFetch(decoded, {
                method: 'GET',
                headers: { 'User-Agent': ALLANIME_UA, 'Referer': ALLANIME_REFR + '/', 'Origin': ALLANIME_REFR }
            });
            var timeoutPromise = new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 8000); });
            var res = await Promise.race([fetchPromise, timeoutPromise]);
            if (!res) return null;
            var text = typeof res.text === 'function' ? await res.text() : null;
            if (!text) return null;
            var json = JSON.parse(text);
            if (json && json.links && json.links.length > 0) {
                var subtitles = extractSubtitlesFromLinks(json.links);
                return {
                    title: source.sourceName || 'Server',
                    streamUrl: json.links[0].link,
                    headers: { 'Referer': ALLANIME_REFR + '/' },
                    subtitles: subtitles
                };
            }
            return null;
        }
        return { title: source.sourceName || 'Server', streamUrl: decoded, headers: { 'Referer': ALLANIME_REFR + '/' }, subtitles: [] };
    } catch(e) { return null; }
}

async function searchResults(keyword) {
    try {
        var variables = { search: { query: keyword }, limit: 26, page: 1, translationType: 'sub', countryOrigin: 'ALL' };
        var data = await allanimeGet(variables, SEARCH_HASH, HEADERS, false);
        if (!data || !data.data || !data.data.shows || !data.data.shows.edges) return JSON.stringify([]);
        var results = [], edges = data.data.shows.edges;
        for (var i = 0; i < edges.length; i++) {
            var show = edges[i];
            if (!show.availableEpisodes || !show.availableEpisodes.sub || show.availableEpisodes.sub === 0) continue;
            results.push({ title: show.englishName || show.name || 'Unknown', image: show.thumbnail || '', href: show._id });
        }
        return JSON.stringify(results);
    } catch(e) { return JSON.stringify([]); }
}

async function extractDetails(showId) {
    try {
        var variables = { _id: showId };
        var data = await allanimeGet(variables, EPISODES_HASH, HEADERS, false);
        if (!data || !data.data || !data.data.show) return JSON.stringify([{ description: 'No description available', aliases: 'N/A', airdate: 'N/A' }]);
        var show = data.data.show;
        var description = show.description ? show.description.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'").trim() : 'No description available';
        var year = show.airedStart && show.airedStart.year ? String(show.airedStart.year) : 'N/A';
        var score = show.averageScore ? show.averageScore + '/100' : 'N/A';
        return JSON.stringify([{ description: description, aliases: 'Score: ' + score, airdate: 'Year: ' + year }]);
    } catch(e) { return JSON.stringify([{ description: 'No description available', aliases: 'N/A', airdate: 'N/A' }]); }
}

async function extractEpisodes(showId) {
    try {
        var variables = { _id: showId };
        var data = await allanimeGet(variables, EPISODES_HASH, HEADERS, false);
        if (!data || !data.data || !data.data.show) return JSON.stringify([]);
        var subEpisodes = (data.data.show.availableEpisodesDetail && data.data.show.availableEpisodesDetail.sub) || [];
        if (!subEpisodes.length) return JSON.stringify([]);
        var parsed = [];
        for (var i = 0; i < subEpisodes.length; i++) { var n = parseFloat(subEpisodes[i]); if (!isNaN(n)) parsed.push(n); }
        parsed.sort(function(a,b){return a-b;});
        var results = [];
        for (var j = 0; j < parsed.length; j++) results.push({ href: showId + '|' + parsed[j], number: parsed[j] });
        return JSON.stringify(results);
    } catch(e) { return JSON.stringify([]); }
}

async function extractStreamUrl(slug) {
    try {
        var parts = slug.split('|');
        var showId = parts[0], epNumber = parts[1];
        var variables = { showId: showId, translationType: 'sub', episodeString: String(epNumber) };
        var data = await allanimeGet(variables, SOURCES_HASH, SOURCES_HEADERS, true);
        if (!data || !data.data) return JSON.stringify({ streams: [], subtitles: [] });

        var sourceUrls = [];
        if (data.data._m && data.data.tobeparsed) {
            try {
                var decrypted = decodeTobeparsed(data.data.tobeparsed, null);
                var parsed = JSON.parse(decrypted);
                sourceUrls = (parsed && parsed.episode && parsed.episode.sourceUrls) || [];
            } catch(e) {}
        } else if (data.data.episode && data.data.episode.sourceUrls) {
            sourceUrls = data.data.episode.sourceUrls;
        }

        if (!sourceUrls.length) return JSON.stringify({ streams: [], subtitles: [] });

        var validSources = [], seenUrls = {};
        for (var i = 0; i < sourceUrls.length; i++) {
            var src = sourceUrls[i];
            if (!src.sourceUrl) continue;
            if (src.sourceUrl.indexOf('--') !== 0) continue;
            if (seenUrls[src.sourceUrl]) continue;
            seenUrls[src.sourceUrl] = true;
            validSources.push(src);
        }

        var promises = [];
        for (var i = 0; i < validSources.length; i++) promises.push(resolveStreamUrl(validSources[i]));
        var results = await Promise.all(promises);

        var streams = [], subtitles = [], seenSubUrls = {};
        for (var i = 0; i < results.length; i++) {
            if (!results[i]) continue;
            streams.push({ title: results[i].title, streamUrl: results[i].streamUrl, headers: results[i].headers });
            if (results[i].subtitles && results[i].subtitles.length) {
                for (var s = 0; s < results[i].subtitles.length; s++) {
                    var sub = results[i].subtitles[s];
                    if (sub.url && !seenSubUrls[sub.url]) {
                        seenSubUrls[sub.url] = true;
                        subtitles.push(sub);
                    }
                }
            }
        }

        return JSON.stringify({ streams: streams, subtitles: subtitles });
    } catch(e) { return JSON.stringify({ streams: [], subtitles: [] }); }
}
