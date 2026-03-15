// api/spot.js
// Yahoo Finance v8 now requires a crumb + cookie for server-side requests.
// Strategy: first hit yahoo.com to get a session cookie, extract the crumb,
// then use both in the actual chart API call.

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
  };

  try {
    // Step 1: Get session cookie from Yahoo Finance homepage
    const consentRes = await fetch("https://finance.yahoo.com", { headers: HEADERS });
    const rawCookies = consentRes.headers.get("set-cookie") || "";
    const cookies = rawCookies
      .split(",")
      .map(c => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    // Step 2: Get crumb using that cookie
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...HEADERS, "Cookie": cookies },
    });
    const crumb = (await crumbRes.text()).trim();

    // Step 3: Fetch the actual price with cookie + crumb
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d${crumb ? "&crumb=" + encodeURIComponent(crumb) : ""}`;
    let priceRes = await fetch(url, {
      headers: { ...HEADERS, "Cookie": cookies, "Referer": "https://finance.yahoo.com" },
    });

    // Fallback to query2 subdomain if query1 still 403s
    if (!priceRes.ok) {
      const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
      priceRes = await fetch(url2, {
        headers: { ...HEADERS, "Cookie": cookies, "Referer": "https://finance.yahoo.com" },
      });
    }

    if (!priceRes.ok) {
      return res.status(priceRes.status).json({ error: `Yahoo Finance returned ${priceRes.status}` });
    }

    const data  = await priceRes.json();
    const meta  = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose;
    if (!price) return res.status(502).json({ error: "Price not found in response" });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({
      price,
      symbol,
      currency:   meta?.currency     || "INR",
      exchange:   meta?.exchangeName || "NSI",
      marketTime: meta?.regularMarketTime,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
