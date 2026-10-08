const express = require('express');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/', (req, res) => {
    res.send('Universal IPTV Infinite Proxy Active');
});

function fetchUpstreamChunk(targetUrl, headers) {
    return new Promise((resolve, reject) => {
        try {
            const parsed = new URL(targetUrl);
            const client = parsed.protocol === 'https:' ? https : http;
            const req = client.request({
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: 'GET',
                rejectUnauthorized: false,
                headers: {
                    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                    'Accept': '*/*',
                    'Connection': 'keep-alive',
                    ...headers
                }
            }, (res) => {
                if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                    const nextUrl = new URL(res.headers.location, targetUrl).toString();
                    return resolve(fetchUpstreamChunk(nextUrl, headers));
                }
                resolve({ stream: res, statusCode: res.statusCode, headers: res.headers });
            });
            req.on('error', reject);
            req.end();
        } catch (e) {
            reject(e);
        }
    });
}

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');

    let clientConnected = true;
    req.on('close', () => {
        clientConnected = false;
    });

    res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked'
    });

    // حلقة ضخ البث المستمر: لو فصل السيرفر الأصلي، نعيد الاتصال فوراً بنفس الدفق
    while (clientConnected) {
        try {
            const upstream = await fetchUpstreamChunk(targetUrl);
            
            await new Promise((resolve) => {
                upstream.stream.on('data', (chunk) => {
                    if (clientConnected) {
                        res.write(chunk);
                    }
                });

                upstream.stream.on('end', resolve);
                upstream.stream.on('error', resolve);

                if (!clientConnected) {
                    upstream.stream.destroy();
                    resolve();
                }
            });

            // استراحة قصيرة جداً لتفادي الضغط عند تبديل الاتصال
            if (clientConnected) {
                await new Promise((r) => setTimeout(r, 100));
            }
        } catch (err) {
            if (!clientConnected) break;
            await new Promise((r) => setTimeout(r, 1000));
        }
    }

    res.end();
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
