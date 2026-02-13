export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        // ✅ Prefer server env var, fall back to client-supplied key
        const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
        
        if (!apiKey) {
            return res.status(401).json({ 
                error: 'No API key provided. Add one in the app or contact the site owner.' 
            });
        }

        // Log which key source is being used (never log the key itself)
        console.log(`Using ${process.env.ANTHROPIC_API_KEY ? 'server' : 'client'} API key`);
        
        // Forward request to Anthropic
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(req.body)
        });
        
        const data = await anthropicResponse.json();
        
        if (!anthropicResponse.ok) {
            console.error('Anthropic API error:', anthropicResponse.status, data);
            return res.status(anthropicResponse.status).json(data);
        }
        
        console.log('Success! Returning data to client');
        return res.status(200).json(data);
        
    } catch (error) {
        console.error('Backend error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}
