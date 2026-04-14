const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

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

async function getSoldComps(title, grade) {
  try {
    const query = encodeURIComponent(title.slice(0, 80) + ' ' + grade);
    const url = `https://www.130point.com/sales/?query=${query}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html',
      },
      timeout: 10000
    });
    const html = await r.text();

    // Parse prices from 130point results
    const priceMatches = html.match(/\$[\d,]+\.?\d*/g);
    if (!priceMatches || priceMatches.length === 0) return null;

    const prices = priceMatches
      .map(p => parseFloat(p.replace(/[$,]/g, '')))
      .filter(p => p > 5 && p < 500000)
      .slice(0, 10);

    if (prices.length < 2) return null;

    prices.sort((a, b) => a - b);
    const mid = prices.slice(1, -1); // trim outliers
    const avg = mid.reduce((s, p) => s + p, 0) / mid.length;
    const low = Math.min(...mid);
    const high = Math.max(...mid);

    return { low: Math.round(low), high: Math.round(high), mid: Math.round(avg), count: prices.length };
  } catch(e) {
    return null;
  }
}

const ANCHOR_PLAYERS = ['Mahomes', 'Tom Brady'];

async function getTrendingPlayers(token) {
  try {
    const players = new Set(ANCHOR_PLAYERS);
    const namePattern = /\b(Mahomes|Brady|Burrow|Herbert|Stroud|Williams|Lamar Jackson|Josh Allen|Jeanty|Harrison|Bo Nix|Daniels|Richardson|Caleb Williams|Wembanyama|Cooper Flagg|Boozer|Luka|Giannis|Tatum|SGA|Shohei|Judge|Acuna|Soto|Trout)\b/gi;
    const searches = ['PSA 10 rookie auction hot 2025', 'BGS 9.5 rookie trending auction'];
    for (const q of searches) {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=261328&sort=bestMatch&limit=30`;
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
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

app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, q, grade } = req.query;
    const token = await getToken(clientId, clientSecret);
    const encoded = encodeURIComponent(q);
    const now = new Date().toISOString();
    const twoHours = new Date(Date.now() + 7200000).toISOString();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encoded}&category_ids=261328&sort=endingSoonest&limit=50&filter=buyingOptions:%7BAUCTION%7D,endTimeFrom:${now},endTimeTo:${twoHours}`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
    const data = await r.json();

    if (grade && data.itemSummaries) {
      const gradeUpper = grade.toUpperCase();
      data.itemSummaries = data.itemSummaries.filter(item => {
        const title = (item.title || '').toUpperCase();
        const condition = (item.condition || '').toUpperCase();
        const isGraded = condition === 'GRADED' || title.includes('PSA') || title.includes('BGS') || title.includes('SGC');
        if (!isGraded) return false;
        if (gradeUpper === 'PSA 10') return /PSA\s*10/.test(title) && !/PSA\s*9[^0]/.test(title) && !/BGS/.test(title);
        if (gradeUpper === 'PSA 9') return /PSA\s*9(?!\.5|\s*10)/.test(title) && !/BGS/.test(title);
        if (gradeUpper === 'BGS 9.5') return /BGS\s*9\.5/.test(title);
        if (gradeUpper === 'AUTO') return /(AUTO|AUTOGRAPH)/.test(title) && /(PSA\s*9\.5|PSA\s*10|BGS\s*9\.5)/.test(title);
        return true;
      });
    }

    // Get comps for top 10 listings
    if (data.itemSummaries && data.itemSummaries.length > 0) {
      const top = data.itemSummaries.slice(0, 10);
      await Promise.all(top.map(async (item) => {
        const comps = await getSoldComps(item.title || '', grade || '');
        if (comps) item.soldComps = comps;
      }));
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
