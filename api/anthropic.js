export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(400).json({ error: 'API key required' });
        }
        
        console.log('Forwarding request to Anthropic API...');
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(req.body)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('Anthropic API error:', data);
            return res.status(response.status).json(data);
        }
        
        console.log('Successfully forwarded request');
        res.status(200).json(data);
    } catch (error) {
        console.error('Handler error:', error);
        res.status(500).json({ error: error.message });
    }
}
```

## 📂 Your GitHub Repo Structure Should Be:
```
BOBA-Scanner/
├── index.html              ← Updated version I just provided
├── card-database.json      ← Your existing database
├── vercel.json            ← This new vercel.json
├── api/
│   └── anthropic.js       ← This backend code
└── README.md              ← Your existing README
