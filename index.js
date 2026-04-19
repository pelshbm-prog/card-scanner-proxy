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

async function getSoldComps(appId, title, grade) {
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
      .slice(0, 60);

    const query = `${cleanTitle} ${grade}`;

    const url = 'https://svcs.ebay.com/services/search/FindingService/v1'
      + '?OPERATION-NAME=findCompletedItems'
      + '&SERVICE-VERSION=1.0.0'
      + '&SECURITY-APPNAME=' + encodeURIComponent(appId)
      + '&RESPONSE-DATA-FORMAT=JSON'
      + '&REST-PAYLOAD'
      + '&keywords=' + encodeURIComponent(query)
      + '&categoryId=261328'
      + '&itemFilter(0).name=SoldItemsOnly'
      + '&itemFilter(0).value=true'
      + '&itemFilter(1).name=ListingType'
      + '&itemFilter(1).value=AuctionWithBIN'
      + '&itemFilter(2).name=ListingType'
      + '&itemFilter(2).value=FixedPrice'
      + '&itemFilter(3).name=ListingType'
      + '&itemFilter(3).value=Auction'
      + '&itemFilter(4).name=MinPrice'
      + '&itemFilter(4).value=10'
      + '&itemFilter(5).name=MaxPrice'
      + '&itemFilter(5).value=50000'
      + '&sortOrder=EndTimeSoonest'
      + '&paginationInput.entriesPerPage=20';

    const r = await fetch(url);
    const data = await r.json();

    const items = (data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item) || [];
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    const prices = items
      .filter(item => {
        const endTime = item?.listingInfo?.[0]?.endTime?.[0];
        if (!endTime) return false;
        return new Date(endTime).getTime() > ninetyDaysAgo;
      })
      .map(item => {
        const price = item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__;
        return price ? parseFloat(price) : null;
      })
      .filter(p => p && p > 5 && p < 100000);

    if (prices.length < 2) return null;

    prices.sort((a, b) => a - b);
    const trimmed = prices.length > 4 ? prices.slice(1, -1) : prices;
    const avg = trimmed.reduce((s, p) => s + p, 0) / trimmed.length;

    return {
      low: Math.round(Math.min(...trimmed)),
      high: Math.round(Math.max(...trimmed)),
      mid: Math.round(avg),
      count: prices.length
    };
  } catch(e) {
    return null;
  }
}

async function searchCards(token, grade, buyingOption, windowHours) {
  try {
    const gradeQuery = grade === 'AUTO'
      ? 'rookie auto graded PSA BGS SGC'
      : `rookie ${grade}`;

    const now = new Date().toISOString();
    const windowMs = (windowHours || 2) * 3600000;
    const windowEnd = new Date(Date.now() + windowMs).toISOString();

    let filter = `price:[50..500],priceCurrency:USD,buyingOptions:{${buyingOption}}`;
    if (buyingOption === 'AUCTION') {
      filter += `,endTimeFrom:${now},endTimeTo:${windowEnd}`;
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
    if ((item.buyingOptions || []).includes('BEST_OFFER')) return false;
    const bid = item.currentBidPrice || item.price;
    const bidVal = bid ? parseFloat(bid.value) : 0;
    return bidVal > 0;
  });
}

app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, grade, window } = req.query;
    const windowHours = parseFloat(window) || 2;
    const token = await getToken(clientId, clientSecret);

    const [auctionItems, fixedItems] = await Promise.all([
      searchCards(token, grade, 'AUCTION', windowHours),
      searchCards(token, grade, 'FIXED_PRICE', windowHours)
    ]);

    const seen = {};
    const all = [...auctionItems, ...fixedItems].filter(item => {
      if (seen[item.itemId]) return false;
      seen[item.itemId] = true;
      return true;
    });

    const gradeFiltered = filterByGrade(all, grade || 'PSA 10');
    const withBids = removeZeroBidAuctions(gradeFiltered);

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

    const batchSize = 10;
    for (let i = 0; i < top.length; i += batchSize) {
      const batch = top.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        const comps = await getSoldComps(clientId, item.title || '', grade || 'PSA 10');
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
