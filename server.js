const express = require('express');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/', (req, res) => res.send('Universal IPTV Proxy Ready'));

function forwardStream(targetUrl, clientRes, clientReq, redirects = 0) {
    if (redirects > 6) {
        clientRes.status(502).send("Too many redirects");
        return;
    }

    try {
        const u = new URL(targetUrl);
        const mod = u.protocol === 'https:' ? https : http;

        const options = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                'Accept': '*/*',
                'Connection': 'keep-alive'
            }
        };

        const upstream = mod.request(options, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                const nextUrl = new URL(res.headers.location, targetUrl).toString();
                return forwardStream(nextUrl, clientRes, clientReq, redirects + 1);
            }

            clientRes.writeHead(res.statusCode, {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'video/mp2t',
                'Cache-Control': 'no-cache, no-store',
                'Connection': 'keep-alive'
            });

            res.pipe(clientRes);

            clientReq.on('close', () => {
                upstream.destroy();
                res.destroy();
            });
        });

        upstream.on('error', (err) => {
            if (!clientRes.headersSent) clientRes.status(502).send("Upstream error");
        });

        upstream.end();
    } catch (e) {
        if (!clientRes.headersSent) clientRes.status(400).send("Invalid URL");
    }
}

app.get('/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');
    forwardStream(targetUrl, res, req);
});

app.listen(PORT, () => console.log(`Proxy listening on ${PORT}`));
