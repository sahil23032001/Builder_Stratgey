DerivAI — Indian Derivatives Strategy Builder
An AI-powered options strategy builder for Indian markets (NSE). Type any instrument + capital (e.g. "Bank Nifty 10000 rupees") and get 3 complete hedged strategies instantly.

Setup
1. Create your React app
bashnpx create-react-app deriv-ai
cd deriv-ai
Or with Vite (faster):
bashnpm create vite@latest deriv-ai -- --template react
cd deriv-ai
npm install
2. Add the component
Replace src/App.js content with:
jsimport DerivAI from './deriv_ai';
export default function App() { return <DerivAI />; }
Copy deriv_ai.jsx into the src/ folder.
3. Set up your API key
Copy the example env file:
bashcp .env.example .env
Open .env and replace the placeholder with your real Anthropic API key:
REACT_APP_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxx
Get your API key at: https://console.anthropic.com
4. Run locally
bashnpm start
App runs at http://localhost:3000

Deploy to Vercel (Free)
bashnpm install -g vercel
vercel
When prompted, add your environment variable:

Key: REACT_APP_ANTHROPIC_API_KEY
Value: sk-ant-api03-xxxxxxxxxxxxxxxx

Or set it in the Vercel dashboard → Project → Settings → Environment Variables.

Deploy to Netlify (Free)
bashnpm run build
Drag the build/ folder to https://app.netlify.com/drop
Then go to: Site Settings → Environment Variables → Add:

Key: REACT_APP_ANTHROPIC_API_KEY
Value: your key


⚠️ Important Security Note

Never commit .env to GitHub — the .gitignore already blocks this
The API key is exposed in the browser bundle — this is acceptable for personal/demo use
For a production app with real users, move the API call to a backend (Next.js API route, Express, etc.) so the key stays server-side


Disclaimer
Educational purposes only. Not SEBI-registered investment advice. Options trading involves substantial risk of loss. Always consult a licensed financial advisor before trading.
