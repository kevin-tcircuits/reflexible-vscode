// Polyfill fetch for older Node.js versions
export const fetch = globalThis.fetch || (async (...args: any[]): Promise<Response> => {
    const https = await import('https');
    const http = await import('http');
    const url = new URL(args[0]);
    const options = {
        method: args[1]?.method || 'GET',
        headers: args[1]?.headers || {},
        ...args[1]
    };
    
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, options, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    headers: res.headers,
                    text: async () => data,
                    json: async () => JSON.parse(data),
                    body: res
                } as any);
            });
        });
        req.on('error', reject);
        if (args[1]?.body) req.write(args[1].body);
        req.end();
    });
});

