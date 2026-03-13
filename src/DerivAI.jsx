import { useState, useRef, useEffect } from "react";

const API_KEY = process.env.REACT_APP_GROQ_API_KEY;
const API = "https://api.groq.com/openai/v1/chat/completions";

const EXAMPLES = [
  "Bank Nifty 10000 rupees",
  "Nifty 50 with 25000 rupees",
  "Reliance options 15000 rupees",
  "Nifty weekly options 5000 rupees",
  "Infosys options 20000 rupees",
  "Midcap Nifty 50000 rupees",
];

const TYPE_CONFIG = {
  hedge:   { label: "Hedge / Protection",  bg: "#eef4fd", color: "#1a5fb4", emoji: "🛡" },
  profit:  { label: "Directional Profit",  bg: "#edf9f2", color: "#1a7a4a", emoji: "🚀" },
  neutral: { label: "Neutral / Income",    bg: "#fff3e0", color: "#c05c00", emoji: "⚖️" },
};

async function callGemini(messages, system) {
  const groqMessages = [];
  if (system) groqMessages.push({ role: "system", content: system });
  groqMessages.push(...messages);

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + API_KEY
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 4000,
      messages: groqMessages
    }),
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

export default function DerivAI() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMsgs]);

  // Close sidebar when result loads on mobile
  useEffect(() => {
    if (result) setSidebarOpen(false);
  }, [result]);

  async function generate() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    setChatMsgs([]);

    const systemPrompt = `You are an expert Indian NSE derivatives trader and educator. 
Return ONLY a raw JSON object. No markdown. No code fences. No explanation before or after.
Keep every string value under 100 characters.`;

    const userPrompt = `User wants to trade: "${query}"

Return this exact JSON structure filled with realistic data for Indian markets:

{
  "parsed": {
    "instrument": "BANKNIFTY",
    "capitalFormatted": "Rs.10,000",
    "exchange": "NSE",
    "type": "Index Options"
  },
  "marketContext": "One sentence about current market conditions for this instrument.",
  "keyLevels": {
    "support": "47800",
    "resistance": "49200"
  },
  "strategies": [
    {
      "name": "Bull Call Spread",
      "type": "hedge",
      "icon": "shield",
      "description": "Two sentences explaining this strategy simply for a beginner.",
      "legs": [
        {
          "action": "BUY",
          "instrument": "BANKNIFTY 48500 CE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.3000 total",
          "purpose": "Main profit leg if index rises above 48500"
        },
        {
          "action": "SELL",
          "instrument": "BANKNIFTY 49000 CE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.1500 credit",
          "purpose": "Reduces total cost of the trade"
        }
      ],
      "totalCost": "Rs.1500",
      "maxProfit": "Rs.6000",
      "maxLoss": "Rs.1500",
      "breakeven": "48600",
      "beginnerTip": "One practical sentence for placing this trade with your stockbroker."
    },
    {
      "name": "Long Put",
      "type": "profit",
      "icon": "rocket",
      "description": "Two sentences explaining this strategy.",
      "legs": [
        {
          "action": "BUY",
          "instrument": "BANKNIFTY 48000 PE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.2700 total",
          "purpose": "Profits if index falls below 48000"
        }
      ],
      "totalCost": "Rs.2700",
      "maxProfit": "Rs.10000+",
      "maxLoss": "Rs.2700",
      "breakeven": "47820",
      "beginnerTip": "One practical tip for a beginner."
    },
    {
      "name": "Short Strangle",
      "type": "neutral",
      "icon": "balance",
      "description": "Two sentences explaining this strategy.",
      "legs": [
        {
          "action": "SELL",
          "instrument": "BANKNIFTY 49500 CE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.1200 credit",
          "purpose": "Earns premium if index stays below 49500"
        },
        {
          "action": "SELL",
          "instrument": "BANKNIFTY 47000 PE 27-Mar",
          "qty": "1 lot (15 units)",
          "approxPremium": "Rs.900 credit",
          "purpose": "Earns premium if index stays above 47000"
        }
      ],
      "totalCost": "Net credit Rs.2100",
      "maxProfit": "Rs.2100",
      "maxLoss": "Unlimited",
      "breakeven": "47000 to 49500",
      "beginnerTip": "One practical caution for a beginner selling options."
    }
  ],
  "riskWarnings": [
    { "title": "Time Decay", "detail": "Options lose value every day. Buyers lose, sellers benefit from this." },
    { "title": "Weekly Expiry", "detail": "NSE options expire every Thursday. Wrong view means 100% premium loss." },
    { "title": "Bid-Ask Spread", "detail": "Check the spread before entering. Wider spread = higher hidden cost." },
    { "title": "Capital Sizing", "detail": "Never risk more than 20-30% of your total capital in one trade." }
  ]
}

Important: BANKNIFTY lot size = 15, NIFTY lot size = 50. Adjust premiums and costs realistically to fit the user's capital. Use Rs. prefix for money (not the rupee symbol).`;

    try {
      const text = await callGemini(
        [{ role: "user", content: userPrompt }],
        systemPrompt
      );
      const data = extractJSON(text);
      setResult(data);
      setChatMsgs([{
        role: "ai",
        text: `Strategy ready for ${data.parsed.instrument} with ${data.parsed.capitalFormatted}. Ask me anything — "which strategy should I pick?", "what is theta?", "how do I place this with my stockbroker?" etc.`
      }]);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMsgs(prev => [...prev, { role: "user", text: msg }, { role: "ai", text: "..." }]);
    setChatLoading(true);
    try {
      const sys = `Expert Indian derivatives educator. Context: ${result?.parsed?.instrument}, ${result?.parsed?.capitalFormatted}. Plain English, beginner-friendly. Reference NSE, your stockbroker platform, lot sizes, Thursday expiry, SEBI. Under 80 words.`;
      const reply = await callGemini([{ role: "user", content: msg }], sys);
      setChatMsgs(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "ai", text: reply };
        return updated;
      });
    } catch (e) {
      setChatMsgs(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "ai", text: "Error: " + e.message };
        return updated;
      });
    }
    setChatLoading(false);
  }

  const p = result?.parsed;

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const S = {
    // Shell: stacked on mobile, side-by-side on desktop
    shell: {
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      fontFamily: "'Segoe UI', 'DM Sans', sans-serif",
      fontSize: 14,
      color: "#0f0e17",
    },
    // Mobile top bar
    topBar: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "#0f0e17",
      color: "#fff",
      padding: "14px 18px",
    },
    // Sidebar: full-screen overlay on mobile, fixed column on desktop
    left: {
      background: "#0f0e17",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
      padding: "24px 20px",
    },
    right: {
      background: "#faf9f7",
      padding: "20px 16px",
      flex: 1,
    },
    card: {
      background: "#fff",
      border: "1px solid #e8e6f0",
      borderRadius: 12,
      marginBottom: 14,
      overflow: "hidden",
    },
    label: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "1.2px",
      textTransform: "uppercase",
      color: "rgba(255,255,255,0.38)",
      marginBottom: 8,
    },
    textarea: {
      width: "100%",
      background: "rgba(255,255,255,0.07)",
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: 10,
      color: "#fff",
      fontSize: 18,
      fontWeight: 700,
      padding: "12px 14px",
      outline: "none",
      resize: "none",
      lineHeight: 1.4,
      fontFamily: "inherit",
      boxSizing: "border-box",
    },
    goldBtn: {
      width: "100%",
      padding: 13,
      background: "#c9a84c",
      color: "#0f0e17",
      border: "none",
      borderRadius: 10,
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
      fontFamily: "inherit",
    },
    // Metrics: 2 cols on mobile, 4 on desktop
    metricGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 8,
      marginBottom: 16,
    },
    metricBox: {
      background: "#fff",
      border: "1px solid #e8e6f0",
      borderRadius: 10,
      padding: "11px 13px",
    },
    metricLabel: {
      fontSize: 10,
      color: "#7c7a92",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      marginBottom: 4,
    },
    sectionHead: { fontSize: 17, fontWeight: 800, marginBottom: 4, marginTop: 4 },
    sectionSub: { fontSize: 13, color: "#7c7a92", marginBottom: 14 },
    th: {
      textAlign: "left",
      padding: "7px 8px",
      fontSize: 10,
      fontWeight: 700,
      color: "#7c7a92",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      background: "#f4f3f0",
      borderBottom: "1px solid #e8e6f0",
    },
    td: { padding: "8px", borderBottom: "1px solid #e8e6f0", verticalAlign: "top" },
    tipBox: {
      background: "#fdf6e3",
      border: "1px solid rgba(201,168,76,0.25)",
      borderRadius: 8,
      padding: "11px 14px",
      marginTop: 12,
    },
    chatMsg: (role) => ({
      padding: "10px 13px",
      borderRadius: 8,
      fontSize: 13,
      lineHeight: 1.65,
      maxWidth: "88%",
      alignSelf: role === "user" ? "flex-end" : "flex-start",
      background: role === "user" ? "#0f0e17" : "#f4f3f0",
      color: role === "user" ? "#fff" : "#0f0e17",
      border: role === "ai" ? "1px solid #e8e6f0" : "none",
      wordBreak: "break-word",
    }),
  };

  // Sidebar content (shared between mobile overlay and desktop panel)
  const SidebarContent = () => (
    <>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>
          Deriv<span style={{ color: "#c9a84c", fontStyle: "italic" }}>AI</span>
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 3 }}>
          Indian Derivatives Strategy Builder
        </div>
      </div>

      <div style={S.label}>What do you want to trade?</div>
      <textarea
        style={S.textarea}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } }}
        placeholder="e.g. Bank Nifty 10000 rupees"
        rows={3}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 16px" }}>
        {EXAMPLES.map(ex => (
          <button
            key={ex}
            onClick={() => setQuery(ex)}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20,
              padding: "5px 10px",
              fontSize: 11,
              color: "rgba(255,255,255,0.55)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {ex.replace(" rupees", "").replace("with ", "")}
          </button>
        ))}
      </div>

      <button
        onClick={generate}
        disabled={loading || !query.trim()}
        style={{
          ...S.goldBtn,
          opacity: (loading || !query.trim()) ? 0.45 : 1,
          cursor: (loading || !query.trim()) ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "⏳ Analyzing..." : "⚡ Generate Strategy"}
      </button>

      {p && (
        <div style={{
          marginTop: 16,
          background: "rgba(201,168,76,0.1)",
          border: "1px solid rgba(201,168,76,0.28)",
          borderRadius: 10,
          padding: "12px 14px",
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
    </>
  );

  return (
    <>
      {/* Responsive styles injected once */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        .deriv-shell {
          display: flex;
          flex-direction: row;
          min-height: 100vh;
          font-family: 'Segoe UI', 'DM Sans', sans-serif;
          font-size: 14px;
          color: #0f0e17;
        }
        .deriv-left {
          width: 300px;
          min-width: 300px;
          background: #0f0e17;
          color: #fff;
          display: flex;
          flex-direction: column;
          padding: 28px 22px;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
          box-sizing: border-box;
        }
        .deriv-right {
          background: #faf9f7;
          padding: 28px 32px;
          overflow-y: auto;
          flex: 1;
          min-width: 0;
        }
        .deriv-topbar { display: none; }
        .deriv-mobile-overlay { display: none; }
        .metric-grid { grid-template-columns: repeat(4, 1fr) !important; }
        .risk-grid { grid-template-columns: 1fr 1fr !important; }
        .strategy-footer { grid-template-columns: 1fr 1fr 1fr !important; }

        @media (max-width: 767px) {
          .deriv-shell {
            flex-direction: column;
          }
          .deriv-left {
            display: none;
          }
          .deriv-right {
            padding: 16px;
          }
          .deriv-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #0f0e17;
            color: #fff;
            padding: 14px 16px;
            position: sticky;
            top: 0;
            z-index: 100;
          }
          .deriv-mobile-overlay {
            position: fixed;
            inset: 0;
            z-index: 200;
            background: #0f0e17;
            color: #fff;
            display: flex;
            flex-direction: column;
            padding: 20px 18px;
            overflow-y: auto;
          }
          .deriv-mobile-overlay.hidden { display: none; }
          .metric-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .risk-grid { grid-template-columns: 1fr !important; }
          .strategy-footer { grid-template-columns: 1fr 1fr !important; }
          .leg-table th:nth-child(5),
          .leg-table td:nth-child(5) { display: none; }
        }
      `}</style>

      <div className="deriv-shell">

        {/* DESKTOP SIDEBAR */}
        <aside className="deriv-left">
          <SidebarContent />
        </aside>

        {/* MOBILE TOP BAR */}
        <div className="deriv-topbar">
          <div style={{ fontSize: 20, fontWeight: 800 }}>
            Deriv<span style={{ color: "#c9a84c", fontStyle: "italic" }}>AI</span>
          </div>
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              background: "#c9a84c",
              border: "none",
              borderRadius: 8,
              color: "#0f0e17",
              fontWeight: 800,
              fontSize: 13,
              padding: "8px 14px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ⚡ Trade
          </button>
        </div>

        {/* MOBILE OVERLAY SIDEBAR */}
        <div className={`deriv-mobile-overlay${sidebarOpen ? "" : " hidden"}`}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button
              onClick={() => setSidebarOpen(false)}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: 8,
                color: "#fff",
                fontSize: 14,
                padding: "6px 12px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ✕ Close
            </button>
          </div>
          <SidebarContent />
        </div>

        {/* MAIN CONTENT */}
        <main className="deriv-right">

          {/* EMPTY STATE */}
          {!loading && !result && !error && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "60vh",
              textAlign: "center",
              padding: "0 16px",
            }}>
              <div style={{
                width: 64,
                height: 64,
                background: "#fdf6e3",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                marginBottom: 16,
              }}>📊</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Tell me what you want to trade</div>
              <div style={{ color: "#7c7a92", fontSize: 14, maxWidth: 320, lineHeight: 1.7 }}>
                Tap <strong>⚡ Trade</strong> above — type an instrument and capital like{" "}
                <strong>"Bank Nifty 10000 rupees"</strong> — and I'll build 3 complete strategies sized to your budget.
              </div>
            </div>
          )}

          {/* LOADING */}
          {loading && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "60vh",
              gap: 14,
              textAlign: "center",
            }}>
              <div style={{
                width: 40,
                height: 40,
                border: "3px solid #e8e6f0",
                borderTopColor: "#c9a84c",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }} />
              <div style={{ fontSize: 17, fontWeight: 700, color: "#7c7a92" }}>Building your strategy...</div>
              <div style={{ fontSize: 13, color: "#aaa" }}>Parsing instrument · Sizing lots · Designing hedge layers</div>
            </div>
          )}

          {/* ERROR */}
          {error && (
            <div style={{
              background: "#fef2f1",
              border: "1px solid #fca5a5",
              borderRadius: 10,
              padding: "16px 18px",
              color: "#b5261e",
              marginBottom: 16,
            }}>
              <strong>Error:</strong> {error}
              <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>Try again or rephrase your input.</div>
            </div>
          )}

          {/* RESULT */}
          {result && !loading && (() => {
            const kl = result.keyLevels || {};
            return (
              <>
                {/* METRICS */}
                <div className="metric-grid" style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                  {[
                    { label: "Instrument", val: p.instrument, color: "#1a5fb4", sub: p.type },
                    { label: "Capital", val: p.capitalFormatted, color: "#c9a84c", sub: "available" },
                    { label: "Support", val: kl.support || "—", color: "#1a7a4a", sub: "floor level" },
                    { label: "Resistance", val: kl.resistance || "—", color: "#b5261e", sub: "ceiling level" },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#fff", border: "1px solid #e8e6f0", borderRadius: 10, padding: "11px 13px" }}>
                      <div style={{ fontSize: 10, color: "#7c7a92", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: m.color }}>{m.val}</div>
                      <div style={{ fontSize: 11, color: "#7c7a92", marginTop: 3 }}>{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* MARKET CONTEXT */}
                <div style={{
                  background: "#fdf6e3",
                  border: "1px solid rgba(201,168,76,0.28)",
                  borderRadius: 10,
                  padding: "13px 16px",
                  marginBottom: 18,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#c05c00", marginBottom: 4 }}>📈 Market Context</div>
                  <div style={{ fontSize: 13, color: "#2d2b3d", lineHeight: 1.7 }}>{result.marketContext}</div>
                </div>

                {/* STRATEGIES */}
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Recommended Strategies</div>
                <div style={{ fontSize: 13, color: "#7c7a92", marginBottom: 14 }}>3 approaches sized to your capital — pick one that matches your market view</div>

                {(result.strategies || []).map((s, i) => {
                  const tc = TYPE_CONFIG[s.type] || TYPE_CONFIG.neutral;
                  return (
                    <div key={i} style={{ background: "#fff", border: "1px solid #e8e6f0", borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid #e8e6f0" }}>
                        <div style={{
                          width: 38,
                          height: 38,
                          borderRadius: 8,
                          background: tc.bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 18,
                          flexShrink: 0,
                        }}>{tc.emoji}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 14 }}>{s.name}</div>
                          <div style={{ fontSize: 11, color: "#7c7a92", marginTop: 1 }}>{tc.label}</div>
                        </div>
                        <span style={{
                          padding: "3px 9px",
                          borderRadius: 20,
                          fontSize: 10,
                          fontWeight: 700,
                          background: tc.bg,
                          color: tc.color,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}>{tc.label}</span>
                      </div>

                      {/* Body */}
                      <div style={{ padding: "14px 16px" }}>
                        <div style={{ fontSize: 13, color: "#2d2b3d", lineHeight: 1.7, marginBottom: 12 }}>{s.description}</div>

                        {/* Legs table — scrollable on mobile, "Purpose" col hidden via CSS */}
                        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                          <table className="leg-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 360 }}>
                            <thead>
                              <tr>
                                {["Action", "Instrument", "Qty", "Premium", "Purpose"].map(h => (
                                  <th key={h} style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#7c7a92", textTransform: "uppercase", letterSpacing: "0.5px", background: "#f4f3f0", borderBottom: "1px solid #e8e6f0" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(s.legs || []).map((leg, li) => (
                                <tr key={li}>
                                  <td style={{ padding: "8px", borderBottom: "1px solid #e8e6f0", fontWeight: 800, color: leg.action === "BUY" ? "#1a7a4a" : "#b5261e", whiteSpace: "nowrap" }}>{leg.action}</td>
                                  <td style={{ padding: "8px", borderBottom: "1px solid #e8e6f0", fontWeight: 600, fontSize: 11 }}>{leg.instrument}</td>
                                  <td style={{ padding: "8px", borderBottom: "1px solid #e8e6f0", whiteSpace: "nowrap" }}>{leg.qty}</td>
                                  <td style={{ padding: "8px", borderBottom: "1px solid #e8e6f0", fontWeight: 600, whiteSpace: "nowrap" }}>{leg.approxPremium}</td>
                                  <td style={{ padding: "8px", borderBottom: "1px solid #e8e6f0", color: "#7c7a92", fontSize: 11 }}>{leg.purpose}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Tip */}
                        <div style={{ background: "#fdf6e3", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 8, padding: "11px 14px", marginTop: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#c05c00", marginBottom: 4 }}>💡 Beginner Tip</div>
                          <div style={{ fontSize: 13, color: "#2d2b3d", lineHeight: 1.6 }}>{s.beginnerTip}</div>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="strategy-footer" style={{ display: "grid", borderTop: "1px solid #e8e6f0" }}>
                        {[["Total Cost", s.totalCost, "#1a5fb4"], ["Max Profit", s.maxProfit, "#1a7a4a"], ["Max Loss", s.maxLoss, "#b5261e"]].map(([lbl, val, col], fi) => (
                          <div key={lbl} style={{ padding: "12px 14px", borderRight: fi < 2 ? "1px solid #e8e6f0" : "none" }}>
                            <div style={{ fontSize: 10, color: "#7c7a92", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{lbl}</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: col }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* RISK WARNINGS */}
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4, marginTop: 8 }}>⚠️ Risk Warnings</div>
                <div style={{ fontSize: 13, color: "#7c7a92", marginBottom: 14 }}>Understand these before placing any trade</div>
                <div className="risk-grid" style={{ display: "grid", gap: 10, marginBottom: 22 }}>
                  {(result.riskWarnings || []).map((r, i) => (
                    <div key={i} style={{ background: "#fff", border: "1px solid #e8e6f0", borderRadius: 10, padding: 14 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: "#c05c00", marginBottom: 6 }}>⚡ {r.title}</div>
                      <div style={{ fontSize: 12, color: "#7c7a92", lineHeight: 1.6 }}>{r.detail}</div>
                    </div>
                  ))}
                </div>

                {/* CHAT */}
                <div style={{ background: "#fff", border: "1px solid #e8e6f0", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #e8e6f0", fontWeight: 700, fontSize: 13 }}>
                    💬 Ask anything about this strategy
                  </div>
                  <div ref={chatRef} style={{ padding: 12, display: "flex", flexDirection: "column", gap: 9, maxHeight: 260, overflowY: "auto" }}>
                    {chatMsgs.map((m, i) => (
                      <div key={i} style={S.chatMsg(m.role)}>
                        {m.text === "..." ? <span style={{ color: "#aaa" }}>Thinking...</span> : m.text}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid #e8e6f0" }}>
                    <textarea
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                      placeholder="Ask anything — e.g. which strategy should I pick?"
                      rows={2}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        border: "1.5px solid #e8e6f0",
                        borderRadius: 8,
                        fontFamily: "inherit",
                        fontSize: 13,
                        outline: "none",
                        resize: "none",
                        color: "#0f0e17",
                        minWidth: 0,
                      }}
                    />
                    <button
                      onClick={sendChat}
                      disabled={chatLoading || !chatInput.trim()}
                      style={{
                        padding: "8px 14px",
                        background: "#0f0e17",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: (chatLoading || !chatInput.trim()) ? "not-allowed" : "pointer",
                        opacity: (chatLoading || !chatInput.trim()) ? 0.45 : 1,
                        fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                    >
                      Send ↑
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </main>
      </div>
    </>
  );
}
