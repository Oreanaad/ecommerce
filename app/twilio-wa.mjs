// Twilio WhatsApp — envío de mensajes (Messages API).
// Credenciales por env:
//   TWILIO_SID    — Account SID
//   TWILIO_TOKEN  — Auth Token
//   TWILIO_WA_FROM — número remitente (ej. "whatsapp:+14155238886" del Sandbox, o tu número aprobado)
// Reglas de Meta: fuera de la ventana de 24h solo se pueden mandar PLANTILLAS aprobadas (ContentSid + variables).
// Dentro de la ventana de 24h (el cliente te escribió) se puede mandar texto libre (Body).
export function crearTwilioWA() {
  const sid = () => process.env.TWILIO_SID || "";
  const token = () => process.env.TWILIO_TOKEN || "";
  const from = () => process.env.TWILIO_WA_FROM || "";
  const configurado = () => !!(sid() && token() && from());

  // Normaliza un número a "whatsapp:+549..." (formato internacional)
  function waAddr(num) {
    let n = String(num || "").trim();
    if (n.startsWith("whatsapp:")) return n;
    n = n.replace(/[^\d+]/g, "");
    if (!n) return "";
    if (!n.startsWith("+")) n = "+" + n.replace(/^0+/, "");
    return "whatsapp:" + n;
  }
  const fromAddr = () => { const f = from(); return f.startsWith("whatsapp:") ? f : "whatsapp:" + f.replace(/[^\d+]/g, ""); };

  // enviar({ to, body })  → texto libre (ventana 24h)
  // enviar({ to, contentSid, contentVariables }) → plantilla aprobada
  async function enviar({ to, body, contentSid, contentVariables }) {
    if (!configurado()) return { error: "Twilio WhatsApp no está configurado" };
    const dest = waAddr(to); if (!dest) return { error: "Número de destino inválido" };
    const params = new URLSearchParams();
    params.set("From", fromAddr());
    params.set("To", dest);
    if (contentSid) {
      params.set("ContentSid", contentSid);
      if (contentVariables) params.set("ContentVariables", typeof contentVariables === "string" ? contentVariables : JSON.stringify(contentVariables));
    } else {
      params.set("Body", String(body || ""));
    }
    const auth = "Basic " + Buffer.from(`${sid()}:${token()}`).toString("base64");
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages.json`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log("[twilio-wa]", r.status, j.message || ""); return { error: j.message || ("Twilio " + r.status), code: j.code }; }
      return { ok: true, sid: j.sid, status: j.status };
    } catch (e) { console.log("[twilio-wa] error", e.message); return { error: e.message }; }
  }

  return { configurado, enviar };
}
