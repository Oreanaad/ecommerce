// Cálculo de envío en vivo usando la Store API de WooCommerce.
// Corre el mismo cálculo de tarifas que el checkout real (incluye Andreani),
// sin tocar el plugin ni crear pedidos: solo arma un carrito temporal y consulta.

// Provincias de Argentina con su código WooCommerce (una letra).
export const PROV_AR = [
  ["B", "Buenos Aires"], ["C", "CABA"], ["K", "Catamarca"], ["H", "Chaco"], ["U", "Chubut"],
  ["X", "Córdoba"], ["W", "Corrientes"], ["E", "Entre Ríos"], ["P", "Formosa"], ["Y", "Jujuy"],
  ["L", "La Pampa"], ["F", "La Rioja"], ["M", "Mendoza"], ["N", "Misiones"], ["Q", "Neuquén"],
  ["R", "Río Negro"], ["A", "Salta"], ["J", "San Juan"], ["D", "San Luis"], ["Z", "Santa Cruz"],
  ["S", "Santa Fe"], ["G", "Santiago del Estero"], ["V", "Tierra del Fuego"], ["T", "Tucumán"],
];

// Devuelve [{ rate_id, method_id, name, price, price_raw, minor, selected }]
export async function calcularEnvio(wooUrl, items, address) {
  const base = wooUrl + "/wp-json/wc/store/v1";
  const g = await fetch(base + "/cart"); // cada GET sin token = carrito nuevo y vacío
  if (!g.ok) throw new Error("store-api cart " + g.status);
  const H = { "Content-Type": "application/json", "Cart-Token": g.headers.get("cart-token"), "Nonce": g.headers.get("nonce") };

  for (const it of items) {
    const qty = Math.max(1, Number(it.qty) || 1);
    const idVar = Number(it.variationId || it.id);
    let a = await fetch(base + "/cart/add-item", { method: "POST", headers: H, body: JSON.stringify({ id: idVar, quantity: qty }) });
    if (!a.ok && it.variationId) // fallback: producto padre si la variación no entra directo
      await fetch(base + "/cart/add-item", { method: "POST", headers: H, body: JSON.stringify({ id: Number(it.id), quantity: qty }) });
  }

  const upd = await fetch(base + "/cart/update-customer", { method: "POST", headers: H, body: JSON.stringify({ shipping_address: address }) });
  if (!upd.ok) throw new Error("update-customer " + upd.status + " " + (await upd.text()).slice(0, 160));
  const j = await upd.json();

  const out = [];
  for (const pk of j.shipping_rates || [])
    for (const r of pk.shipping_rates || []) {
      const minor = r.currency_minor_unit != null ? r.currency_minor_unit : 2;
      out.push({
        rate_id: r.rate_id, method_id: r.method_id, name: r.name,
        price: Number(r.price) / Math.pow(10, minor), price_raw: r.price, minor, selected: !!r.selected,
      });
    }
  return out;
}
