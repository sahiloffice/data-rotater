import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import http from "node:http";

const {
  IMPACT_LINK = "https://trackdigi.gotrackier.com/click?campaign_id=408&pub_id=196",
  GOOGLE_SHEET_WEBHOOK = "https://script.google.com/macros/s/AKfycbw_06TVZzUurJbNcllhjhTjuNOlcatlTb8hsQfo0b9S7lSZTiKuM5mSQhalANsfi116fw/exec",
  CAMPAIGN_TAG = "edx_9july",
  PROXY_URL = "http://r_2b61c33a3c-country-us:f6d5155135@pool3.soxy.pro:5000",
  PORT = "3000",
} = process.env;

async function runTracking() {
  const proxyAgent = new HttpsProxyAgent(PROXY_URL);

  let currentUrl = IMPACT_LINK;
  let finalUrl = null;
  const maxHops = 10;

  for (let hop = 0; hop < maxHops; hop++) {
    console.log(`[${new Date().toISOString()}] Hop ${hop}: ${currentUrl}`);

    const response = await axios.get(currentUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      httpsAgent: proxyAgent,
      httpAgent: proxyAgent,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const location = response.headers?.location || response.headers?.Location;

    if (!location || response.status < 300 || response.status >= 400) {
      finalUrl = currentUrl;
      break;
    }

    currentUrl = new URL(location, currentUrl).href;
  }

  if (!finalUrl) {
    console.log("Exceeded max hops without final URL.");
    return { success: false, reason: "too_many_redirects" };
  }

  const decodedUrl = decodeURIComponent(finalUrl);
  const match = decodedUrl.match(/[?&](im_ref|irclickid)=([^&#]*)/);
  const clickId = match ? match[2] : null;

  if (!clickId) {
    console.log("No click ID found in final URL.");
    return { success: false, reason: "no_click_id", finalUrl };
  }

  console.log(`Click ID: ${clickId}`);

  const sheetResp = await axios.post(GOOGLE_SHEET_WEBHOOK, {
    campaign_tag: CAMPAIGN_TAG,
    clickid: clickId,
    user_agent: "Mozilla/5.0",
  });

  console.log(`Google Sheet response [${sheetResp.status}]:`, JSON.stringify(sheetResp.data));
  return { success: true, clickId };
}

// Runs every 5 minutes
const INTERVAL_MS = 5 * 60 * 1000;

function startScheduler() {
  console.log(`Scheduler started. Running every ${INTERVAL_MS / 60000} minutes.`);
  runTracking().catch((err) => console.error("Initial run error:", err.message));
  setInterval(() => {
    runTracking().catch((err) => console.error("Tracking error:", err.message));
  }, INTERVAL_MS);
}

// Tiny HTTP server so Fly.io keeps the VM alive
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`Health check listening on port ${PORT}`);
  startScheduler();
});
