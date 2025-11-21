# Quiz Endpoint (Playwright + Docker + Render)

## Quick local test
1. Copy `.env.example` to `.env` and set QUIZ_SECRET and other env variables for local testing.
2. Install: `npm ci`
3. Start: `node server.js`
4. Test:
   curl -X POST http://localhost:3000/quiz-endpoint -H "Content-Type: application/json" -d '{"email":"you@example.com","secret":"<your-secret>","url":"https://tds-llm-analysis.s-anand.net/demo"}'

## Deploy to Render (Docker)
1. Push this repo to GitHub.
2. In Render: New -> Web Service -> select repo -> choose **Docker** runtime.
3. Dockerfile path: `Dockerfile`
4. Set Environment Variables in Render:
   - QUIZ_SECRET = <your secret string>
   - NODE_ENV = production
   - (optional) MAX_FLOW_MS = 180000
5. Create service and deploy. Use Render logs to watch Playwright activity.
