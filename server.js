const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BART_API_KEY = 'MW9S-E7SL-26DU-VV8V';
const BART_BASE = 'https://api.bart.gov';

function fetchBartApi(apiPath) {
  return new Promise((resolve, reject) => {
    const url = `${BART_BASE}${apiPath}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse BART API response'));
        }
      });
    }).on('error', reject);
  });
}

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Proxy: station list
app.get('/api/stations', async (req, res) => {
  try {
    const data = await fetchBartApi(`/api/stn.aspx?cmd=stns&key=${BART_API_KEY}&json=y`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch stations', detail: err.message });
  }
});

// Proxy: real-time departures
app.get('/api/departures', async (req, res) => {
  const station = req.query.station;
  if (!station) {
    return res.status(400).json({ error: 'Missing station parameter' });
  }
  try {
    const data = await fetchBartApi(
      `/api/etd.aspx?cmd=etd&orig=${encodeURIComponent(station)}&key=${BART_API_KEY}&json=y`
    );
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch departures', detail: err.message });
  }
});

// Proxy: trip planner
app.get('/api/trip', async (req, res) => {
  const { orig, dest } = req.query;
  if (!orig || !dest) {
    return res.status(400).json({ error: 'Missing orig or dest parameter' });
  }
  try {
    const data = await fetchBartApi(
      `/api/sched.aspx?cmd=depart&orig=${encodeURIComponent(orig)}&dest=${encodeURIComponent(dest)}&key=${BART_API_KEY}&json=y&a=3&b=0`
    );
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch trip info', detail: err.message });
  }
});

// Proxy: all routes with station lists (for filtering departures)
app.get('/api/routes', async (req, res) => {
  try {
    const routeList = await fetchBartApi(
      `/api/route.aspx?cmd=routes&key=${BART_API_KEY}&json=y`
    );
    const routes = routeList.root.routes.route;

    // Fetch station lists for all routes in parallel
    const detailed = await Promise.all(
      routes.map(async (r) => {
        const info = await fetchBartApi(
          `/api/route.aspx?cmd=routeinfo&route=${r.number}&key=${BART_API_KEY}&json=y`
        );
        const route = info.root.routes.route;
        return {
          number: r.number,
          name: r.name,
          abbr: r.abbr,
          color: r.color,
          stations: route.config.station,
        };
      })
    );

    res.json(detailed);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch routes', detail: err.message });
  }
});

// Local dev: start server. On Vercel: export for serverless.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`BART Commute server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
