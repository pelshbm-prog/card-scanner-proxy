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

async function searchCards(token, grade, buyingOption) {
  try {
    const gradeQuery = grade === 'AUTO'
      ? 'rookie auto graded PSA BGS SGC'
      : `rookie ${grade}`;

    const now = new Date().toISOString();
    const twoHours = new Date(Date.now() + 7200000).toISOString();

    let filter = `price:[50..500],priceCurrency:USD,buyingOptions:{${buyingOption}}`;
    if (buyingOption === 'AUCTION') {
      filter += `,endTimeFrom:${now},endTimeTo:${twoHours}`;
    }

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search`
      + `?q=${encodeURIComponent(gradeQuery + ' -reprint -lot -custom -break')}`
      + `&category_ids=261328`
      + `&sort=${buyingOption === 'AUCTION' ? 'endingSoonest' : 'newlyListed'}`
      + `&limit=50`
      + `&filter=${encodeURIComponent(filter)}`;

    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });
    const data = await r.json();
    return data.itemSummaries || [];
  } catch(e) {
    return [];
  }
}

function filterByGrade(items, grade) {
  return items.filter(item => {
    const title = (item.title || '').toUpperCase();
    const condition = (item.condition || '').toUpperCase();
    const isGraded = condition === 'GRADED'
      || title.includes('PSA')
      || title.includes('BGS')
      || title.includes('SGC')
      || title.includes('CGC');
    if (!isGraded) return false;
    if (grade === 'PSA 10') return /PSA\s*10/.test(title) && !/PSA\s*9[^0]/.test(title) && !/BGS/.test(title);
    if (grade === 'PSA 9') return /PSA\s*9(?!\.5|\s*10)/.test(title) && !/BGS/.test(title);
    if (grade === 'BGS 9.5') return /BGS\s*9\.5/.test(title);
    if (grade === 'AUTO') return /(AUTO|AUTOGRAPH)/.test(title) && /(PSA\s*9\.5|PSA\s*10|BGS\s*9\.5)/.test(title);
    return false;
  });
}

app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, grade } = req.query;
    const token = await getToken(clientId, clientSecret);

    // Run auction and fixed price searches in parallel
    const [auctionItems, fixedItems] = await Promise.all([
      searchCards(token, grade, 'AUCTION'),
      searchCards(token, grade, 'FIXED_PRICE')
    ]);

    // Combine and dedupe
    const seen = {};
    const all = [...auctionItems, ...fixedItems].filter(item => {
      if (seen[item.itemId]) return false;
      seen[item.itemId] = true;
      return true;
    });

    // Filter to exact grade
    const filtered = filterByGrade(all, grade || 'PSA 10');

    // Sort auctions ending soonest first, then fixed price
    filtered.sort((a, b) => {
      const aIsAuction = (a.buyingOptions || []).includes('AUCTION');
      const bIsAuction = (b.buyingOptions || []).includes('AUCTION');
      if (aIsAuction && !bIsAuction) return -1;
      if (!aIsAuction && bIsAuction) return 1;
      if (aIsAuction && bIsAuction) {
        const ta = a.itemEndDate ? new Date(a.itemEndDate).getTime() : 9999999999999;
        const tb = b.itemEndDate ? new Date(b.itemEndDate).getTime() : 9999999999999;
        return ta - tb;
      }
      return 0;
    });

    res.json({ itemSummaries: filtered.slice(0, 40) });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/trending', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.query;
    const token = await getToken(clientId, clientSecret);
    const namePattern = /\b(Mahomes|Brady|Burrow|Herbert|Josh Allen|Lamar Jackson|Stroud|Caleb Williams|Jayden Daniels|Jeanty|Wembanyama|Flagg|Luka|Tatum|SGA|Anthony Edwards|Ohtani|Judge|Trout|Acuna)\b/gi;
    const players = new Set(['Mahomes','Tom Brady']);
    const searches = ['PSA 10 rookie graded auction','BGS 9.5 rookie graded hot'];
    for (const q of searches) {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&category_ids=261328&sort=bestMatch&limit=30`;
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
      const data = await r.json();
      (data.itemSummaries || []).forEach(item => {
        const matches = (item.title || '').match(namePattern);
        if (matches) matches.forEach(m => players.add(m));
      });
    }
    res.json({ players: [...players].slice(0, 12) });
  } catch(e) {
    res.json({ players: ['Mahomes', 'Tom Brady'] });
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
