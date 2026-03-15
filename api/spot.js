// api/spot.js — Vercel serverless function
// Uses Alpha Vantage free API — no IP restrictions, works from any server
// Free tier: 25 requests/day — enough for dev/demo use
// Get your free key at: https://www.alphavantage.co/support/#api-key

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { instrument } = req.query;
  if (!instrument) return res.status(400).json({ error: "instrument is required" });

  // Alpha Vantage symbols for Indian indices
  const AV_MAP = {
    BANKNIFTY:   "NIFTYBANK.BSE",
    NIFTY:       "NIFTY50.BSE",
    NIFTY50:     "NIFTY50.BSE",
    MIDCAPNIFTY: "BSE-NIFTY_MID_SELECT",
    FINNIFTY:    "NIFTY_FIN_SERVICE.BSE",
    SENSEX:      "BSE:SENSEX",
  };

  const avSymbol = AV_MAP[instrument.toUpperCase()];
  if (!avSymbol) return res.status(400).json({ error: `Unknown instrument: ${instrument}` });

  const apiKey = process.env.ALPHA_VANTAGE_KEY || "demo";

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(avSymbol)}&apikey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Alpha Vantage returned ${response.status}`);

    const data  = await response.json();
    const quote = data["Global Quote"];

    if (!quote || !quote["05. price"]) {
      throw new Error("Price not found — check symbol or API key");
    }

    const price = parseFloat(quote["05. price"]);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    return res.status(200).json({
      price,
      instrument: instrument.toUpperCase(),
      open:    parseFloat(quote["02. open"]),
      high:    parseFloat(quote["03. high"]),
      low:     parseFloat(quote["04. low"]),
      change:  quote["09. change"],
      pChange: quote["10. change percent"],
      source:  "alphavantage",
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
