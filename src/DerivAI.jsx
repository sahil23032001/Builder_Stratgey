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
  hedge: { label: "Hedge / Protection", bg: "#eef4fd", color: "#1a5fb4", emoji: "🛡" },
  profit: { label: "Directional Profit", bg: "#edf9f2", color: "#1a7a4a", emoji: "🚀" },
  neutral: { label: "Neutral / Income", bg: "#fff3e0", color: "#c05c00", emoji: "⚖️" },
};

async function callGemini(messages, system) {
  const groqMessages = [];
  if (system) groqMessages.push({ role: "system", content: system });
  groqMessages.push(...messages);

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + API_KEY,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 4000,
      messages: groqMessages,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found");
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

  const chatRef = useRef(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (chatRef.current)
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMsgs]);

  async function generate() {

    if (!query.trim() || loading) return;

    setLoading(true);

    // CLEAR OLD DATA
    setError("");
    setResult(null);
    setChatMsgs([]);
    setChatInput("");

    if (chatRef.current) chatRef.current.scrollTop = 0;

    const systemPrompt =
      "You are an expert Indian NSE derivatives trader. Return only JSON.";

    const userPrompt = `User wants to trade: "${query}"`;

    try {
      const text = await callGemini(
        [{ role: "user", content: userPrompt }],
        systemPrompt
      );

      const data = extractJSON(text);

      setResult(data);

      setChatMsgs([
        {
          role: "ai",
          text: `Strategy ready for ${data?.parsed?.instrument || ""}. Ask anything.`,
        },
      ]);

      setQuery("");

      window.scrollTo({ top: 0, behavior: "smooth" });

    } catch (e) {
      setError(e.message);
    }

    setLoading(false);
  }

  async function sendChat() {

    if (!chatInput.trim() || chatLoading) return;

    const msg = chatInput.trim();

    setChatInput("");

    setChatMsgs((prev) => [
      ...prev,
      { role: "user", text: msg },
      { role: "ai", text: "..." },
    ]);

    setChatLoading(true);

    try {
      const reply = await callGemini(
        [{ role: "user", content: msg }],
        "Explain options trading simply for beginners."
      );

      setChatMsgs((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "ai", text: reply };
        return updated;
      });

    } catch (e) {

      setChatMsgs((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "ai",
          text: "Error: " + e.message,
        };
        return updated;
      });

    }

    setChatLoading(false);
  }

  const S = {
    shell: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "320px 1fr",
      minHeight: "100vh",
      fontFamily: "Segoe UI",
    },

    left: {
      background: "#0f0e17",
      color: "#fff",
      padding: 24,
      height: isMobile ? "auto" : "100vh",
    },

    right: {
      background: "#faf9f7",
      padding: 30,
    },

    textarea: {
      width: "100%",
      padding: 12,
      fontSize: 18,
      borderRadius: 8,
    },

    button: {
      width: "100%",
      padding: 12,
      marginTop: 12,
      fontWeight: "bold",
      background: "#c9a84c",
      border: "none",
      borderRadius: 8,
      cursor: "pointer",
    },

    card: {
      background: "#fff",
      padding: 20,
      borderRadius: 10,
      border: "1px solid #eee",
      marginBottom: 20,
    },

    metricGrid: {
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)",
      gap: 10,
      marginBottom: 20,
    },

    chatBox: {
      border: "1px solid #ddd",
      borderRadius: 10,
      overflow: "hidden",
    },
  };

  return (
    <div style={S.shell}>

      {/* LEFT PANEL */}

      <div style={S.left}>

        <h2>DerivAI</h2>

        <textarea
          style={S.textarea}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Bank Nifty 10000 rupees"
        />

        <button
          style={S.button}
          onClick={generate}
          disabled={loading || !query.trim()}
        >
          {loading ? "Analyzing..." : "Generate Strategy"}
        </button>

        <div style={{ marginTop: 20 }}>

          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              style={{
                margin: 4,
                padding: 6,
                fontSize: 12,
                borderRadius: 20,
                border: "1px solid #666",
                background: "transparent",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {ex}
            </button>
          ))}

        </div>

      </div>

      {/* RIGHT PANEL */}

      <div style={S.right}>

        {!result && !loading && (
          <h3>Enter an instrument and capital to generate a strategy</h3>
        )}

        {loading && <h3>Building strategy...</h3>}

        {error && <div>Error: {error}</div>}

        {result && (
          <>

            <div style={S.metricGrid}>
              <div style={S.card}>
                <b>Instrument</b>
                <div>{result?.parsed?.instrument}</div>
              </div>

              <div style={S.card}>
                <b>Capital</b>
                <div>{result?.parsed?.capitalFormatted}</div>
              </div>

              <div style={S.card}>
                <b>Support</b>
                <div>{result?.keyLevels?.support}</div>
              </div>

              <div style={S.card}>
                <b>Resistance</b>
                <div>{result?.keyLevels?.resistance}</div>
              </div>
            </div>

            {(result.strategies || []).map((s, i) => {

              const tc = TYPE_CONFIG[s.type] || TYPE_CONFIG.neutral;

              return (
                <div key={i} style={S.card}>

                  <h3>
                    {tc.emoji} {s.name}
                  </h3>

                  <p>{s.description}</p>

                  <table width="100%">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Instrument</th>
                        <th>Qty</th>
                        <th>Premium</th>
                      </tr>
                    </thead>

                    <tbody>
                      {(s.legs || []).map((leg, li) => (
                        <tr key={li}>
                          <td>{leg.action}</td>
                          <td>{leg.instrument}</td>
                          <td>{leg.qty}</td>
                          <td>{leg.approxPremium}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p>
                    <b>Total Cost:</b> {s.totalCost}
                  </p>

                  <p>
                    <b>Max Profit:</b> {s.maxProfit}
                  </p>

                  <p>
                    <b>Max Loss:</b> {s.maxLoss}
                  </p>

                </div>
              );
            })}

            {/* CHAT */}

            <div style={S.chatBox}>

              <div
                ref={chatRef}
                style={{
                  maxHeight: 250,
                  overflowY: "auto",
                  padding: 10,
                }}
              >

                {chatMsgs.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      textAlign: m.role === "user" ? "right" : "left",
                      marginBottom: 8,
                    }}
                  >
                    {m.text}
                  </div>
                ))}

              </div>

              <div style={{ display: "flex", padding: 10 }}>

                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  style={{ flex: 1 }}
                />

                <button
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  Send
                </button>

              </div>

            </div>

          </>
        )}

      </div>

    </div>
  );
}
