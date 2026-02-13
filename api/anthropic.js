export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
        
        if (!apiKey) {
            return res.status(401).json({ error: 'No API key provided.' });
        }

        // ✅ Manually parse body in case Vercel didn't auto-parse it
        let body = req.body;
        if (typeof body === 'string') {
            body = JSON.parse(body);
        } else if (!body) {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            body = JSON.parse(Buffer.concat(chunks).toString());
        }

        console.log(`Using ${process.env.ANTHROPIC_API_KEY ? 'server' : 'client'} API key`);
        console.log('Model requested:', body.model);
        
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(body)
        });
        
        const data = await anthropicResponse.json();
        
        if (!anthropicResponse.ok) {
            console.error('Anthropic API error:', anthropicResponse.status, data);
            return res.status(anthropicResponse.status).json(data);
        }
        
        return res.status(200).json(data);
        
    } catch (error) {
        console.error('Backend error:', error.message);
        // ✅ Always return JSON, never plain text
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}
