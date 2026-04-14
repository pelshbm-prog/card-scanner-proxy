const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

const ANCHOR_PLAYERS = ['Mahomes', 'Tom Brady', 'LeBron James', 'Stephen Curry'];

async function getTrendingPlayers(token) {
  try {
    const players = new Set(ANCHOR_PLAYERS);
    const searches = [
      'PSA 10 rookie auction hot 2025',
      'BGS 9.5 rookie auction trending',
      'PSA 10 rookie football basketball baseball 2024 2025'
    ];
    const namePattern = /\b(Mahomes|Brady|LeBron|Curry|Burrow|Herbert|Stroud|CJ Stroud|Williams|Lamar Jackson|Josh Allen|Jeanty|Harrison|Bo Nix|Daniels|Richardson|Caleb Williams|Anthony Richardson|Wembanyama|Caitlin Clark|Cooper Flagg|Boozer|Luka|Giannis|Tatum|SGA|Tyrese|Scottie|Shohei|Judge|Acuna|Soto|Trout|Bichette|Vlad Jr)\b/gi;
    for (const q of searches) {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=261328&sort=bestMatch&limit=30`;
      const r = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
      });
      const data = await r.json();
      (data.itemSummaries || []).forEach(item => {
        const matches = (item.title || '').match(namePattern);
        if (matches) matches.forEach(m => players.add(m));
      });
    }
    return [...players].slice(0, 10);
  } catch(e) {
    return ANCHOR_PLAYERS;
  }
}

async function getToken(clientId, clientSecret) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Auth failed');
  return data.access_token;
}

app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, q, grade } = req.query;
    const token = await getToken(clientId, clientSecret);
    const encoded = encodeURIComponent(q);
    const now = new Date().toISOString();
    const twoHours = new Date(Date.now() + 7200000).toISOString();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encoded}&category_ids=261328&sort=endingSoonest&limit=50&filter=buyingOptions:%7BAUCTION%7D,endTimeFrom:${now},endTimeTo:${twoHours}`;
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
    });
    const data = await r.json();

    if (grade && data.itemSummaries) {
      const gradeUpper = grade.toUpperCase();
      data.itemSummaries = data.itemSummaries.filter(item => {
        const title = (item.title || '').toUpperCase();
        const condition = (item.condition || '').toUpperCase();
        const isGraded = condition === 'GRADED' || title.includes('PSA') || title.includes('BGS') || title.includes('SGC') || title.includes('CGC');
        if (!isGraded) return false;
        if (gradeUpper === 'PSA 10') return /PSA\s*10/.test(title) && !/PSA\s*9[^0]/.test(title) && !/BGS/.test(title);
        if (gradeUpper === 'PSA 9') return /PSA\s*9(?!\.5|\s*10)/.test(title) && !/BGS/.test(title);
        if (gradeUpper === 'BGS 9.5') return /BGS\s*9\.5/.test(title);
        if (gradeUpper === 'BGS 10') return /BGS\s*10/.test(title) && !/BGS\s*9/.test(title);
        return true;
      });
    }

    res.json(data);
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/trending', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.query;
    const token = await getToken(clientId, clientSecret);
    const players = await getTrendingPlayers(token);
    res.json({ players });
  } catch(e) {
    res.json({ players: ANCHOR_PLAYERS });
  }
});

app.get('/token', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.query;
    const token = await getToken(clientId, clientSecret);
    res.json({ access_token: token });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Card scanner proxy running');
});
