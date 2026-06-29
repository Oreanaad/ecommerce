// Nave (Naranja X) — Checkout online. Mismo patrón que Mercado Pago:
//   1) OAuth2 machine-to-machine (client_id + client_secret) → access_token (cacheado)
//   2) POST /payment_request/ecommerce → { id, checkout_url } → se redirige al cliente
//   3) Nave notifica server-to-server al notification_url; consultamos el pago y marcamos pagado
// Credenciales por env: NAVE_CLIENT_ID, NAVE_CLIENT_SECRET, NAVE_POS_ID, NAVE_ENV (production|sandbox)
// Endpoints oficiales tomados del plugin "Nave for WooCommerce" (GPL).
export function crearNave() {
  const env = () => (process.env.NAVE_ENV || "production").toLowerCase();
  const isProd = () => env() === "production";
  const clientId = () => process.env.NAVE_CLIENT_ID || "";
  const clientSecret = () => process.env.NAVE_CLIENT_SECRET || "";
  const posId = () => process.env.NAVE_POS_ID || "";
  const configurado = () => !!(clientId() && clientSecret() && posId());

  const AUTH_URL = () => isProd()
    ? "https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate"
    : "https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2ms";
  const AUDIENCE = "https://naranja.com/ranty/merchants/api";
  const BASE = () => isProd() ? "https://api.ranty.io/api" : "https://api-sandbox.ranty.io/api";
  const PAYMENTS = () => isProd() ? "https://punku.ranty.io/payments-ms/payments" : "https://punku-sandbox.ranty.io/payments-ms/payments";

  let _tok = { value: "", exp: 0 };
  async function token() {
    if (_tok.value && Date.now() < _tok.exp) return _tok.value;
    try {
      const r = await fetch(AUTH_URL(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId(), client_secret: clientSecret(), audience: AUDIENCE }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) { console.log("[nave] auth falló", r.status); return ""; }
      _tok = { value: j.access_token, exp: Date.now() + ((Number(j.expires_in) || 3600) - 60) * 1000 };
      return _tok.value;
    } catch (e) { console.log("[nave] auth error", e.message); return ""; }
  }

  async function api(method, url, body) {
    let t = await token(); if (!t) return { ok: false, status: 401, j: {} };
    const doReq = () => fetch(url, {
      method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json", Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let r = await doReq();
    if (r.status === 401) { _tok = { value: "", exp: 0 }; t = await token(); if (t) r = await doReq(); }
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  // items: [{title, description, quantity, unit_price}]; total; externalRef; buyer:{name,email,phone,dni,...}; urls:{callback,webhook}; duracion seg
  async function crearPago({ items, total, externalRef, buyer = {}, urls, duracion = 900 }) {
    const products = items.map((it) => ({
      name: String(it.title || "Producto").slice(0, 120),
      description: String(it.description || it.title || "Producto").slice(0, 250),
      quantity: Math.max(1, Number(it.quantity) || 1),
      unit_price: { currency: "ARS", value: (Math.round(Number(it.unit_price) * 100) / 100).toFixed(2) },
    }));
    const body = {
      external_payment_id: String(externalRef),
      seller: { pos_id: posId() },
      transactions: [{ amount: { currency: "ARS", value: (Math.round(Number(total) * 100) / 100).toFixed(2) }, products }],
      buyer: {
        user_id: String(buyer.userId || ("guest_" + externalRef)),
        session_id: String(buyer.userId || externalRef),
        name: buyer.name || "",
        user_email: buyer.email || "",
        doc_type: "DNI", doc_number: String(buyer.dni || ""),
        phone: buyer.phone || "",
        billing_address: {
          street_1: buyer.calle || "N/A", street_2: "N/A",
          city: buyer.ciudad || "N/A", region: buyer.region || "N/A",
          country: "AR", zipcode: buyer.cp || "0000",
        },
      },
      additional_info: { callback_url: urls.callback, notification_url: urls.webhook },
      platform: { id: "elpasajedental", type: "ecommerce", data: { callback_url: urls.callback, notification_url: urls.webhook } },
      duration_time: Number(duracion) || 900,
    };
    const r = await api("POST", BASE() + "/payment_request/ecommerce", body);
    if (!r.ok || !r.j.checkout_url) return { error: (r.j && (r.j.message || r.j.error)) || ("Nave " + r.status) };
    return { ok: true, id: r.j.id, checkout_url: r.j.checkout_url };
  }

  // Consulta de un pago por id → { status:{name}, payment_code, ... }
  async function estadoPago(paymentId) {
    const r = await api("GET", PAYMENTS() + "/" + encodeURIComponent(paymentId));
    return r.ok ? r.j : null;
  }
  // Consulta de un pago por la URL que manda el webhook (payment_check_url)
  async function estadoPorUrl(url) {
    if (!url) return null;
    if (!/^https?:\/\//.test(url)) url = "https://" + String(url).replace(/^\/+/, "");
    const r = await api("GET", url);
    return r.ok ? r.j : null;
  }
  // Consulta del estado de la INTENCIÓN → { status:{name} } (PENDING/SUCCESS_PROCESSED/EXPIRED/...)
  async function estadoIntencion(id) {
    const r = await api("GET", BASE() + "/payment_requests/" + encodeURIComponent(id));
    return r.ok ? r.j : null;
  }

  return { configurado, env, crearPago, estadoPago, estadoPorUrl, estadoIntencion };
}
