import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
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

      const landscapePrompt = prompt + ' Landscape orientation.';

      if (imageBase64) {
        const imgMime = mimeType || 'image/jpeg';
        const ext = imgMime.includes('png') ? 'png' : 'jpg';
        const imageBuffer = Buffer.from(imageBase64, 'base64');

        const formData = new FormData();
        formData.append('model', 'gpt-image-1');
        formData.append('prompt', landscapePrompt);
        formData.append('n', '1');
        formData.append('size', 'auto');
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

      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: landscapePrompt, n: 1, size: 'auto' })
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

      const ai = new GoogleGenAI({ apiKey });

      // Build prompt array exactly like Google's example
      const promptParts = [
        { text: prompt + ' Landscape orientation.' }
      ];

      if (imageBase64) {
        promptParts.push({
          inlineData: {
            mimeType: mimeType || 'image/jpeg',
            data: imageBase64
          }
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: promptParts
      });

      // Find image part in response
      const parts = response.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

      if (!imagePart) {
        const textContent = parts.filter(p => p.text).map(p => p.text).join(' ');
        throw new Error(`No image in Nano Banana response. Model said: ${textContent.substring(0, 300)}`);
      }

      return res.status(200).json({ imageBase64: imagePart.inlineData.data });

    } else {
      return res.status(400).json({ error: 'Invalid engine. Use "dalle" or "gemini"' });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}