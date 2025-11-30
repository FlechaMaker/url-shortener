import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { renderer } from "./renderer";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import QRCode from "qrcode";

type Bindings = {
  KV: KVNamespace;
  RATE_LIMITER: KVNamespace;
  // 環境変数として設定する簡易的な認証トークン
  // wrangler.tomlまたはCloudflareダッシュボードで設定してください
  AUTH_TOKEN?: string;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

// Rate Limiter Middleware
const rateLimiter = async (c: any, next: any) => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const key = `rate:${ip}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1分間
  const maxRequests = 10; // 1分間に10リクエストまで

  const data = await c.env.RATE_LIMITER?.get(key);
  let requests: number[] = data ? JSON.parse(data) : [];

  // 古いリクエストを削除
  requests = requests.filter((timestamp) => now - timestamp < windowMs);

  if (requests.length >= maxRequests) {
    return c.text("Too many requests. Please try again later.", 429);
  }

  requests.push(now);
  await c.env.RATE_LIMITER?.put(key, JSON.stringify(requests), {
    expirationTtl: 60,
  });

  await next();
};

app.all("*", renderer);

// robots.txt - 検索エンジン対策
app.get("/robots.txt", (c) => {
  return c.text("User-agent: *\nDisallow: /");
});

// QRコード画像生成エンドポイント（SVG）
app.get("/qr/:filename", async (c) => {
  const filename = c.req.param("filename");
  
  if (!filename.endsWith(".svg")) {
    return c.text("Not found", 404);
  }

  const key = filename.replace(".svg", "");
  const url = await c.env.KV.get(key);

  if (url === null) {
    return c.text("Not found", 404);
  }

  const shortenUrl = new URL(`/${key}`, c.req.url);
  const shortenUrlString = shortenUrl.toString();
  const displayText = shortenUrlString.replace(/^https?:\/\//, "");

  try {
    // QRコードの生データを生成
    const qr = QRCode.create(shortenUrlString, {
      errorCorrectionLevel: "H",
    });
    const modules = qr.modules;
    const size = modules.size;
    const cellSize = 10; // 各セルのサイズ
    const margin = 4; // マージン（セル数）
    const qrSize = (size + margin * 2) * cellSize;
    
    // QRコード部分のパスを生成
    let path = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modules.data[r * size + c]) {
          const x = (c + margin) * cellSize;
          const y = (r + margin) * cellSize;
          path += `M${x},${y}h${cellSize}v${cellSize}h-${cellSize}z`;
        }
      }
    }

    // 全体のSVGサイズ
    const width = qrSize;
    const height = qrSize; // テキストを中に含めるので高さは幅と同じにする

    // テキストのスタイルと配置
    let fontSize = 32;
    const textPadding = 4;
    const maxTextWidth = width * 0.6; // QRコードの幅の80%を最大幅とする

    // 簡易的なテキスト幅の計算（正確ではないが近似値: Arialの平均的な文字幅率0.6と仮定）
    let textWidthEstimate = displayText.length * (fontSize * 0.6) + (textPadding * 2);

    // 幅が溢れる場合はフォントサイズを縮小
    if (textWidthEstimate > maxTextWidth) {
      const scale = maxTextWidth / textWidthEstimate;
      fontSize = Math.floor(fontSize * scale);
      // 最低フォントサイズを設定
      if (fontSize < 12) fontSize = 12;
      
      // 再計算
      textWidthEstimate = displayText.length * (fontSize * 0.6) + (textPadding * 2);
    }

    const textHeight = fontSize + (textPadding * 2);
    
    const textX = width / 2;
    const textY = height / 2;

    // SVGを構築
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="white"/>
  <path d="${path}" fill="black"/>
  
  <!-- テキストの背景（白抜き） -->
  <rect x="${textX - textWidthEstimate / 2}" y="${textY - textHeight / 2}" width="${textWidthEstimate}" height="${textHeight}" fill="white" />
  
  <!-- テキスト -->
  <text x="${textX}" y="${textY}" dy="5" font-family="Arial, sans-serif" font-size="${fontSize}" text-anchor="middle" fill="black" font-weight="bold">${displayText}</text>
</svg>`;

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error(error);
    return c.text("Error generating QR code", 500);
  }
});

// リダイレクトエンドポイント（大人数に公開する可能性があるためRate Limitなし）
app.get("/:key{[0-9a-z-]+}", async (c) => {
  const key = c.req.param("key");
  const url = await c.env.KV.get(key);

  if (url === null) {
    return c.redirect("/");
  }

  return c.redirect(url);
});

app.get("/", (c) => {
  return c.render(
    <div>
      <h2>Create shorten URL!</h2>
      <form action="/create" method="post">
        <div style={{ marginBottom: "10px" }}>
          <label for="url">URL:</label>
          <br />
          <input
            type="text"
            name="url"
            id="url"
            autocomplete="off"
            placeholder="https://example.com"
            style={{
              width: "80%",
            }}
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label for="customPath">Custom path (optional):</label>
          <br />
          <input
            type="text"
            name="customPath"
            id="customPath"
            autocomplete="off"
            placeholder="my-custom-path"
            pattern="[0-9a-z-]+"
            title="Only lowercase letters, numbers, and hyphens are allowed"
            style={{
              width: "80%",
            }}
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label for="token">Auth Token:</label>
          <br />
          <input
            type="password"
            name="token"
            id="token"
            autocomplete="off"
            placeholder="Enter auth token"
            required
            style={{
              width: "80%",
            }}
          />
        </div>
        <button type="submit">Create</button>
      </form>
    </div>
  );
});

const schema = z.object({
  url: z.string().url(),
  customPath: z
    .string()
    .regex(/^[0-9a-z-]*$/)
    .optional(),
  token: z.string().min(1, "Auth token is required"),
});

const validator = zValidator("form", schema, (result, c) => {
  if (!result.success) {
    return c.render(
      <div>
        <h2>Error!</h2>
        <a href="/">Back to top</a>
      </div>
    );
  }
});

const createKey = async (kv: KVNamespace, url: string): Promise<string> => {
  const uuid = crypto.randomUUID();
  const key = uuid.substring(0, 6);
  const result = await kv.get(key);
  if (!result) {
    await kv.put(key, url);
  } else {
    return await createKey(kv, url);
  }
  return key;
};





app.post("/create", csrf(), rateLimiter, validator, async (c) => {
  const { url, customPath, token } = c.req.valid("form");

  // 認証トークンの検証
  const authToken = c.env.AUTH_TOKEN;
  if (authToken && token !== authToken) {
    return c.render(
      <div>
        <h2>Error!</h2>
        <p>Invalid authentication token.</p>
        <a href="/">Back to top</a>
      </div>
    );
  }

  let key: string;

  if (customPath && customPath.trim() !== "") {
    // Check if custom path already exists
    const existing = await c.env.KV.get(customPath);
    if (existing) {
      return c.render(
        <div>
          <h2>Error!</h2>
          <p>
            The custom path "{customPath}" is already in use. Please choose a
            different one.
          </p>
          <a href="/">Back to top</a>
        </div>
      );
    }
    key = customPath;
    await c.env.KV.put(key, url);
  } else {
    key = await createKey(c.env.KV, url);
  }

  const shortenUrl = new URL(`/${key}`, c.req.url);
  const shortenUrlString = shortenUrl.toString();
  const displayText = shortenUrlString.replace(/^https?:\/\//, "");

  return c.render(
    <div>
      <h2>Created!</h2>
      <input
        type="text"
        value={shortenUrlString}
        style={{
          width: "80%",
        }}
        autofocus
      />
      <div style={{ marginTop: "20px" }}>
        <h3>QR Code Images:</h3>
        <div style={{ marginBottom: "20px" }}>
          <h4>QR Code (SVG):</h4>
          <img
            src={`/qr/${key}.svg`}
            alt="QR Code SVG"
            style={{ border: "1px solid #ccc", padding: "10px", maxWidth: "100%", height: "auto" }}
          />
          <br />
          <a href={`/qr/${key}.svg`} download={`${key}-qr.svg`}>
            Download SVG
          </a>
        </div>
      </div>
    </div>
  );
});

export default app;
