export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { engine, prompt, imageBase64, mimeType } = req.body;
  if (!engine || !prompt) return res.status(400).json({ error: 'Missing engine or prompt' });

  try {
    if (engine === 'dalle') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });

      // Use gpt-image-1 edit endpoint if we have the original image
      if (imageBase64) {
        // Convert base64 to blob for multipart form
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const imgMime = mimeType || 'image/jpeg';
        const ext = imgMime.includes('png') ? 'png' : 'jpg';

        const formData = new FormData();
        formData.append('model', 'gpt-image-1');
        formData.append('prompt', prompt);
        formData.append('n', '1');
        formData.append('size', '1024x1024');

        // Append image as blob
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

      // Fallback: generate without reference
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
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
      const imageB64 = data.data?.[0]?.b64_json;
      const imageUrl = data.data?.[0]?.url;
      if (!imageB64 && !imageUrl) throw new Error('No image returned from OpenAI');
      return res.status(200).json({ imageBase64: imageB64, imageUrl });

    } else if (engine === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

      // Use Gemini vision + Imagen: first describe the edit with the image as context
      // then generate. Since Imagen doesn't support image editing directly,
      // we use gemini-2.0-flash to enhance the prompt with image context first.
      let enhancedPrompt = prompt;

      if (imageBase64) {
        const visionRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    text: `You are helping edit a forklift image. Look at this image carefully and then write a detailed Imagen prompt that describes this exact image but with the following corrections applied:\n\n${prompt}\n\nWrite ONLY the image generation prompt, nothing else. Be very specific about what to keep the same (colors, background, angle, style) and what to change.`
                  },
                  {
                    inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 }
                  }
                ]
              }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
            })
          }
        );

        if (visionRes.ok) {
          const visionData = await visionRes.json();
          const enhanced = visionData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (enhanced) enhancedPrompt = enhanced.trim();
        }
      }

      // Now generate with Imagen
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: enhancedPrompt }],
            parameters: { sampleCount: 1, aspectRatio: '1:1' }
          })
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `Gemini Imagen error ${response.status}`);
      }

      const data = await response.json();
      const imageB64 = data.predictions?.[0]?.bytesBase64Encoded;
      if (!imageB64) throw new Error('No image returned from Gemini Imagen');
      return res.status(200).json({ imageBase64: imageB64 });

    } else {
      return res.status(400).json({ error: 'Invalid engine. Use "dalle" or "gemini"' });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}