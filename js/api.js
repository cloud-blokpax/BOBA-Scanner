// API calls to Claude via Vercel backend
// API key is stored securely in Vercel environment variables

async function callAPI(imageData) {
    if (!imageData) {
        throw new Error('No image data provided');
    }
    
    try {
        // Call Vercel backend function
        // Backend will use environment variable for API key
        const response = await fetch('/api/anthropic', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                imageData: imageData
                // No API key sent from frontend!
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Extract text from Claude response
        const textContent = data.content?.find(c => c.type === 'text');
        if (!textContent) {
            throw new Error('No text content in API response');
        }
        
        let text = textContent.text.trim();
        
        // Remove markdown code blocks if present
        if (text.startsWith('```json')) {
            text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        } else if (text.startsWith('```')) {
            text = text.replace(/```\n?/g, '').trim();
        }
        
        // Parse JSON response
        const parsed = JSON.parse(text);
        
        console.log('✅ API response:', parsed);
        return parsed;
        
    } catch (error) {
        console.error('❌ API call failed:', error);
        throw error;
    }
}
