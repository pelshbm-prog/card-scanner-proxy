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

async function getSoldComps(token, title, grade) {
  try {
    const cleanTitle = title
      .replace(/\d+\/\d+/g, '')
      .replace(/R\d{4,}/gi, '')
      .replace(/PSA\s*\d+(\.\d+)?/gi, '')
      .replace(/BGS\s*\d+(\.\d+)?/gi, '')
      .replace(/SGC\s*\d+(\.\d+)?/gi, '')
      .replace(/GEM\s*MINT/gi, '')
      .replace(/GEM\s*MT/gi, '')
      .trim()
      .slice(0, 70);

    const query = `${cleanTitle} ${grade}`;
    const filter = 'buyingOptions:{AUCTION|FIXED_PRICE},conditionIds:{2750}';
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search`
      + `?q=${encodeURIComponent(query)}`
      + `&category_ids=261328`
      + `&filter=${encodeURIComponent(filter)}`
      + `&sort=endingSoonest`
      + `&limit=10`;

    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });
    const data = await r.json();
    const items = data.itemSummaries || [];

    const prices = items
      .map(item => {
        const p = item.currentBidPrice || item.price;
        return p ? parseFloat(p.value) : null;
      })
      .filter(p => p && p > 5 && p < 100000);

    if (prices.length < 2) return null;

    prices.sort((a, b) => a - b);
    const trimmed = prices.length > 4 ? prices.slice(1, -1) : prices;
    const avg = trimmed.reduce((s, p) => s + p, 0) / trimmed.length;
    const low = Math.min(...trimmed);
    const high = Math.max(...trimmed);

    return { low: Math.round(low), high: Math.round(high), mid: Math.round(avg), count: prices.length };
  } catch(e) {
    return null;
  }
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
      || title.includes('SGC');
    if (!isGraded) return false;
    if (grade === 'PSA 10') return /PSA\s*10/.test(title) && !/PSA\s*9[^0]/.test(title) && !/BGS/.test(title);
    if (grade === 'PSA 9') return /PSA\s*9(?!\.5|\s*10)/.test(title) && !/BGS/.test(title);
    if (grade === 'BGS 9.5') return /BGS\s*9\.5/.test(title);
    if (grade === 'AUTO') return /(AUTO|AUTOGRAPH)/.test(title) && /(PSA\s*9\.5|PSA\s*10|BGS\s*9\.5)/.test(title);
    return false;
  });
}

function removeZeroBidAuctions(items) {
  return items.filter(item => {
    const isAuction = (item.buyingOptions || []).includes('AUCTION');
    if (!isAuction) return true;
    const bid = item.currentBidPrice || item.price;
    const bidVal = bid ? parseFloat(bid.value) : 0;
    return bidVal > 0;
  });
}

app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, grade } = req.query;
    const token = await getToken(clientId, clientSecret);

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
    const gradeFiltered = filterByGrade(all, grade || 'PSA 10');

    // Remove zero bid auctions
    const withBids = removeZeroBidAuctions(gradeFiltered);

    // Sort auctions ending soonest first then fixed price
    withBids.sort((a, b) => {
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

    const top = withBids.slice(0, 30);

    // Get sold comps for each card
    const batchSize = 10;
    for (let i = 0; i < top.length; i += batchSize) {
      const batch = top.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        const comps = await getSoldComps(token, item.title || '', grade || 'PSA 10');
        if (comps && comps.count >= 2) {
          item.soldComps = comps;
        }
      }));
    }

    res.json({ itemSummaries: top });
  } catch(e) {
    res.json({ error: e.message });
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
