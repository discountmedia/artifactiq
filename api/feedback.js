export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT;

  if (!sheetId || !serviceAccountJson) {
    // If not configured, just acknowledge silently — don't break the UI
    console.warn('Google Sheets not configured. Feedback not saved.');
    return res.status(200).json({ ok: true, warning: 'Feedback logging not configured' });
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    return res.status(500).json({ error: 'Invalid GOOGLE_SERVICE_ACCOUNT JSON' });
  }

  const { timestamp, filename, verdict, confidence, overrides, globalNote, source } = req.body;

  try {
    // Get access token via Google JWT auth
    const token = await getAccessToken(serviceAccount);

    // Format override data for sheet columns
    const overrideKeys = [
      'limb_count', 'finger_detail', 'face_anatomy', 'forklift_forks',
      'forklift_mast', 'operator_seat', 'wheel_count', 'duplicate_objects',
      'text_legibility', 'lighting_shadows', 'background_coherence', 'proportions'
    ];

    const overrideCells = overrideKeys.map(key => {
      const o = overrides?.[key];
      if (!o) return '';
      return `${o.action}${o.note ? ': ' + o.note : ''}`;
    });

    const row = [
      timestamp || new Date().toISOString(),
      filename || '',
      verdict || '',
      confidence || '',
      source || '',
      ...overrideCells,
      globalNote || ''
    ];

    // Append to sheet
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [row] })
      }
    );

    if (!appendRes.ok) {
      const err = await appendRes.json();
      throw new Error(err.error?.message || `Sheets API error ${appendRes.status}`);
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Feedback save error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with RSA private key using Web Crypto
  const privateKey = serviceAccount.private_key;
  const cryptoKey = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64url(signature);
  const jwt = `${signingInput}.${encodedSignature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json();
    throw new Error(`Auth failed: ${err.error_description || err.error}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

function base64url(data) {
  let str;
  if (data instanceof ArrayBuffer) {
    str = String.fromCharCode(...new Uint8Array(data));
  } else {
    str = typeof data === 'string' ? data : JSON.stringify(data);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}
