import { Router } from "express";
import { loadTenants } from "../lib/env.js";
import { issueUserToken, listServices as listTenantServices } from "../integrations/mindbody.js";
import { listPackages, listProducts, listServices } from "../services/mbo.js";
import type { MindbodyServiceSummary } from "../integrations/mindbody.js";

export const catalogRouter = Router();

catalogRouter.get("/api/catalog", async (_req, res) => {
  try {
    const [services, products, packages] = await Promise.all([listServices(), listProducts(), listPackages()]);

    res.json({
      services,
      products,
      packages
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "catalog error";
    res.status(502).json({ error: message });
  }
});

catalogRouter.get("/api/:siteId/catalog", async (req, res) => {
  try {
    const tenants = loadTenants();
    const tenant = tenants.get(req.params.siteId);
    const accessToken = await issueUserToken(tenant);
    const services = await listTenantServices(tenant, accessToken);

    res.json(
      services.map((entry: MindbodyServiceSummary) => ({
        id: entry.Id,
        name: entry.Name,
        price: Number(entry.Price ?? 0),
        type: "Service"
      }))
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "catalog error";
    res.status(400).json({ error: message });
  }
});

catalogRouter.get("/s/:siteId/storefront", (req, res) => {
  const { siteId } = req.params;

  res
    .type("html")
    .send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Storefront ${siteId}</title></head>
<body>
  <h1>Storefront (Site ${siteId})</h1>
  <div id="list">Loading…</div>
  <script>
    fetch('/api/${siteId}/catalog')
      .then(r => r.json())
      .then(items => {
        document.getElementById('list').innerHTML = items.map(i => \`
          <div style="margin:8px 0;padding:8px;border:1px solid #ddd;border-radius:8px">
            <b>\${i.name || 'Item ' + i.id}</b> — $\${(Number(i.price)||0).toFixed(2)}
            <form action="/s/${siteId}/buy/\${i.id}" method="get" style="display:inline;margin-left:8px">
              <input type="email" name="email" placeholder="email@you.com" required>
              <button type="submit">Buy</button>
            </form>
          </div>\`).join('');
      })
      .catch(() => {
        document.getElementById('list').textContent = 'Unable to load catalog';
      });
  </script>
</body></html>`);
});

catalogRouter.get("/s/:siteId/buy/:itemId", (req, res) => {
  const { siteId, itemId } = req.params;
  const email = typeof req.query.email === "string" ? req.query.email : "";

  if (!email) {
    res.status(400).send("email required");
    return;
  }

  res.redirect(
    `/checkout?siteId=${encodeURIComponent(siteId)}&itemId=${encodeURIComponent(itemId)}&itemType=Service&email=${encodeURIComponent(email)}`
  );
});
