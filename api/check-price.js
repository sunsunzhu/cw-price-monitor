const PRODUCT_URL = "https://www.chemistwarehouse.co.nz/buy/141690/aosept-plus-hydraglyde-twin-pack-2-x-360ml";
const REDIS_KEY = "cw:nz:aosept:last_price";

function parsePriceFromHtml(html) {
  const marker = /<span[^>]*class=["'][^"']*product__price[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;
  const m = html.match(marker);
  if (!m) {
    throw new Error("Price element not found: span.product__price");
  }
  const text = m[1].replace(/<[^>]+>/g, "").trim();
  const n = text.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!n) {
    throw new Error(`Price parse failed from text: ${text}`);
  }
  return Number.parseFloat(n[1]);
}

async function fetchCurrentPrice() {
  const res = await fetch(PRODUCT_URL, {
    method: "GET",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-NZ,en;q=0.9",
      referer: "https://www.chemistwarehouse.co.nz/"
    }
  });

  if (!res.ok) {
    throw new Error(`Fetch product page failed: HTTP ${res.status}`);
  }

  const html = await res.text();
  return parsePriceFromHtml(html);
}

async function redisGet(url, token, key) {
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Upstash GET failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.result;
}

async function redisSet(url, token, key, value) {
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Upstash SET failed: HTTP ${res.status}`);
  }
}

async function sendTelegram(token, chatId, message) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Telegram send failed: HTTP ${res.status}, body=${txt}`);
  }
}

export default async function handler(req, res) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const got = req.headers["x-cron-secret"];
      if (got !== cronSecret) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
    }

    const tgToken = process.env.TG_BOT_TOKEN;
    const tgChatId = process.env.TG_CHAT_ID;
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!tgToken || !tgChatId || !redisUrl || !redisToken) {
      return res.status(500).json({
        ok: false,
        error: "Missing required env vars: TG_BOT_TOKEN, TG_CHAT_ID, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN"
      });
    }

    const currentPrice = await fetchCurrentPrice();
    const lastRaw = await redisGet(redisUrl, redisToken, REDIS_KEY);
    const lastPrice = lastRaw == null ? null : Number.parseFloat(lastRaw);

    let notified = false;
    if (lastPrice != null && Number.isFinite(lastPrice) && currentPrice < lastPrice) {
      const diff = (lastPrice - currentPrice).toFixed(2);
      const msg = [
        "Chemist Warehouse NZ price drop detected",
        `Product: ${PRODUCT_URL}`,
        `Previous: NZD $${lastPrice.toFixed(2)}`,
        `Current: NZD $${currentPrice.toFixed(2)}`,
        `Drop: NZD $${diff}`
      ].join("\n");
      await sendTelegram(tgToken, tgChatId, msg);
      notified = true;
    }

    await redisSet(redisUrl, redisToken, REDIS_KEY, currentPrice.toFixed(2));

    return res.status(200).json({
      ok: true,
      product: PRODUCT_URL,
      current_price: currentPrice,
      last_price: lastPrice,
      notified
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
