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
        // Get API key from headers
        const apiKey = req.headers['x-api-key'];
        
        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }
        
        // Log for debugging (will show in Vercel logs)
        console.log('Forwarding request to Anthropic API...');
        
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
        
        // Get response data
        const data = await anthropicResponse.json();
        
        // Check if Anthropic API returned an error
        if (!anthropicResponse.ok) {
            console.error('Anthropic API error:', anthropicResponse.status, data);
            return res.status(anthropicResponse.status).json(data);
        }
        
        // Success - return the data
        console.log('Success! Returning data to client');
        return res.status(200).json(data);
        
    } catch (error) {
        // Catch any errors and return as JSON
        console.error('Backend error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
}
