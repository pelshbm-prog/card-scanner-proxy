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
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Auth failed');
  return data.access_token;
}

function buildCompQuery(title, grade) {
  const t = title.toLowerCase();
  const players = [
    'mahomes','brady','josh allen','lamar jackson','burrow','herbert',
    'stroud','caleb williams','jayden daniels','jeanty','prescott',
    'wembanyama','flagg','anthony edwards','luka','tatum','gilgeous',
    'ja morant','booker','giannis','curry','lebron','jordan',
    'judge','ohtani','trout','acuna','soto','witt','griffey',
    'jefferson','hill','kelce','mccaffrey','henry','barkley',
    'manning','rodgers','montana','elway','favre','marino'
  ];
  const sets = [
    'prizm','donruss','topps chrome','bowman chrome','contenders',
    'optic','select','hoops','mosaic','score','topps','bowman',
    'fleer','upper deck','sp authentic','spectra','national treasures'
  ];
  const player = players.find(p => t.includes(p)) || '';
  const set = sets.find(s => t.includes(s)) || '';

  if (player && set) return `${player} ${set} rookie ${grade}`;
  if (player) return `${player} rookie ${grade}`;

  // Fall back to cleaned title
  return title
    .replace(/\d+\/\d+/g, '')
    .replace(/R\d{4,}/gi, '')
    .replace(/PSA\s*\d+(\.\d+)?/gi, '')
    .replace(/BGS\s*\d+(\.\d+)?/gi, '')
    .replace(/SGC\s*\d+(\.\d+)?/gi, '')
    .replace(/GEM\s*MINT/gi, '')
    .replace(/GEM\s*MT/gi, '')
    .trim()
    .slice(0, 55) + ' ' + grade;
}

async function getSoldComps(appId, title, grade) {
  const query = buildCompQuery(title, grade);
  const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

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
    + '&paginationInput.entriesPerPage=20';

  const r = await fetch(url);
  const data = await r.json();
  const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

  const sales = items
    .filter(item => {
      const endTime = item?.listingInfo?.[0]?.endTime?.[0];
      return endTime && new Date(endTime).getTime() > ninetyDaysAgo;
    })
    .map(item => {
      const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0);
      const endTime = item?.listingInfo?.[0]?.endTime?.[0];
      const date = endTime ? new Date(endTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const title = item?.title?.[0] || '';
      return { price, date, title };
    })
    .filter(s => s.price > 5 && s.price < 100000)
    .slice(0, 8);

  if (sales.length < 2) return { prices: [], avg: 0, query };

  const prices = sales.map(s => s.price).sort((a, b) => a - b);
  const trimmed = prices.length >= 5 ? prices.slice(1, -1) : prices;
  const avg = Math.round(trimmed.reduce((s, p) => s + p, 0) / trimmed.length);

  // Return last 5 most recent
  return {
    prices: sales.slice(0, 5),
    avg,
    count: sales.length,
    query
  };
}

async function searchAuctions(token, grade, windowHours) {
  const hours = Math.min(windowHours || 2, 24);
  const now = new Date().toISOString();
  const windowEnd = new Date(Date.now() + hours * 3600000).toISOString();

  let gradeQuery;
  if (grade === 'ALL') {
    gradeQuery = 'rookie graded PSA BGS SGC';
  } else {
    gradeQuery = `rookie ${grade}`;
  }

  const filter = `price:[25..1000],priceCurrency:USD,buyingOptions:{AUCTION},endTimeFrom:${now},endTimeTo:${windowEnd}`;

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search`
    + `?q=${encodeURIComponent(gradeQuery + ' -reprint -lot -custom -break -team -set')}`
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
}

function filterByGrade(items, grade) {
  if (grade === 'ALL') {
    return items.filter(item => {
      const title = (item.title || '').toUpperCase();
      const condition = (item.condition || '').toUpperCase();
      return condition === 'GRADED'
        || title.includes('PSA')
        || title.includes('BGS')
        || title.includes('SGC');
    });
  }
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
    return true;
  });
}

function removeNoBids(items) {
  return items.filter(item => {
    if ((item.buyingOptions || []).includes('BEST_OFFER')) return false;
    const bid = item.currentBidPrice || item.price;
    const bidVal = bid ? parseFloat(bid.value) : 0;
    return bidVal > 0;
  });
}

function enforceWindow(items, windowHours) {
  const cutoff = Date.now() + Math.min(windowHours || 2, 24) * 3600000;
  return items.filter(item => {
    if (!item.itemEndDate) return false;
    const end = new Date(item.itemEndDate).getTime();
    return end > Date.now() && end <= cutoff;
  });
}

// Scan endpoint — returns auctions ending within window
app.get('/scan', async (req, res) => {
  try {
    const { clientId, clientSecret, grade, window } = req.query;
    const windowHours = Math.min(parseFloat(window) || 2, 24);
    const token = await getToken(clientId, clientSecret);

    let items = await searchAuctions(token, grade || 'PSA 10', windowHours);
    items = filterByGrade(items, grade || 'PSA 10');
    items = removeNoBids(items);
    items = enforceWindow(items, windowHours);

    items.sort((a, b) => {
      const ta = new Date(a.itemEndDate).getTime();
      const tb = new Date(b.itemEndDate).getTime();
      return ta - tb;
    });

    res.json({ itemSummaries: items.slice(0, 40) });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// Comps endpoint — returns last 5 sold prices for a specific card
app.get('/comps', async (req, res) => {
  try {
    const { clientId, title, grade } = req.query;
    const comps = await getSoldComps(clientId, title || '', grade || 'PSA 10');
    res.json(comps);
  } catch(e) {
    res.json({ prices: [], avg: 0, error: e.message });
  }
});

// Wake endpoint
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
  console.log('CardScan proxy running');
});
