// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { chromium } from "playwright";

const APP_PORT = process.env.PORT || 3000;
const QUIZ_SECRET = process.env.QUIZ_SECRET || "";
const MAX_FLOW_MS = parseInt(process.env.MAX_FLOW_MS || `${3 * 60 * 1000}`, 10); // 3 minutes

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

app.get("/", (req, res) => res.send("Quiz endpoint ready"));

app.post("/quiz-endpoint", async (req, res) => {
  // Validate JSON content-type quickly
  if (!req.is("application/json")) {
    return res.status(400).json({ error: "Invalid content-type: expected application/json" });
  }

  const payload = req.body;
  if (!payload || typeof payload !== "object") return res.status(400).json({ error: "Invalid JSON payload" });

  const { email, secret, url } = payload;
  if (!email || !secret || !url) return res.status(400).json({ error: "Missing email, secret, or url" });

  if (!QUIZ_SECRET) {
    console.warn("WARNING: QUIZ_SECRET not set in environment");
  }

  if (secret !== QUIZ_SECRET) return res.status(403).json({ error: "Invalid secret" });

  // Immediately acknowledge
  res.status(200).json({ ok: true, message: "Accepted. Solving started." });

  // Start background solve but enforce deadline
  const startTime = Date.now();
  const deadline = startTime + MAX_FLOW_MS;

  try {
    await solveFlow({ email, secret, url, deadline });
  } catch (err) {
    console.error("Background solve error:", err?.message || err);
  }
});

async function solveFlow({ email, secret, url, deadline }) {
  const remaining = deadline - Date.now();
  if (remaining < 5000) {
    console.warn("Not enough time left to start solving flow");
    return;
  }

  console.log(`Starting solveFlow for ${url} (deadline in ${Math.round((deadline - Date.now())/1000)}s)`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    page.setDefaultTimeout(30000);

    console.log("Navigating to quiz page:", url);
    await page.goto(url, { waitUntil: "networkidle" });

    // Wait some time for JS to populate
    await page.waitForLoadState("domcontentloaded");

    // Try common locations for content
    let extracted = null;
    try { extracted = await page.locator("#result").innerText(); } catch(e) {}
    if (!extracted) {
      try { extracted = await page.locator("pre").first().innerText(); } catch(e) {}
    }
    if (!extracted) {
      // fallback to whole page innerText (may be large)
      try { extracted = await page.evaluate(() => document.body.innerText); } catch(e) {}
    }

    console.log("Extracted content length:", extracted ? extracted.length : 0);

    // Try to find base64 blob and decode JSON
    let decodedJSON = null;
    if (extracted) {
      // find long base64 runs
      const b64Match = extracted.match(/([A-Za-z0-9+/=\\n\\r]{80,})/);
      if (b64Match) {
        try {
          const b64 = b64Match[1].replace(/\s+/g, "");
          const buff = Buffer.from(b64, "base64");
          const s = buff.toString("utf8");
          const jsonMatch = s.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            decodedJSON = JSON.parse(jsonMatch[0]);
            console.log("Decoded JSON from base64 payload");
          } else {
            console.log("Base64 decoded but no JSON object found inside");
          }
        } catch (e) {
          console.warn("Base64 decode failed:", e.message);
        }
      }
    }

    // If page contains downloadable links or files, you can add logic here to handle them.
    // Build answerPayload based on discovered content
    let submitUrl = null;
    let answerPayload = null;

    // If decodedJSON includes submit URL or a 'url' field (sample uses url), prefer it
    if (decodedJSON) {
      submitUrl = decodedJSON.submit || decodedJSON.url || decodedJSON.endpoint || null;
      // if decodedJSON contains 'table' array with rows having 'value' fields, sum them
      if (Array.isArray(decodedJSON.table)) {
        const sum = decodedJSON.table.reduce((acc, r) => acc + (Number(r.value) || 0), 0);
        answerPayload = { email, secret, url, answer: sum };
      }
      // if decodedJSON contains a direct 'answer' field
      if (!answerPayload && typeof decodedJSON.answer !== "undefined") {
        answerPayload = { email, secret, url, answer: decodedJSON.answer };
      }
    }

    // If no submitUrl found yet, attempt to find form action or <a id="submit"> href
    if (!submitUrl) {
      try {
        const formAction = await page.locator("form").first().getAttribute("action");
        if (formAction) submitUrl = new URL(formAction, url).toString();
      } catch (e) {}

      if (!submitUrl) {
        try {
          const linkHref = await page.locator("a#submit").getAttribute("href").catch(()=>null);
          if (linkHref) submitUrl = new URL(linkHref, url).toString();
        } catch (e) {}
      }
    }

    // Heuristic fallback: if there are numbers visible, sum them (last resort)
    if (!answerPayload) {
      try {
        const visibleText = await page.evaluate(() => document.body.innerText || "");
        const nums = Array.from(visibleText.matchAll(/[-+]?[0-9]*\\.?[0-9]+/g)).map(m => Number(m[0]));
        if (nums.length > 0) {
          const candidate = nums.reduce((a, b) => a + b, 0);
          answerPayload = { email, secret, url, answer: candidate };
          console.log("Heuristic numeric candidate answer computed");
        }
      } catch (e) {}
    }

    // Final fallback answer
    if (!answerPayload) {
      answerPayload = { email, secret, url, answer: "unable-to-automatically-solve" };
    }

    if (submitUrl) {
      console.log("Submitting answer to:", submitUrl, "payload preview:", JSON.stringify(answerPayload).slice(0,200));
      try {
        const r = await axios.post(submitUrl, answerPayload, { headers: { "Content-Type": "application/json" }, timeout: 20000 });
        console.log("Submit response status:", r.status, "data:", r.data);
        // If response contains next url, you may want to iterate. Minimal loop:
        if (r.data && r.data.url && Date.now() < deadline) {
          const next = r.data.url;
          console.log("Received next URL:", next);
          // Simple example: follow once (implement full loop if required)
          console.log("Following next URL (single-step):", next);
          await page.goto(next, { waitUntil: "networkidle" });
          // Optionally re-run extraction/submit logic here
        }
      } catch (err) {
        console.error("Error submitting answer:", err?.message || err);
      }
    } else {
      console.warn("No submit URL detected. Computed payload (not posted):", answerPayload);
    }

  } catch (err) {
    console.error("solveFlow caught error:", err?.message || err);
  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

app.listen(APP_PORT, () => {
  console.log(`Server listening on port ${APP_PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => { console.log("SIGTERM received, exiting"); process.exit(0); });
process.on("SIGINT", () => { console.log("SIGINT received, exiting"); process.exit(0); });
