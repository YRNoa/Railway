const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const express = require("express");

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("ERROR: API_KEY env var is required");
  process.exit(1);
}

app.use((req, res, next) => {
  if (req.headers["x-api-key"] !== API_KEY)
    return res.status(401).json({ error: "unauthorized" });
  next();
});

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    // protocolTimeout: ceiling for a single CDP call. The default can fire on a
    // resource-starved host mid-sendMessage → "Runtime.callFunctionOn timed out".
    protocolTimeout: 120000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // Critical on Railway/Docker: the default /dev/shm (~64MB) is too small,
      // so Chromium stalls on heavy page evaluations (e.g. sending a message).
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
    ],
  },
});

let qrDataUrl = null;
let ready = false;

client.on("qr", async (qr) => {
  console.log("QR received");
  qrDataUrl = await qrcode.toDataURL(qr);
  ready = false;
});

client.on("ready", () => {
  console.log("WhatsApp client ready");
  ready = true;
  qrDataUrl = null;
});

client.on("disconnected", (reason) => {
  console.log("Disconnected:", reason);
  ready = false;
});

client.initialize();

app.get("/status", (req, res) => {
  res.json({ ready, hasQr: !!qrDataUrl });
});

app.get("/qr", (req, res) => {
  if (!qrDataUrl) return res.status(404).json({ error: "no_qr" });
  res.json({ qr: qrDataUrl });
});

// POST /send  { to: "972501234567", message: "..." }
app.post("/send", async (req, res) => {
  if (!ready) return res.status(503).json({ error: "not_ready" });
  const { to, message } = req.body;
  if (!to || !message)
    return res.status(400).json({ error: "missing_fields" });

  const digits = to.replace(/\D/g, "");
  const chatId = digits.includes("@") ? digits : `${digits}@c.us`;

  try {
    await client.sendMessage(chatId, message);
    res.json({ ok: true });
  } catch (err) {
    console.error("send error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`WhatsApp service on port ${PORT}`));
