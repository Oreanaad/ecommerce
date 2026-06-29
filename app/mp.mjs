// Mercado Pago — Checkout Pro: crea preferencias de pago y consulta pagos.
// Credenciales por env: MP_ACCESS_TOKEN (Bearer) y MP_PUBLIC_KEY (no se usa server-side, queda por si sumamos Bricks).
export function crearMP() {
  const token = () => process.env.MP_ACCESS_TOKEN || "";
  const configurado = () => !!token();

  async function mpFetch(path, opts = {}) {
    const r = await fetch("https://api.mercadopago.com" + path, {
      ...opts,
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  // items: [{title, quantity, unit_price}]; externalRef: id del pedido WC; payer:{email,name}; urls:{success,failure,pending,webhook}
  async function crearPreferencia({ items, externalRef, payer, urls }) {
    const body = {
      items: items.map((it) => ({ title: String(it.title).slice(0, 250), quantity: Math.max(1, Number(it.quantity) || 1), unit_price: Math.round(Number(it.unit_price) * 100) / 100, currency_id: "ARS" })),
      external_reference: String(externalRef),
      back_urls: { success: urls.success, failure: urls.failure, pending: urls.pending },
      auto_return: "approved",
      notification_url: urls.webhook,
      payer: payer && payer.email ? { email: payer.email, name: payer.name || "" } : undefined,
      statement_descriptor: "EL PASAJE DENTAL",
    };
    const r = await mpFetch("/checkout/preferences", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return { error: (r.j && (r.j.message || (r.j.cause && r.j.cause[0] && r.j.cause[0].description))) || ("MP " + r.status) };
    return { ok: true, id: r.j.id, init_point: r.j.init_point };
  }

  async function obtenerPago(id) {
    const r = await mpFetch("/v1/payments/" + id);
    return r.ok ? r.j : null; // {status, status_detail, external_reference, transaction_amount, ...}
  }

  return { configurado, crearPreferencia, obtenerPago };
}
