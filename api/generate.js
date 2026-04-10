export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { engine, prompt, imageBase64, mimeType } = req.body;
  if (!engine || !prompt) return res.status(400).json({ error: 'Missing engine or prompt' });

  try {
    if (engine === 'dalle') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });

      if (imageBase64) {
        const imgMime = mimeType || 'image/jpeg';
        const ext = imgMime.includes('png') ? 'png' : 'jpg';
        const imageBuffer = Buffer.from(imageBase64, 'base64');

        const formData = new FormData();
        formData.append('model', 'gpt-image-1');
        formData.append('prompt', prompt);
        formData.append('n', '1');
        formData.append('size', '1792x1024'); // 16:9
        const blob = new Blob([imageBuffer], { type: imgMime });
        formData.append('image[]', blob, `original.${ext}`);

        const response = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: formData
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message || `OpenAI error ${response.status}`);
        }

        const data = await response.json();
        const imageB64 = data.data?.[0]?.b64_json;
        const imageUrl = data.data?.[0]?.url;
        if (!imageB64 && !imageUrl) throw new Error('No image returned from OpenAI');
        return res.status(200).json({ imageBase64: imageB64, imageUrl });
      }

      // Fallback: no image
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1792x1024' })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `OpenAI error ${response.status}`);
      }

      const data = await response.json();
      const imageB64 = data.data?.[0]?.b64_json;
      const imageUrl = data.data?.[0]?.url;
      if (!imageB64 && !imageUrl) throw new Error('No image returned from OpenAI');
      return res.status(200).json({ imageBase64: imageB64, imageUrl });

    } else if (engine === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

      const parts = [{ text: prompt }];

      if (imageBase64) {
        parts.push({
          inline_data: {
            mime_type: mimeType || 'image/jpeg',
            data: imageBase64
          }
        });
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                aspectRatio: '16:9'
              }
            }
          })
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `Gemini error ${response.status}`);
      }

      const data = await response.json();

      const imagePart = data.candidates?.[0]?.content?.parts?.find(
        p => p.inline_data && p.inline_data.mime_type?.startsWith('image/') && !p.thought
      );

      if (!imagePart) throw new Error('No image returned from Nano Banana 2');

      return res.status(200).json({ imageBase64: imagePart.inline_data.data });

    } else {
      return res.status(400).json({ error: 'Invalid engine. Use "dalle" or "gemini"' });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}