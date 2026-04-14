const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

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
    if (!tokenData.access_token) {
      return res.json({ error: 'Auth failed', details: tokenData });
    }
    const token = tokenData.access_token;

    const encoded = encodeURIComponent(q);
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encoded}&category_ids=261328&sort=endingSoonest&limit=20&filter=buyingOptions:%7BAUCTION%7D,endTimeFrom:${new Date().toISOString()},endTimeTo:${new Date(Date.now()+3600000).toISOString()}`;
    const searchResp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json'
      }
    });
    const searchData = await searchResp.json();
    res.json(searchData);
  } catch(e) {
    res.json({ error: e.message });
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
