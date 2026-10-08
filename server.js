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
    res.send('Universal IPTV Proxy is Running!');
});

function pipeStream(targetUrl, res, clientReq, redirects = 0) {
    if (redirects > 8) {
        res.status(502).send("Too many redirects");
        return;
    }

    try {
        const parsed = new URL(targetUrl);
        const isHttps = parsed.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                'Accept': '*/*',
                'Connection': 'keep-alive',
                'Icy-MetaData': '1'
            }
        };

        const upstreamReq = client.request(options, (upstreamRes) => {
            if ([301, 302, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
                const nextUrl = new URL(upstreamRes.headers.location, targetUrl).toString();
                return pipeStream(nextUrl, res, clientReq, redirects + 1);
            }

            res.writeHead(upstreamRes.statusCode, {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': upstreamRes.headers['content-type'] || 'video/mp2t',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Connection': 'keep-alive'
            });

            upstreamRes.pipe(res);

            clientReq.on('close', () => {
                upstreamRes.destroy();
                upstreamReq.destroy();
            });
        });

        upstreamReq.on('error', (err) => {
            if (!res.headersSent) {
                res.status(502).send("Upstream error: " + err.message);
            }
        });

        upstreamReq.end();

    } catch (err) {
        if (!res.headersSent) {
            res.status(400).send("URL error: " + err.message);
        }
    }
}

app.get('/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');
    pipeStream(targetUrl, res, req);
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
