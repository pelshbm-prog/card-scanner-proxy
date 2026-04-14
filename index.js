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
    const searches = ['trending sports cards rookie PSA', 'hot rookie card PSA 10 2025'];
    const players = new Set(ANCHOR_PLAYERS);
    for (const q of searches) {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=261328&sort=bestMatch&limit=20`;
      const r = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
      });
      const data = await r.json();
      const items = data.itemSummaries || [];
      const namePattern = /\b(mahomes|brady|lebron|curry|burrow|herbert|stroud|williams|jackson|Allen|Jeanty|Harrison|Nix|daniels|Richardson|Caleb|Young|Rodgers|Wembanyama|Caitlin Clark|Flagg|Boozer)\b/gi;
      items.forEach(item => {
        const matches = (item.title || '').match(namePattern);
        if (matches) matches.forEach(m => players.add(m));
      });
    }
    return [...players].slice(0, 12);
  } catch(e) {
    return ANCHOR_PLAYERS;
  }
}

app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, q } = req.query;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return res.json({ error: 'Auth failed' });
    const token = tokenData.access_token;

    const encoded = encodeURIComponent(q);
    const now = new Date().toISOString();
    const oneHour = new Date(Date.now() + 3600000).toISOString();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encoded}&category_ids=261328&sort=endingSoonest&limit=20&filter=buyingOptions:%7BAUCTION%7D,endTimeFrom:${now},endTimeTo:${oneHour}`;
    const searchResp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
    });
    const searchData = await searchResp.json();
    res.json(searchData);
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/trending', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.query;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return res.json({ error: 'Auth failed' });
    const players = await getTrendingPlayers(tokenData.access_token);
    res.json({ players });
  } catch(e) {
    res.json({ players: ANCHOR_PLAYERS });
  }
});

app.get('/token', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.query;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Card scanner proxy running');
});
