const PROMPT = `You are an expert AI image quality control system specializing in industrial equipment photography and human subjects. Analyze this AI-generated image for visual artifacts and anomalies.

Perform a thorough inspection and respond ONLY with a valid JSON object in this exact format:
{
  "verdict": "PASS" | "REVIEW" | "FAIL",
  "confidence": <number 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "issues": ["<specific issue 1>", "<specific issue 2>"],
  "checks": {
    "limb_count": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
    "finger_detail": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "face_anatomy": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "forklift_forks": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "forklift_mast": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "operator_seat": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "wheel_count": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "duplicate_objects": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "text_legibility": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "lighting_shadows": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "background_coherence": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" },
    "proportions": { "status": "ok" | "warn" | "bad" | "skip", "note": "<brief note>" }
  }
}

Verdict rules:
- PASS: No significant artifacts, image looks natural and correct
- REVIEW: Minor issues or uncertain, human should verify
- FAIL: Clear artifacts present (wrong limb counts, duplicate objects, severe distortions)

Use "skip" status for checks not applicable to this image.
Return ONLY the JSON, no other text.`;

async function analyzeWithGemini(imageBase64, mimeType, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Gemini: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function analyzeWithOpenAI(imageBase64, mimeType, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1500,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' } }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`OpenAI: ${err.error?.message || response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

function mergeResults(gemini, openai) {
  const verdictScore = { PASS: 0, REVIEW: 1, FAIL: 2 };
  const scoreVerdict = ['PASS', 'REVIEW', 'FAIL'];

  // If both agree, use that verdict. If they disagree, escalate to the worse one but flag as REVIEW
  const gScore = verdictScore[gemini.verdict] ?? 1;
  const oScore = verdictScore[openai.verdict] ?? 1;

  let finalVerdict;
  let agreement;
  if (gemini.verdict === openai.verdict) {
    finalVerdict = gemini.verdict;
    agreement = 'full';
  } else {
    // Disagreement — escalate to worse but cap at REVIEW unless both say FAIL
    const maxScore = Math.max(gScore, oScore);
    finalVerdict = maxScore === 2 ? 'REVIEW' : scoreVerdict[maxScore];
    agreement = 'partial';
  }

  // Average confidence, reduce if disagreement
  const avgConfidence = Math.round((gemini.confidence + openai.confidence) / 2);
  const finalConfidence = agreement === 'full' ? avgConfidence : Math.round(avgConfidence * 0.75);

  // Merge issues (deduplicate roughly)
  const allIssues = [...(gemini.issues || []), ...(openai.issues || [])];
  const uniqueIssues = allIssues.filter((issue, i) =>
    allIssues.findIndex(x => x.toLowerCase().includes(issue.toLowerCase().split(' ')[0])) === i
  );

  // Merge checks - take the worse status for each check
  const statusRank = { ok: 0, skip: 0, warn: 1, bad: 2 };
  const mergedChecks = {};
  const allKeys = new Set([...Object.keys(gemini.checks || {}), ...Object.keys(openai.checks || {})]);

  allKeys.forEach(key => {
    const g = gemini.checks?.[key];
    const o = openai.checks?.[key];
    if (!g && !o) return;
    if (!g) { mergedChecks[key] = o; return; }
    if (!o) { mergedChecks[key] = g; return; }
    const gRank = statusRank[g.status] ?? 0;
    const oRank = statusRank[o.status] ?? 0;
    mergedChecks[key] = gRank >= oRank ? g : o;
    // Add note from both if they differ
    if (g.status !== o.status) {
      mergedChecks[key].note = `Gemini: ${g.note} | GPT-4o: ${o.note}`;
    }
  });

  return {
    verdict: finalVerdict,
    confidence: finalConfidence,
    agreement,
    summary: `Gemini: ${gemini.summary} GPT-4o: ${openai.summary}`,
    issues: uniqueIssues,
    checks: mergedChecks,
    individual: { gemini, openai }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) return res.status(500).json({ error: 'No API keys configured' });

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64 || !mimeType) return res.status(400).json({ error: 'Missing image data' });

  const promises = [];
  if (geminiKey) promises.push(analyzeWithGemini(imageBase64, mimeType, geminiKey).catch(e => ({ error: e.message })));
  if (openaiKey) promises.push(analyzeWithOpenAI(imageBase64, mimeType, openaiKey).catch(e => ({ error: e.message })));

  try {
    const results = await Promise.all(promises);
    const geminiResult = geminiKey ? results[0] : null;
    const openaiResult = openaiKey ? results[geminiKey ? 1 : 0] : null;

    // Handle partial failures
    if (geminiResult?.error && openaiResult?.error) {
      return res.status(500).json({ error: `Both APIs failed. Gemini: ${geminiResult.error}. OpenAI: ${openaiResult.error}` });
    }

    if (geminiResult?.error) {
      return res.status(200).json({ ...openaiResult, source: 'openai_only', warning: `Gemini failed: ${geminiResult.error}` });
    }

    if (openaiResult?.error) {
      return res.status(200).json({ ...geminiResult, source: 'gemini_only', warning: `OpenAI failed: ${openaiResult.error}` });
    }

    if (geminiResult && openaiResult) {
      return res.status(200).json({ ...mergeResults(geminiResult, openaiResult), source: 'dual' });
    }

    const single = geminiResult || openaiResult;
    return res.status(200).json({ ...single, source: geminiKey ? 'gemini_only' : 'openai_only' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
