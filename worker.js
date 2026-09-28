// Worker "adega-api" — Adega Virtual
// 1) POST /       → repassa a chamada para a API do Claude (análise de fotos e preços)
// 2) GET  /data   → devolve a adega salva na nuvem
// 3) PUT  /data   → grava a adega na nuvem
//
// Precisa de:
//   - Secret  ANTHROPIC_API_KEY  (já existe)
//   - Secret  SYNC_KEY           (nova: a chave de sincronização)
//   - Binding KV  ADEGA_KV       (novo: o armazenamento)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Key",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    // ── Dados da adega ──
    if (url.pathname === "/data") {
      if (!env.SYNC_KEY || request.headers.get("X-Sync-Key") !== env.SYNC_KEY) {
        return json({ error: "chave inválida" }, 401);
      }
      if (request.method === "GET") {
        const data = await env.ADEGA_KV.get("adega");
        if (!data) return json({ error: "vazio" }, 404);
        return new Response(data, { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      if (request.method === "PUT") {
        const body = await request.text();
        let parsed;
        try { parsed = JSON.parse(body); } catch { return json({ error: "json inválido" }, 400); }
        if (!Array.isArray(parsed.wines) || !Array.isArray(parsed.wishlist)) {
          return json({ error: "formato inválido" }, 400);
        }
        // guarda também a versão anterior, como rede de segurança
        const previous = await env.ADEGA_KV.get("adega");
        if (previous) await env.ADEGA_KV.put("adega-anterior", previous);
        await env.ADEGA_KV.put("adega", body);
        return json({ ok: true });
      }
      return json({ error: "método não suportado" }, 405);
    }

    // ── Proxy para a API do Claude ──
    if (request.method === "POST") {
      const body = await request.text();
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body,
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return json({ error: "não encontrado" }, 404);
  },
};
