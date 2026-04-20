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

function extractCardInfo(title) {
  const t = title.toLowerCase();
  const players = [
    'mahomes','brady','josh allen','lamar jackson','burrow','herbert',
    'stroud','caleb williams','jayden daniels','jeanty','prescott',
    'wembanyama','flagg','anthony edwards','luka','tatum','sga','gilgeous',
    'ja morant','booker','giannis','curry','lebron',
    'judge','ohtani','trout','acuna','soto','witt',
    'jefferson','hill','kelce','mccaffrey','henry','barkley',
    'manning','rodgers','montana','elway','favre'
  ];
  const sets = [
    'prizm','donruss','topps chrome','bowman chrome','contenders',
    'optic','select','hoops','mosaic','score','topps','bowman','fleer',
    'upper deck','sp authentic','spectra','national treasures'
  ];
  let player = players.find(p => t.includes(p)) || '';
  let set = sets.find(s => t.includes(s)) || '';
  return { player, set };
}

async function getSoldComps(appId, title, grade) {
  try {
    const { player, set } = extractCardInfo(title);
    let query = '';
    if (player && set) {
      query = `${player} ${set} rookie ${grade}`;
    } else if (player) {
      query = `${player} rookie ${grade}`;
    } else {
      query = title
        .replace(/\d+\/\d+/g, '')
        .replace(/R\d{4,}/gi, '')
        .replace(/PSA\s*\d+(\.\d+)?/gi, '')
        .replace(/BGS\s*\d+(\.\d+)?/gi, '')
        .replace(/GEM\s*MINT/gi, '')
        .trim()
        .slice(0, 50) + ' ' + grade;
    }

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
      + '&itemFilter(1).name=MinPrice'
      + '&itemFilter(1).value=10'
      + '&itemFilter(2).name=MaxPrice'
      + '&itemFilter(2).value=100000'
      + '&sortOrder=EndTimeSoonest'
      + '&paginationInput.entriesPerPage=30';

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
    const trimmed = prices.length >= 5 ? prices.slice(1, -1) : prices;
    const avg = trimmed.reduce((s, p) => s + p, 0) / trimmed.length;

    if (Math.max(...trimmed) / Math.min(...trimmed) > 8) return null;

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

async function searchAuctions(token, grade, windowHours) {
  try {
    const gradeQuery = grade === 'AUTO'
      ? 'rookie auto graded PSA BGS SGC'
      : `rookie ${grade}`;

    const now = new Date().toISOString();
    // Hard cap at 24 hours max — no exceptions
    const hours = Math.min(windowHours || 2, 24);
    const windowEnd = new Date(Date.now() + hours * 3600000).toISOString();

    // Auctions only — hard enforced end time window
    const filter = `price:[25..1000],priceCurrency:USD,buyingOptions:{AUCTION},endTimeFrom:${now},endTimeTo:${windowEnd}`;

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search`
      + `?q=${encodeURIComponent(gradeQuery + ' -reprint -lot -custom -break')}`
      + `&category_ids=261328`
      + `&sort=endingSoonest`
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
    // Remove Best Offer listings
    if ((item.buyingOptions || []).includes('BEST_OFFER')) return false;
    const bid = item.currentBidPrice || item.price;
    const bidVal = bid ? parseFloat(bid.value) : 0;
    return bidVal > 0;
  });
}

function enforceEndTimeWindow(items, windowHours) {
  const maxMs = Math.min(windowHours || 2, 24) * 3600000;
  const cutoff = Date.now() + maxMs;
  return items.filter(item => {
    if (!item.itemEndDate) return false;
    const endMs = new Date(item.itemEndDate).getTime();
    // Must end within window AND in the future
    return endMs > Date.now() && endMs <= cutoff;
  });
}

app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, grade, window } = req.query;
    const windowHours = Math.min(parseFloat(window) || 2, 24);
    const token = await getToken(clientId, clientSecret);

    const auctionItems = await searchAuctions(token, grade, windowHours);

    const seen = {};
    const unique = auctionItems.filter(item => {
      if (seen[item.itemId]) return false;
      seen[item.itemId] = true;
      return true;
    });

    // Filter by grade
    const gradeFiltered = filterByGrade(unique, grade || 'PSA 10');

    // Remove zero bids and best offer
    const withBids = removeZeroBidAuctions(gradeFiltered);

    // Double-enforce end time window client side too
    const inWindow = enforceEndTimeWindow(withBids, windowHours);

    // Sort ending soonest first
    inWindow.sort((a, b) => {
      const ta = new Date(a.itemEndDate).getTime();
      const tb = new Date(b.itemEndDate).getTime();
      return ta - tb;
    });

    const top = inWindow.slice(0, 40);

    // Get sold comps
    const batchSize = 10;
    for (let i = 0; i < top.length; i += batchSize) {
      const batch = top.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        const comps = await getSoldComps(clientId, item.title || '', grade || 'PSA 10');
        if (comps) item.soldComps = comps;
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
