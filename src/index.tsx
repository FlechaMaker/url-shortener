import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { renderer } from "./renderer";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

type Bindings = {
  KV: KVNamespace;
};

const app = new Hono<{
  Bindings: Bindings;
}>();

app.all("*", renderer);

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

app.post("/create", csrf(), validator, async (c) => {
  const { url, customPath } = c.req.valid("form");

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

  return c.render(
    <div>
      <h2>Created!</h2>
      <input
        type="text"
        value={shortenUrl.toString()}
        style={{
          width: "80%",
        }}
        autofocus
      />
    </div>
  );
});

export default app;
