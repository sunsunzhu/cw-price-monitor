const PRODUCT_URL = "https://www.chemistwarehouse.co.nz/buy/141690/aosept-plus-hydraglyde-twin-pack-2-x-360ml";

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

    if (!tgToken || !tgChatId) {
      return res.status(500).json({
        ok: false,
        error: "Missing required env vars: TG_BOT_TOKEN, TG_CHAT_ID"
      });
    }

    const currentPrice = await fetchCurrentPrice();
    const msg = [
      "Chemist Warehouse NZ daily price update",
      `Product: ${PRODUCT_URL}`,
      `Current: NZD $${currentPrice.toFixed(2)}`
    ].join("\n");

    await sendTelegram(tgToken, tgChatId, msg);

    return res.status(200).json({
      ok: true,
      product: PRODUCT_URL,
      current_price: currentPrice,
      notified: true
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}