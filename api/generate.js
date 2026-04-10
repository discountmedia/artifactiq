import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

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

      const openai = new OpenAI({ apiKey });

      const response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: prompt,
        n: 1,
        size: '1536x1024'
      });

      const base64Data = response.data[0].b64_json;
      const imageUrl = response.data[0].url;
      if (!base64Data && !imageUrl) throw new Error('No image returned from OpenAI');

      return res.status(200).json({ imageBase64: base64Data, imageUrl });

    } else if (engine === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

      const ai = new GoogleGenAI({ apiKey });

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