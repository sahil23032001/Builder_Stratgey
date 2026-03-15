// api/spot.js  ← place this at the ROOT of your project (not inside /src)
// Vercel serverless function — runs server-side, no CORS issues
// URL: GET /api/spot?symbol=^NSEBANK

export default async function handler(req, res) {
  // Allow your frontend to call this
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const response = await fetch(url, {
      headers: {
        // Yahoo Finance requires a browser-like User-Agent
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance returned ${response.status}` });
    }

    const data = await response.json();
    const meta  = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose;

    if (!price) return res.status(502).json({ error: "Price not found in Yahoo Finance response" });

    // Cache the response for 5 minutes at the CDN level
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({
      price,
      symbol,
      currency: meta?.currency || "INR",
      exchange: meta?.exchangeName || "NSI",
      marketTime: meta?.regularMarketTime,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
