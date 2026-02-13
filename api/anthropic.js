export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        // ✅ Use server env variable — never from client
        const apiKey = process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ error: 'API key not configured on server' });
        }
        
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
        
        return res.status(200).json(data);
        
    } catch (error) {
        console.error('Backend error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
