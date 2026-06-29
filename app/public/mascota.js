// Denti 🦷 — mascota/asistente de El Pasaje Dental (widget autocontenido para tienda y home)
(function () {
  const esc = (s) => (s || "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Avatares de Denti (uno al azar por carga de página). Si una imagen falla, cae al emoji 🦷.
  const DENTIS = ["/assets/denti-1.png", "/assets/denti-3.png"];
  const DENTI = DENTIS[Math.floor(Math.random() * DENTIS.length)];
  const avatar = (cls) => `<img class="${cls}" src="${DENTI}" alt="Denti" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🦷',className:'${cls} emoji'}))">`;
  const DATOS = [
    "El <b>alginato</b> es un material de impresión: se mezcla con agua, fragua en minutos y copia los dientes para hacer modelos. 🦷",
    "El <b>esmalte dental</b> es el tejido más duro del cuerpo humano. 💪",
    "Las <b>limas de endodoncia</b> vienen numeradas por calibre (color por número) para trabajar el conducto.",
    "Los <b>conos de gutapercha</b> se usan para sellar el conducto en la endodoncia.",
    "La <b>turbina</b> gira a más de 300.000 RPM — por eso ese sonido característico. 😅",
    "El <b>composite</b> se endurece con luz (fotocurado): por eso la lámpara azul.",
    "El <b>ácido grabador</b> (ortofosfórico al 37%) prepara el esmalte para que adhiera la resina.",
    "Una buena <b>aislación con goma dique</b> mejora muchísimo la calidad de las restauraciones.",
  ];
  const css = `
  @keyframes denti-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  .denti-fab{position:fixed;left:14px;bottom:calc(16px + env(safe-area-inset-bottom));width:104px;height:130px;border:none;background:none;padding:0;cursor:pointer;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;animation:denti-float 3.4s ease-in-out infinite;transition:transform .2s}
  .denti-fab:hover{transform:scale(1.07)}
  .denti-fab:active{transform:scale(.96)}
  .denti-fab-img{width:100%;height:108px;object-fit:contain;filter:drop-shadow(0 7px 9px rgba(74,10,38,.32))}
  .denti-fab-img.emoji{font-size:70px;height:auto;filter:drop-shadow(0 4px 6px rgba(0,0,0,.25))}
  .denti-bocadillo{order:-1;background:#DE3667;color:#fff;border-radius:14px;padding:6px 13px;font-size:12.5px;white-space:nowrap;box-shadow:0 5px 16px rgba(74,10,38,.28);font-family:Inter,Arial,sans-serif;font-weight:700;margin-bottom:5px;position:relative}
  .denti-bocadillo::after{content:"";position:absolute;bottom:-5px;left:26px;border:6px solid transparent;border-top-color:#DE3667;border-bottom:0}
  .denti-panel{position:fixed;left:18px;bottom:94px;width:min(346px,calc(100vw - 36px));max-height:72vh;background:#fff;border:1px solid #f5d5e8;border-radius:20px;box-shadow:0 18px 50px rgba(74,10,38,.28);z-index:9001;display:none;flex-direction:column;overflow:hidden;font-family:Inter,Arial,sans-serif}
  .denti-panel.open{display:flex;animation:denti-pop .22s ease}
  @keyframes denti-pop{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
  .denti-head{background:linear-gradient(135deg,#7a1040,#DE3667);color:#fff;padding:13px 16px;display:flex;align-items:center;gap:11px}
  .denti-av{width:42px;height:42px;object-fit:contain;background:rgba(255,255,255,.92);border-radius:50%;padding:3px;flex:0 0 auto}
  .denti-av.emoji{font-size:26px;width:42px;height:42px;display:flex;align-items:center;justify-content:center}
  .denti-head b{font-size:15px}.denti-head small{opacity:.9;font-size:12px;display:block}
  .denti-x{margin-left:auto;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}
  .denti-body{padding:12px;overflow-y:auto;flex:1;background:#fff7fb}
  .denti-msg{background:#fff;border:1px solid #f0dbe7;border-radius:14px;padding:10px 12px;font-size:14px;color:#334155;margin-bottom:8px;line-height:1.45}
  .denti-msg.user{background:#DE3667;color:#fff;border:none;margin-left:auto;max-width:85%;border-bottom-right-radius:4px}
  .denti-msg.denti{display:flex;gap:8px;align-items:flex-start;background:transparent;border:none;padding:0}
  .denti-msg.denti .ico{width:30px;height:30px;object-fit:contain;flex:0 0 auto;margin-top:2px}
  .denti-msg.denti .ico.emoji{font-size:22px;width:auto;height:auto}
  .denti-msg.denti .burb{background:#fff;border:1px solid #f0dbe7;border-radius:14px;border-top-left-radius:4px;padding:10px 12px;flex:1}
  .denti-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px 38px}
  .denti-chip{background:#fff;border:1px solid #f0dbe7;color:#b02060;border-radius:100px;padding:5px 11px;font-size:12px;cursor:pointer}
  .denti-chip:hover{background:#fff0f7}
  .denti-foot{display:flex;gap:6px;padding:10px;border-top:1px solid #f0dbe7;background:#fff}
  .denti-foot input{flex:1;border:1px solid #e4cdd9;border-radius:100px;padding:9px 14px;font-size:14px;font-family:inherit;outline:none}
  .denti-foot button{background:#DE3667;color:#fff;border:none;border-radius:100px;width:40px;font-size:16px;cursor:pointer}
  @media (max-width:640px){.denti-fab{width:70px;height:92px;left:10px}.denti-fab-img{height:74px}.denti-bocadillo{font-size:10.5px;padding:4px 9px}.denti-bocadillo::after{left:20px}}`;
  // En mobile, Denti solo en el home: en la tienda ocupa mucho de la pantalla
  const esTienda = /tienda/i.test(location.pathname);
  const esMobile = window.matchMedia("(max-width: 640px)").matches;
  if (esTienda && esMobile) return;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const fab = document.createElement("button");
  fab.className = "denti-fab"; fab.setAttribute("aria-label", "Preguntale a Denti");
  fab.innerHTML = `<span class="denti-bocadillo">💬 ¿Consultas?</span>${avatar("denti-fab-img")}`;
  const panel = document.createElement("div");
  panel.className = "denti-panel";
  panel.innerHTML = `
    <div class="denti-head">${avatar("denti-av")}<div><b>¡Hola! Soy Denti 🦷</b><small>¿Te puedo ayudar?</small></div><button class="denti-x" aria-label="Cerrar">✕</button></div>
    <div class="denti-body" id="denti-body"></div>
    <div class="denti-foot"><input id="denti-in" placeholder="Escribime tu duda…" autocomplete="off"><button id="denti-send" aria-label="Enviar">➤</button></div>`;
  document.body.appendChild(fab); document.body.appendChild(panel);

  const body = panel.querySelector("#denti-body");
  const input = panel.querySelector("#denti-in");
  function add(html, who) {
    const d = document.createElement("div"); d.className = "denti-msg " + (who || "denti");
    d.innerHTML = who === "user" ? esc(html) : `${avatar("ico")}<div class="burb">${html}</div>`;
    body.appendChild(d); body.scrollTop = body.scrollHeight; return d;
  }
  let saludado = false;
  function abrir() {
    panel.classList.add("open"); fab.style.display = "none";
    if (!saludado) {
      saludado = true;
      const fact = DATOS[Math.floor(Math.random() * DATOS.length)];
      add(`¡Hola! Soy <b>Denti</b> 🦷 Preguntame lo que quieras sobre productos o materiales.<br><br>💡 <i>Dato:</i> ${fact}`);
      const chips = document.createElement("div"); chips.className = "denti-chips";
      ["¿Qué es el alginato?", "¿Para qué sirve el composite?", "Otro dato 🎲"].forEach((t) => { const c = document.createElement("div"); c.className = "denti-chip"; c.textContent = t; c.onclick = () => { if (t.startsWith("Otro")) { add("💡 " + DATOS[Math.floor(Math.random() * DATOS.length)]); } else { input.value = t; enviar(); } }; chips.appendChild(c); });
      body.appendChild(chips);
    }
    setTimeout(() => input.focus(), 100);
  }
  function cerrar() { panel.classList.remove("open"); fab.style.display = "flex"; }
  async function enviar() {
    const q = input.value.trim(); if (!q) return;
    add(q, "user"); input.value = "";
    const pensando = add("Pensando… 💭");
    try {
      const r = await (await fetch("/api/tienda/preguntar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pregunta: q }) })).json();
      pensando.querySelector(".burb").innerHTML = r.texto ? esc(r.texto).replace(/\n/g, "<br>") : (r.error || "No pude responder ahora. Escribinos por WhatsApp 😊");
    } catch { const b = pensando.querySelector(".burb"); if (b) b.textContent = "No me pude conectar. Probá de nuevo."; }
    body.scrollTop = body.scrollHeight;
  }
  fab.onclick = abrir;
  panel.querySelector(".denti-x").onclick = cerrar;
  panel.querySelector("#denti-send").onclick = enviar;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });
})();
