// Vercel Serverless Function for Claude API
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { imageData } = req.body;
        
        // Debug logging
        console.log('Request received');
        console.log('Has imageData:', !!imageData);
        console.log('ImageData length:', imageData?.length);
        
        if (!imageData) {
            console.error('Missing imageData in request');
            return res.status(400).json({ error: 'Missing image data' });
        }
        
        // Get API key from environment variable
        const apiKey = process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
            console.error('ANTHROPIC_API_KEY not set in environment');
            return res.status(500).json({ error: 'API key not configured' });
        }
        
        console.log('Calling Claude API...');
        
        // Call Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/jpeg',
                                data: imageData
                            }
                        },
                        {
                            type: 'text',
                            text: `Analyze this Bo Jackson trading card image and extract the following information:
1. Year (e.g., "2023")
2. Set name (e.g., "Base Set", "Refractor", "Chrome", etc.)
3. Card number (e.g., "001", "42", "BS-10", etc.)
4. Parallel/Pose type (e.g., "Standard", "Gold Refractor", "Base", etc.)
5. Weapon shown on card (if any, otherwise "None")
6. Power level (if shown on card, otherwise "None")

Return ONLY a JSON object with this exact format, no other text:
{
  "year": "YYYY",
  "set": "Set Name",
  "cardNumber": "###",
  "pose": "Parallel/Pose Type",
  "weapon": "Weapon Name or None",
  "power": "Power Level or None"
}

Be precise and extract exactly what you see on the card.`
                        }
                    ]
                }]
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Claude API error:', response.status, errorText);
            return res.status(response.status).json({ 
                error: `Claude API error: ${response.status}`,
                details: errorText
            });
        }
        
        const data = await response.json();
        console.log('Claude API success');
        return res.status(200).json(data);
        
    } catch (error) {
        console.error('API Handler Error:', error);
        return res.status(500).json({ 
            error: error.message || 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
