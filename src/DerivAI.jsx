import { useState, useRef, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════ */
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;
const GROQ_API     = "https://api.groq.com/openai/v1/chat/completions";
const CORS_PROXY   = "https://corsproxy.io/?";
const CACHE_TTL    = 5 * 60 * 1000; // 5 min

/* ═══════════════════════════════════════════════════════════
   INSTRUMENT REFERENCE DATA
═══════════════════════════════════════════════════════════ */
const INSTRUMENTS = {
  BANKNIFTY:   { symbol: "^NSEBANK",            lotSize: 15,  strikeInterval: 100, exchange: "NSE" },
  NIFTY:       { symbol: "^NSEI",               lotSize: 50,  strikeInterval: 50,  exchange: "NSE" },
  MIDCAPNIFTY: { symbol: "NIFTY_MID_SELECT.NS", lotSize: 75,  strikeInterval: 25,  exchange: "NSE" },
  FINNIFTY:    { symbol: "NIFTY_FIN_SERVICE.NS", lotSize: 40, strikeInterval: 50,  exchange: "NSE" },
  SENSEX:      { symbol: "^BSESN",              lotSize: 10,  strikeInterval: 100, exchange: "BSE" },
};

const EXAMPLES = [
  "Bank Nifty 10000 rupees",
  "Nifty 50 with 25000 rupees",
  "Nifty weekly options 5000 rupees",
  "Midcap Nifty 50000 rupees",
  "Fin Nifty 15000 rupees",
  "Sensex options 30000 rupees",
];

const TYPE_CONFIG = {
  hedge:   { label: "Hedge / Protection", bg: "#eef4fd", color: "#1a5fb4", emoji: "🛡" },
  profit:  { label: "Directional Profit", bg: "#edf9f2", color: "#1a7a4a", emoji: "🚀" },
  neutral: { label: "Neutral / Income",   bg: "#fff3e0", color: "#c05c00", emoji: "⚖️" },
};

/* ═══════════════════════════════════════════════════════════
   INSTRUMENT DETECTION
   Parses free-text like "Bank Nifty 10000 rupees" → BANKNIFTY
═══════════════════════════════════════════════════════════ */
function detectInstrument(query = "") {
  const q = query.toUpperCase();
  if (q.includes("BANKNIFTY") || q.includes("BANK NIFTY")) return "BANKNIFTY";
  if (q.includes("MIDCAP"))                                 return "MIDCAPNIFTY";
  if (q.includes("FINNIFTY")  || q.includes("FIN NIFTY"))  return "FINNIFTY";
  if (q.includes("SENSEX"))                                 return "SENSEX";
  if (q.includes("NIFTY"))                                  return "NIFTY";
  return null;
}

/* ═══════════════════════════════════════════════════════════
   SPOT PRICE — Yahoo Finance via corsproxy.io
   Returns live (15-min delayed) index level, no API key needed
═══════════════════════════════════════════════════════════ */
const _priceCache = {};

async function fetchSpotPrice(instrumentKey) {
  const inst = INSTRUMENTS[instrumentKey];
  if (!inst) throw new Error(`Unknown instrument: ${instrumentKey}`);

  // Return cached value if still fresh
  const cached = _priceCache[instrumentKey];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price;

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${inst.symbol}?interval=1m&range=1d`;
  const proxyUrl = `${CORS_PROXY}${encodeURIComponent(yahooUrl)}`;

  const res = await fetch(proxyUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo Finance returned HTTP ${res.status}`);

  const json  = await res.json();
  const meta  = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice ?? meta?.previousClose;
  if (!price) throw new Error("Could not parse price from Yahoo Finance");

  _priceCache[instrumentKey] = { price, ts: Date.now() };
  return price;
}

/* ═══════════════════════════════════════════════════════════
   STRIKE HELPERS
═══════════════════════════════════════════════════════════ */
function getATMStrike(price, interval) {
  return Math.round(price / interval) * interval;
}

function buildStrikeContext(spotPrice, instrumentKey) {
  const inst     = INSTRUMENTS[instrumentKey];
  const atm      = getATMStrike(spotPrice, inst.strikeInterval);
  const iv       = inst.strikeInterval;
  const calls    = [atm, atm + iv, atm + 2 * iv, atm + 3 * iv];
  const puts     = [atm, atm - iv, atm - 2 * iv, atm - 3 * iv];
  return { atm, calls, puts, lotSize: inst.lotSize, strikeInterval: iv };
}

/* ═══════════════════════════════════════════════════════════
   DETERMINISTIC BEP CALCULATOR
   Computed from actual leg data — never relies on AI math
═══════════════════════════════════════════════════════════ */
function computeBEP(_strategyName, legs) {
  function parseStrike(legInstrument = "") {
    const m = legInstrument.match(/(\d{4,6})\s*(CE|PE)/i);
    return m ? parseInt(m[1]) : null;
  }
  function parsePremium(approxPremium = "") {
    // handles "Rs.3000 total", "Rs.1500 credit", "Net credit Rs.2100"
    const m = approxPremium.replace(/,/g, "").match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  const buy  = legs.filter(l => l.action === "BUY");
  const sell = legs.filter(l => l.action === "SELL");

  // ── Single buy leg (Long Call / Long Put) ──────────────────
  if (buy.length === 1 && sell.length === 0) {
    const strike = parseStrike(buy[0].instrument);
    const ltp    = parsePremium(buy[0].approxPremium);
    if (!strike || !ltp) return null;
    const isCall = /CE/i.test(buy[0].instrument);
    if (isCall) return { bep: strike + ltp, maxProfit: "Unlimited", maxLoss: ltp };
    else        return { bep: strike - ltp, maxProfit: strike - ltp, maxLoss: ltp };
  }

  // ── One buy + one sell (Bull Call Spread / Bear Put Spread) ──
  if (buy.length === 1 && sell.length === 1) {
    const buyStrike  = parseStrike(buy[0].instrument);
    const sellStrike = parseStrike(sell[0].instrument);
    const buyPrem    = parsePremium(buy[0].approxPremium);
    const sellPrem   = parsePremium(sell[0].approxPremium);
    if (!buyStrike || !sellStrike || !buyPrem || !sellPrem) return null;
    const netDebit   = buyPrem - sellPrem;
    const spread     = Math.abs(sellStrike - buyStrike);
    return {
      bep: buyStrike + netDebit,
      netDebit,
      maxProfit: spread - netDebit,
      maxLoss: netDebit,
    };
  }

  // ── Two sell legs (Short Strangle / Short Straddle) ────────
  if (buy.length === 0 && sell.length === 2) {
    const s0    = parseStrike(sell[0].instrument);
    const s1    = parseStrike(sell[1].instrument);
    const ltp0  = parsePremium(sell[0].approxPremium);
    const ltp1  = parsePremium(sell[1].approxPremium);
    if (!s0 || !s1 || !ltp0 || !ltp1) return null;
    const credit = ltp0 + ltp1;
    const upper  = Math.max(s0, s1) + credit;
    const lower  = Math.min(s0, s1) - credit;
    return {
      bep: `${lower.toFixed(0)} – ${upper.toFixed(0)}`,
      maxProfit: credit,
      maxLoss: "Unlimited",
    };
  }

  return null; // unknown structure — keep AI value
}

function formatRs(val) {
  if (val === null || val === undefined) return "—";
  if (typeof val === "string") return val;
  return "Rs." + val.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/* ═══════════════════════════════════════════════════════════
   GROQ API
═══════════════════════════════════════════════════════════ */
async function callGroq(messages, system) {
  const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
  const res = await fetch(GROQ_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 4000, messages: msgs }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in response");
  return JSON.parse(match[0]);
}

/* ═══════════════════════════════════════════════════════════
   useBreakpoint
═══════════════════════════════════════════════════════════ */
function useBreakpoint() {
  const [bp, setBp] = useState(() => {
    if (typeof window === "undefined") return "desktop";
    const w = window.innerWidth;
    return w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
  });
  useEffect(() => {
    const h = () => {
      const w = window.innerWidth;
      setBp(w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop");
    };
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return bp;
}

/* ═══════════════════════════════════════════════════════════
   SpotPriceBadge — shows inside the dark sidebar
═══════════════════════════════════════════════════════════ */
function SpotPriceBadge({ instrumentKey, onStrikeClick }) {
  const [price,       setPrice]       = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const doFetch = useCallback(async () => {
    if (!instrumentKey) return;
    setLoading(true); setError(null);
    try {
      const p = await fetchSpotPrice(instrumentKey);
      setPrice(p); setLastUpdated(new Date());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [instrumentKey]);

  useEffect(() => {
    doFetch();
    const id = setInterval(doFetch, CACHE_TTL);
    return () => clearInterval(id);
  }, [doFetch]);

  if (!instrumentKey) return null;

  const fmt = n => n?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—";
  const timeStr = lastUpdated?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const strikes = price ? buildStrikeContext(price, instrumentKey) : null;

  return (
    <div style={{
      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 10, padding: "12px 14px", marginBottom: 14,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", display: "inline-block", flexShrink: 0,
            background: error ? "#e74c3c" : loading ? "#c9a84c" : price ? "#2ecc71" : "#555",
          }} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase" }}>
            {instrumentKey} Live Spot
          </span>
        </div>
        <button onClick={doFetch} disabled={loading} title="Refresh" style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.3)",
          cursor: loading ? "not-allowed" : "pointer", fontSize: 15, padding: 0, lineHeight: 1,
        }}>↻</button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#e74c3c", lineHeight: 1.5 }}>
          Fetch failed — check internet / corsproxy.io<br />
          <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>{error}</span>
        </div>
      )}

      {!error && (
        <>
          {/* Price */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>
              {loading && !price ? "Loading…" : fmt(price)}
            </span>
            {timeStr && (
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                {timeStr} · 15-min delay
              </span>
            )}
          </div>

          {/* ATM */}
          {strikes && (
            <>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 5 }}>
                ATM Strike
              </div>
              <button onClick={() => onStrikeClick?.(strikes.atm)} style={{
                background: "rgba(201,168,76,0.18)", border: "1px solid rgba(201,168,76,0.4)",
                borderRadius: 6, padding: "4px 12px", color: "#c9a84c", fontWeight: 800,
                fontSize: 15, cursor: "pointer", fontFamily: "inherit", marginBottom: 10,
              }}>
                {fmt(strikes.atm)}
              </button>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginLeft: 8 }}>
                nearest {strikes.strikeInterval}
              </span>

              {/* Nearby strikes */}
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 5, marginTop: 8 }}>
                Nearby Strikes
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {strikes.calls.slice(1).map(s => (
                  <button key={"c"+s} onClick={() => onStrikeClick?.(s)} style={strikeChip("#1a7a4a", "rgba(26,122,74,0.2)")}>
                    {fmt(s)} CE
                  </button>
                ))}
                {strikes.puts.slice(1).map(s => (
                  <button key={"p"+s} onClick={() => onStrikeClick?.(s)} style={strikeChip("#b5261e", "rgba(181,38,30,0.2)")}>
                    {fmt(s)} PE
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const strikeChip = (color, bg) => ({
  background: bg, border: `1px solid ${color}55`, borderRadius: 5,
  padding: "3px 8px", color, fontWeight: 700, fontSize: 11,
  cursor: "pointer", fontFamily: "inherit",
});

/* ═══════════════════════════════════════════════════════════
   InputPanel
═══════════════════════════════════════════════════════════ */
function InputPanel({ query, setQuery, generate, loading, result, onClose, bp, instrumentKey, onStrikeClick }) {
  const p = result?.parsed;
  return (
    <div style={{
      background: "#0f0e17", color: "#fff", display: "flex", flexDirection: "column",
      padding: bp === "mobile" ? "20px 18px 24px" : "28px 24px",
      height: bp === "mobile" ? "auto" : "100%",
      overflowY: "auto", boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: bp === "mobile" ? 22 : 26, fontWeight: 800, letterSpacing: "-0.5px" }}>
            Deriv<span style={{ color: "#c9a84c", fontStyle: "italic" }}>AI</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 3 }}>
            Indian Derivatives Strategy Builder
          </div>
        </div>
        {bp === "mobile" && onClose && (
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8,
            color: "#fff", fontSize: 18, width: 36, height: 36, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>✕</button>
        )}
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", marginBottom: 8 }}>
        What do you want to trade?
      </div>

      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } }}
        placeholder="e.g. Bank Nifty 10000 rupees"
        rows={3}
        style={{
          width: "100%", boxSizing: "border-box",
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 10, color: "#fff", fontSize: bp === "mobile" ? 17 : 20,
          fontWeight: 700, padding: "14px 16px", outline: "none", resize: "none",
          lineHeight: 1.4, fontFamily: "inherit",
        }}
      />

      {/* Example chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 14px" }}>
        {EXAMPLES.map(ex => (
          <button key={ex} onClick={() => setQuery(ex)} style={{
            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 20, padding: "5px 11px", fontSize: 11,
            color: "rgba(255,255,255,0.55)", cursor: "pointer", fontFamily: "inherit",
          }}>
            {ex.replace(" rupees", "").replace("with ", "")}
          </button>
        ))}
      </div>

      {/* Live spot price badge — shown as soon as instrument is detected */}
      <SpotPriceBadge instrumentKey={instrumentKey} onStrikeClick={onStrikeClick} />

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={loading || !query.trim()}
        style={{
          width: "100%", padding: 13, background: "#c9a84c", color: "#0f0e17",
          border: "none", borderRadius: 10, fontWeight: 800, fontSize: 14,
          cursor: (loading || !query.trim()) ? "not-allowed" : "pointer",
          opacity: (loading || !query.trim()) ? 0.45 : 1, fontFamily: "inherit",
        }}
      >
        {loading ? "⏳ Analyzing..." : "⚡ Generate Strategy"}
      </button>

      {/* Parsed summary after result */}
      {p && (
        <div style={{
          marginTop: 16, background: "rgba(201,168,76,0.1)",
          border: "1px solid rgba(201,168,76,0.28)", borderRadius: 10, padding: "12px 14px",
        }}>
          {[["Instrument", p.instrument], ["Capital", p.capitalFormatted], ["Type", p.type], ["Exchange", p.exchange]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
              <span style={{ color: "rgba(255,255,255,0.42)" }}>{k}</span>
              <span style={{ color: "#c9a84c", fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 20, fontSize: 10, color: "rgba(255,255,255,0.24)", lineHeight: 1.6 }}>
        ⚠️ Educational only. Not SEBI-registered advice. Options carry substantial risk. Consult a licensed advisor.
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════ */
export default function DerivAI() {
  const [query,       setQuery]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState(null);
  const [error,       setError]       = useState("");
  const [spotStatus,  setSpotStatus]  = useState(""); // shows "Fetched BANKNIFTY @ 51847" during loading
  const [chatMsgs,    setChatMsgs]    = useState([]);
  const [chatInput,   setChatInput]   = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [drawerOpen,  setDrawerOpen]  = useState(false);

  const chatRef = useRef(null);
  const bp      = useBreakpoint();
  const isMobile  = bp === "mobile";
  const isTablet  = bp === "tablet";

  // Detect instrument from query in real time
  const instrumentKey = detectInstrument(query);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMsgs]);

  useEffect(() => { if (result && isMobile) setDrawerOpen(false); }, [result, isMobile]);

  useEffect(() => {
    if (isMobile) document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen, isMobile]);

  /* ── Strike click: append to query ── */
  function handleStrikeClick(strike) {
    setQuery(prev => {
      const cleaned = prev.replace(/\s*near\s*\d+/gi, "").trim();
      return `${cleaned} near ${strike}`;
    });
  }

  /* ── MAIN GENERATE ── */
  async function generate() {
    if (!query.trim()) return;
    setLoading(true); setError(""); setResult(null); setChatMsgs([]); setSpotStatus("");

    // ── Step 1: Fetch live spot price ──────────────────────
    let spotInfo = "";
    let strikeCtx = null;
    const instKey = detectInstrument(query);

    if (instKey) {
      try {
        setSpotStatus(`Fetching live ${instKey} price...`);
        const price = await fetchSpotPrice(instKey);
        strikeCtx   = buildStrikeContext(price, instKey);
        const inst  = INSTRUMENTS[instKey];
        setSpotStatus(`Got ${instKey} @ ${price.toLocaleString("en-IN")} · ATM ${strikeCtx.atm}`);
        spotInfo = `
LIVE MARKET DATA (use these — do not invent different strikes):
- ${instKey} spot price: ${price.toLocaleString("en-IN")}
- ATM strike: ${strikeCtx.atm}
- Lot size: ${inst.lotSize} units
- Strike interval: ${strikeCtx.strikeInterval}
- Nearby call strikes: ${strikeCtx.calls.join(", ")}
- Nearby put strikes:  ${strikeCtx.puts.join(", ")}
`;
      } catch (e) {
        setSpotStatus(`⚠️ Spot price unavailable (${e.message}) — using estimates`);
        spotInfo = `Live price unavailable. Use realistic approximate strikes for ${instKey}.`;
      }
    }

    // ── Step 2: Build prompt with real strike data ──────────
    const systemPrompt = `You are an expert Indian NSE derivatives trader and educator.
Return ONLY a raw JSON object. No markdown. No code fences. No explanation before or after.
Keep every string value under 100 characters.
CRITICAL: Use the exact strikes provided in LIVE MARKET DATA. Do NOT invent or round to different strikes.`;

    const userPrompt = `User wants to trade: "${query}"
${spotInfo}

Return this exact JSON structure:

{
  "parsed": {
    "instrument": "BANKNIFTY",
    "capitalFormatted": "Rs.10,000",
    "exchange": "NSE",
    "type": "Index Options"
  },
  "marketContext": "One sentence about current market conditions for this instrument.",
  "keyLevels": { "support": "51400", "resistance": "52200" },
  "strategies": [
    {
      "name": "Bull Call Spread",
      "type": "hedge",
      "description": "Two sentences explaining this strategy simply for a beginner.",
      "legs": [
        {
          "action": "BUY",
          "instrument": "BANKNIFTY 51800 CE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.200 per unit (Rs.3000 total)",
          "purpose": "Main profit leg if index rises above 51800"
        },
        {
          "action": "SELL",
          "instrument": "BANKNIFTY 52000 CE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.100 per unit (Rs.1500 credit)",
          "purpose": "Reduces total cost of the trade"
        }
      ],
      "beginnerTip": "One practical sentence for placing this trade with your stockbroker."
    },
    {
      "name": "Long Put",
      "type": "profit",
      "description": "Two sentences explaining this strategy.",
      "legs": [
        {
          "action": "BUY",
          "instrument": "BANKNIFTY 51800 PE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.180 per unit (Rs.2700 total)",
          "purpose": "Profits if index falls below 51800"
        }
      ],
      "beginnerTip": "One practical tip for a beginner."
    },
    {
      "name": "Short Strangle",
      "type": "neutral",
      "description": "Two sentences explaining this strategy.",
      "legs": [
        {
          "action": "SELL",
          "instrument": "BANKNIFTY 52200 CE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.80 per unit (Rs.1200 credit)",
          "purpose": "Earns premium if index stays below 52200"
        },
        {
          "action": "SELL",
          "instrument": "BANKNIFTY 51400 PE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.60 per unit (Rs.900 credit)",
          "purpose": "Earns premium if index stays above 51400"
        }
      ],
      "beginnerTip": "One practical caution for a beginner selling options."
    }
  ],
  "riskWarnings": [
    { "title": "Time Decay",      "detail": "Options lose value every day. Buyers lose, sellers benefit from this." },
    { "title": "Weekly Expiry",   "detail": "NSE options expire every Thursday. Wrong view means 100% premium loss." },
    { "title": "Bid-Ask Spread",  "detail": "Check the spread before entering. Wider spread = higher hidden cost." },
    { "title": "Capital Sizing",  "detail": "Never risk more than 20-30% of your total capital in one trade." }
  ]
}

IMPORTANT:
- Use the LIVE strikes provided above, not made-up ones.
- approxPremium must show both per-unit price AND total (per-unit × lot size).
- Adjust number of lots so total strategy cost fits within the user's capital.
- Use Rs. prefix for all money values (not the rupee symbol ₹).`;

    // ── Step 3: Call Groq ───────────────────────────────────
    try {
      const text = await callGroq([{ role: "user", content: userPrompt }], systemPrompt);
      const data = extractJSON(text);

      // ── Step 4: Overwrite BEP with deterministic JS math ──
      if (data.strategies) {
        data.strategies = data.strategies.map(s => {
          const computed = computeBEP(s.name, s.legs || []);
          if (computed) {
            s.breakeven  = String(computed.bep);
            s.totalCost  = computed.netDebit  != null ? formatRs(computed.netDebit)  : (s.totalCost  || "—");
            s.maxProfit  = computed.maxProfit === "Unlimited" ? "Unlimited" : formatRs(computed.maxProfit);
            s.maxLoss    = computed.maxLoss   === "Unlimited" ? "Unlimited" : formatRs(computed.maxLoss);
          }
          return s;
        });
      }

      setResult(data);
      setChatMsgs([{
        role: "ai",
        text: `Strategy ready for ${data.parsed.instrument} with ${data.parsed.capitalFormatted}${strikeCtx ? ` · Live ATM ${strikeCtx.atm}` : ""}. Ask me anything — "which strategy should I pick?", "what is theta?", "how do I place this?" etc.`,
      }]);
    } catch (e) {
      setError(e.message);
    }

    setLoading(false);
  }

  /* ── CHAT ── */
  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMsgs(prev => [...prev, { role: "user", text: msg }, { role: "ai", text: "..." }]);
    setChatLoading(true);
    try {
      const sys = `Expert Indian derivatives educator. Context: ${result?.parsed?.instrument}, ${result?.parsed?.capitalFormatted}. Plain English, beginner-friendly. Reference NSE, your stockbroker platform, lot sizes, Thursday expiry, SEBI. Under 80 words.`;
      const reply = await callGroq([{ role: "user", content: msg }], sys);
      setChatMsgs(prev => { const u = [...prev]; u[u.length - 1] = { role: "ai", text: reply }; return u; });
    } catch (e) {
      setChatMsgs(prev => { const u = [...prev]; u[u.length - 1] = { role: "ai", text: "Error: " + e.message }; return u; });
    }
    setChatLoading(false);
  }

  /* ── Shared styles ── */
  const p          = result?.parsed;
  const card       = { background: "#fff", border: "1px solid #e8e6f0", borderRadius: 12, marginBottom: 14, overflow: "hidden" };
  const thStyle    = { textAlign: "left", padding: "7px 10px", fontSize: 10, fontWeight: 700, color: "#7c7a92", textTransform: "uppercase", letterSpacing: "0.5px", background: "#f4f3f0", borderBottom: "1px solid #e8e6f0", whiteSpace: "nowrap" };
  const tdStyle    = { padding: isMobile ? "8px 8px" : "9px 10px", borderBottom: "1px solid #e8e6f0", verticalAlign: "top", fontSize: isMobile ? 11 : 12 };
  const metricCols = isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)";
  const riskCols   = isMobile ? "1fr" : "1fr 1fr";
  const footerPad  = isMobile ? "10px 12px" : "12px 16px";
  const rightPad   = isMobile ? "16px 14px" : isTablet ? "22px 26px" : "28px 36px";
  const chatMsgStyle = role => ({
    padding: "10px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.65,
    maxWidth: isMobile ? "90%" : "85%",
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    background: role === "user" ? "#0f0e17" : "#f4f3f0",
    color: role === "user" ? "#fff" : "#0f0e17",
    border: role === "ai" ? "1px solid #e8e6f0" : "none",
    wordBreak: "break-word",
  });

  const sharedInputPanelProps = {
    query, setQuery, generate, loading, result, bp,
    instrumentKey,
    onStrikeClick: handleStrikeClick,
  };

  /* ════════════════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        .deriv-root { display:flex; flex-direction:row; min-height:100vh; font-family:'Segoe UI','DM Sans',sans-serif; font-size:14px; color:#0f0e17; }
        .deriv-sidebar { width:300px; min-width:300px; max-width:300px; position:sticky; top:0; height:100vh; overflow-y:auto; flex-shrink:0; }
        .deriv-main { flex:1; min-width:0; overflow-y:auto; }
        .deriv-topbar { display:none; }
        .deriv-backdrop { display:none; }
        .deriv-drawer { display:none; }
        @media (max-width:1023px) and (min-width:640px) {
          .deriv-sidebar { width:260px; min-width:260px; max-width:260px; }
        }
        @media (max-width:639px) {
          .deriv-root { flex-direction:column; }
          .deriv-sidebar { display:none; }
          .deriv-topbar { display:flex; align-items:center; justify-content:space-between; background:#0f0e17; color:#fff; padding:13px 16px; position:sticky; top:0; z-index:50; flex-shrink:0; }
          .deriv-backdrop { display:block; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:98; opacity:0; pointer-events:none; transition:opacity 0.25s; }
          .deriv-backdrop.open { opacity:1; pointer-events:all; }
          .deriv-drawer { display:flex; flex-direction:column; position:fixed; bottom:0; left:0; right:0; z-index:99; max-height:92vh; border-radius:20px 20px 0 0; overflow:hidden; transform:translateY(100%); transition:transform 0.3s cubic-bezier(0.32,0.72,0,1); }
          .deriv-drawer.open { transform:translateY(0); }
          .deriv-main { flex:1; }
          .leg-purpose { display:none; }
        }
        .table-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        .result-block { animation:fadeSlideUp 0.35s ease both; }
      `}</style>

      <div className="deriv-root">

        {/* ── Desktop/Tablet Sidebar ── */}
        <aside className="deriv-sidebar">
          <InputPanel {...sharedInputPanelProps} />
        </aside>

        {/* ── Mobile Top Bar ── */}
        <div className="deriv-topbar">
          <div style={{ fontSize: 20, fontWeight: 800 }}>
            Deriv<span style={{ color: "#c9a84c", fontStyle: "italic" }}>AI</span>
          </div>
          <button onClick={() => setDrawerOpen(true)} style={{
            background: "#c9a84c", border: "none", borderRadius: 9,
            color: "#0f0e17", fontWeight: 800, fontSize: 13,
            padding: "8px 15px", cursor: "pointer", fontFamily: "inherit",
          }}>⚡ Trade</button>
        </div>

        {/* ── Mobile Backdrop ── */}
        <div className={`deriv-backdrop${drawerOpen ? " open" : ""}`} onClick={() => setDrawerOpen(false)} />

        {/* ── Mobile Drawer ── */}
        <div className={`deriv-drawer${drawerOpen ? " open" : ""}`}>
          <div style={{ background: "#0f0e17", paddingTop: 10, display: "flex", justifyContent: "center" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.25)", borderRadius: 2 }} />
          </div>
          <InputPanel {...sharedInputPanelProps} bp="mobile" onClose={() => setDrawerOpen(false)} />
        </div>

        {/* ── Main Content ── */}
        <main className="deriv-main" style={{ background: "#faf9f7", padding: rightPad }}>

          {/* Empty state */}
          {!loading && !result && !error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: isMobile ? "60vh" : "70vh", textAlign: "center", padding: "0 16px" }}>
              <div style={{ width: isMobile ? 58 : 68, height: isMobile ? 58 : 68, background: "#fdf6e3", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 26 : 30, marginBottom: 16 }}>📊</div>
              <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, marginBottom: 8 }}>Tell me what you want to trade</div>
              <div style={{ color: "#7c7a92", fontSize: 14, maxWidth: 340, lineHeight: 1.7 }}>
                {isMobile
                  ? <>Tap <strong>⚡ Trade</strong>, type instrument + capital — like <strong>"Bank Nifty 10000 rupees"</strong> — and I'll build 3 strategies with live ATM strikes.</>
                  : <>Type an instrument + capital on the left — like <strong>"Bank Nifty 10000 rupees"</strong> — and I'll fetch the live spot price and build 3 strategies sized to your budget.</>
                }
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: isMobile ? "60vh" : "70vh", gap: 14, textAlign: "center" }}>
              <div style={{ width: 42, height: 42, border: "3px solid #e8e6f0", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <div style={{ fontSize: 18, fontWeight: 700, color: "#7c7a92" }}>Building your strategy...</div>
              {spotStatus && <div style={{ fontSize: 12, color: "#c9a84c", background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 6, padding: "6px 14px" }}>{spotStatus}</div>}
              <div style={{ fontSize: 13, color: "#aaa" }}>Fetching live price · Sizing lots · Designing hedge layers</div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ background: "#fef2f1", border: "1px solid #fca5a5", borderRadius: 10, padding: "16px 20px", color: "#b5261e", marginBottom: 16 }}>
              <strong>Error:</strong> {error}
              <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>Try again or rephrase your input.</div>
            </div>
          )}

          {/* Result */}
          {result && !loading && (() => {
            const kl = result.keyLevels || {};
            return (
              <div className="result-block">

                {/* Metric cards */}
                <div style={{ display: "grid", gridTemplateColumns: metricCols, gap: isMobile ? 8 : 10, marginBottom: 16 }}>
                  {[
                    { label: "Instrument", val: p.instrument,       color: "#1a5fb4", sub: p.type },
                    { label: "Capital",    val: p.capitalFormatted,  color: "#c9a84c", sub: "available" },
                    { label: "Support",    val: kl.support || "—",   color: "#1a7a4a", sub: "floor level" },
                    { label: "Resistance", val: kl.resistance || "—",color: "#b5261e", sub: "ceiling level" },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#fff", border: "1px solid #e8e6f0", borderRadius: 10, padding: isMobile ? "11px 12px" : "13px 15px" }}>
                      <div style={{ fontSize: 10, color: "#7c7a92", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: m.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.val}</div>
                      <div style={{ fontSize: 11, color: "#7c7a92", marginTop: 3 }}>{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Market context */}
                <div style={{ background: "#fdf6e3", border: "1px solid rgba(201,168,76,0.28)", borderRadius: 10, padding: "13px 16px", marginBottom: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#c05c00", marginBottom: 4 }}>📈 Market Context</div>
                  <div style={{ fontSize: 13, color: "#2d2b3d", lineHeight: 1.7 }}>{result.marketContext}</div>
                </div>

                {/* Strategies */}
                <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 800, marginBottom: 4 }}>Recommended Strategies</div>
                <div style={{ fontSize: 13, color: "#7c7a92", marginBottom: 14 }}>3 approaches sized to your capital — pick one that matches your market view</div>

                {(result.strategies || []).map((s, i) => {
                  const tc = TYPE_CONFIG[s.type] || TYPE_CONFIG.neutral;
                  return (
                    <div key={i} style={card}>
                      {/* Card header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "12px 14px" : "14px 18px", borderBottom: "1px solid #e8e6f0", flexWrap: "wrap" }}>
                        <div style={{ width: 38, height: 38, borderRadius: 8, background: tc.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{tc.emoji}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: isMobile ? 14 : 15 }}>{s.name}</div>
                          <div style={{ fontSize: 11, color: "#7c7a92", marginTop: 1 }}>{tc.label}</div>
                        </div>
                        <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: tc.bg, color: tc.color, flexShrink: 0 }}>{tc.label}</span>
                      </div>

                      {/* Card body */}
                      <div style={{ padding: isMobile ? "13px 14px" : "15px 18px" }}>
                        <div style={{ fontSize: 13, color: "#2d2b3d", lineHeight: 1.7, marginBottom: 12 }}>{s.description}</div>

                        {/* Legs table */}
                        <div className="table-scroll">
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: isMobile ? 280 : "auto" }}>
                            <thead>
                              <tr>
                                <th style={thStyle}>Action</th>
                                <th style={thStyle}>Instrument</th>
                                <th style={thStyle}>Qty</th>
                                <th style={thStyle}>Premium</th>
                                <th style={thStyle} className="leg-purpose">Purpose</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(s.legs || []).map((leg, li) => (
                                <tr key={li}>
                                  <td style={{ ...tdStyle, fontWeight: 800, color: leg.action === "BUY" ? "#1a7a4a" : "#b5261e", whiteSpace: "nowrap" }}>{leg.action}</td>
                                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>{leg.instrument}</td>
                                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{leg.qty}</td>
                                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>{leg.approxPremium}</td>
                                  <td style={{ ...tdStyle, color: "#7c7a92" }} className="leg-purpose">{leg.purpose}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Beginner tip */}
                        <div style={{ background: "#fdf6e3", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 8, padding: "11px 14px", marginTop: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#c05c00", marginBottom: 4 }}>💡 Beginner Tip</div>
                          <div style={{ fontSize: 13, color: "#2d2b3d", lineHeight: 1.6 }}>{s.beginnerTip}</div>
                        </div>
                      </div>

                      {/* Card footer — BEP computed by JS, not AI */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderTop: "1px solid #e8e6f0" }}>
                        {[
                          ["Breakeven",   s.breakeven  || "—", "#7c7a92"],
                          ["Total Cost",  s.totalCost  || "—", "#1a5fb4"],
                          ["Max Profit",  s.maxProfit  || "—", "#1a7a4a"],
                          ["Max Loss",    s.maxLoss    || "—", "#b5261e"],
                        ].map(([lbl, val, col], fi) => (
                          <div key={lbl} style={{ padding: footerPad, borderRight: fi < 3 ? "1px solid #e8e6f0" : "none" }}>
                            <div style={{ fontSize: 10, color: "#7c7a92", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{lbl}</div>
                            <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 800, color: col, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Risk warnings */}
                <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 800, marginBottom: 4, marginTop: 8 }}>⚠️ Risk Warnings</div>
                <div style={{ fontSize: 13, color: "#7c7a92", marginBottom: 14 }}>Understand these before placing any trade</div>
                <div style={{ display: "grid", gridTemplateColumns: riskCols, gap: 10, marginBottom: 22 }}>
                  {(result.riskWarnings || []).map((r, ri) => (
                    <div key={ri} style={{ background: "#fff", border: "1px solid #e8e6f0", borderRadius: 10, padding: isMobile ? 13 : 15 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: "#c05c00", marginBottom: 6 }}>⚡ {r.title}</div>
                      <div style={{ fontSize: 12, color: "#7c7a92", lineHeight: 1.6 }}>{r.detail}</div>
                    </div>
                  ))}
                </div>

                {/* Chat */}
                <div style={{ background: "#fff", border: "1px solid #e8e6f0", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #e8e6f0", fontWeight: 700, fontSize: 13 }}>
                    💬 Ask anything about this strategy
                  </div>
                  <div ref={chatRef} style={{ padding: 12, display: "flex", flexDirection: "column", gap: 9, maxHeight: isMobile ? 220 : 260, overflowY: "auto" }}>
                    {chatMsgs.map((m, mi) => (
                      <div key={mi} style={chatMsgStyle(m.role)}>
                        {m.text === "..." ? <span style={{ color: "#aaa" }}>Thinking...</span> : m.text}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, padding: isMobile ? "10px 12px" : "11px 14px", borderTop: "1px solid #e8e6f0" }}>
                    <textarea
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                      placeholder="Ask anything — e.g. which strategy should I pick?"
                      rows={isMobile ? 1 : 2}
                      style={{ flex: 1, minWidth: 0, padding: "8px 12px", border: "1.5px solid #e8e6f0", borderRadius: 8, fontFamily: "inherit", fontSize: 13, outline: "none", resize: "none", color: "#0f0e17" }}
                    />
                    <button
                      onClick={sendChat}
                      disabled={chatLoading || !chatInput.trim()}
                      style={{
                        padding: isMobile ? "8px 12px" : "8px 16px",
                        background: "#0f0e17", color: "#fff", border: "none", borderRadius: 8,
                        fontWeight: 700, fontSize: 13, fontFamily: "inherit", flexShrink: 0,
                        cursor: (chatLoading || !chatInput.trim()) ? "not-allowed" : "pointer",
                        opacity: (chatLoading || !chatInput.trim()) ? 0.45 : 1, whiteSpace: "nowrap",
                      }}
                    >{isMobile ? "↑" : "Send ↑"}</button>
                  </div>
                </div>

              </div>
            );
          })()}
        </main>
      </div>
    </>
  );
}
