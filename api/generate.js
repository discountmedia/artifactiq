export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { engine, prompt } = req.body;
  if (!engine || !prompt) return res.status(400).json({ error: 'Missing engine or prompt' });

  try {
    if (engine === 'dalle') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });

      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-image-1.5',
          prompt,
          n: 1,
          size: '1024x1024'
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `OpenAI error ${response.status}`);
      }

      const data = await response.json();
      // gpt-image-1.5 returns base64, not a URL
      const imageBase64 = data.data?.[0]?.b64_json;
      const imageUrl = data.data?.[0]?.url;
      if (!imageBase64 && !imageUrl) throw new Error('No image returned from OpenAI');

      return res.status(200).json({ imageBase64, imageUrl });

    } else if (engine === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: '1:1'
            }
          })
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `Gemini Imagen error ${response.status}`);
      }

      const data = await response.json();
      const imageBase64 = data.predictions?.[0]?.bytesBase64Encoded;
      if (!imageBase64) throw new Error('No image returned from Gemini Imagen');

      return res.status(200).json({ imageBase64 });

    } else {
      return res.status(400).json({ error: 'Invalid engine. Use "dalle" or "gemini"' });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}