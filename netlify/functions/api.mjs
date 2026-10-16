// Bot ou Pas — petite API de partage (classements, votes, morceaux proposés)
// Stockage : Netlify Blobs (inclus gratuitement, aucune base de données à créer)
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const SEG = "[A-Za-z0-9_-]{1,64}";
const RE_PLAYER = new RegExp(`^players/(${SEG})$`);
const RE_UPLOAD = new RegExp(`^uploads/(${SEG})/c/(${SEG})$`);
const RE_LABELS = /^catalog\/labels$/;
const LIMITS = { player: 120_000, upload: 300_000, labels: 20_000 };

const idFromSecret = (secret) => createHash("sha256").update(secret).digest("hex").slice(0, 24);

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "");
  const store = getStore({ name: "botoupas", consistency: "strong" });

  if (route === "ping") return json({ ok: true });

  if (route === "doc") {
    const path = url.searchParams.get("path") || "";
    const kind = RE_PLAYER.test(path) ? "player" : RE_UPLOAD.test(path) ? "upload" : RE_LABELS.test(path) ? "labels" : null;
    if (!kind) return json({ error: "chemin invalide" }, 400);

    if (req.method === "GET") {
      const data = await store.get(path, { type: "json" });
      return json(data ? { exists: true, data } : { exists: false });
    }

    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > LIMITS[kind]) return json({ error: "trop volumineux" }, 413);
      let data;
      try { data = JSON.parse(body); } catch { return json({ error: "JSON invalide" }, 400); }
      if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "objet attendu" }, 400);

      if (kind === "labels") {
        const key = process.env.ADMIN_KEY;
        if (!key || req.headers.get("x-admin-key") !== key) return json({ error: "accès refusé" }, 403);
      } else {
        const secret = req.headers.get("x-player-secret") || "";
        if (secret.length < 32) return json({ error: "joueur inconnu" }, 403);
        const owner = (path.match(RE_PLAYER) || path.match(RE_UPLOAD))[1];
        if (idFromSecret(secret) !== owner) return json({ error: "accès refusé" }, 403);
      }
      await store.setJSON(path, data);
      return json({ ok: true });
    }
    return json({ error: "méthode non gérée" }, 405);
  }

  if (route === "list" && req.method === "GET") {
    const prefix = url.searchParams.get("prefix");
    if (prefix !== "players") return json({ error: "collection invalide" }, 400);
    const limit = Math.min(1000, Number(url.searchParams.get("limit")) || 500);
    const { blobs } = await store.list({ prefix: "players/" });
    const keys = blobs.slice(0, limit).map((b) => b.key);
    const rows = await Promise.all(keys.map(async (k) => ({ id: k.slice(8), data: await store.get(k, { type: "json" }) })));
    return json(rows.filter((r) => r.data));
  }

  return json({ error: "introuvable" }, 404);
};

export const config = { path: "/api/*" };
