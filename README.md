# nichegolfHQ — AI Golf Assistant

An AI-powered chat widget for **nichegolfhq.com** that answers questions about competitive amateur golf. It crawls your website (and optional external golf sources) to build a knowledge base, then uses Claude AI to give informed, friendly answers.

---

## What's Inside

```
golf-agent/
├── src/
│   ├── server.js      # Express API server (chat endpoint + scheduled crawl)
│   ├── agent.js       # AI brain — Claude integration + knowledge retrieval
│   └── crawler.js     # Web crawler that builds the knowledge base
├── public/
│   ├── widget.js      # Embeddable chat widget (drop on any page)
│   └── demo.html      # Demo page to test the widget
├── data/              # Auto-generated — stores crawled knowledge base
├── .env.example       # Environment variable template
├── package.json
└── README.md
```

---

## Quick Start

### 1. Install dependencies

```bash
cd golf-agent
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and add your **Anthropic API key** (get one at https://console.anthropic.com):

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
SITE_URL=https://www.nichegolfhq.com
ALLOWED_ORIGINS=https://www.nichegolfhq.com,http://localhost:3000
```

### 3. Run the server

```bash
npm start
```

The server will:
- Start on port **3001** (configurable via `PORT`)
- Automatically crawl your site on first launch
- Re-crawl on a schedule (default: every 24 hours)

### 4. Test it

Open **http://localhost:3001/demo.html** to see the widget in action.

---

## Embedding on Your Website

Add this single script tag to any page on nichegolfhq.com:

```html
<script src="https://YOUR-SERVER-URL/widget.js" defer></script>
```

If your API server is on a different domain than your site, set the `data-api` attribute:

```html
<script
  src="https://your-cdn.com/widget.js"
  data-api="https://your-api-server.com"
  defer
></script>
```

That's it — the green chat bubble appears in the bottom-right corner.

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/chat` | POST | Send a message, get AI response |
| `/api/status` | GET | Health check + knowledge base stats |
| `/api/crawl` | POST | Trigger manual re-crawl |

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Your Anthropic API key |
| `PORT` | `3001` | Server port |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `SITE_URL` | `https://www.nichegolfhq.com` | Primary site to crawl |
| `CRAWL_INTERVAL_HOURS` | `24` | How often to re-crawl |
| `MAX_PAGES` | `200` | Max pages to crawl per run |
| `EXTRA_SOURCES` | — | Additional golf sites to crawl (comma-separated) |

---

## Cost Estimate

Using Claude Sonnet at ~$3/M input tokens and ~$15/M output tokens:
- Average question: ~1,500 input tokens (question + context), ~400 output tokens
- **Cost per question: ~$0.01**
- 1,000 questions/month ≈ **~$10/month** in API costs

---

Built with Claude AI for nichegolfHQ
