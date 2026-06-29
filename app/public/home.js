const esc = (s) => (s || "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const precio = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
const norm = (s) => (s || "").toLowerCase();
function icono(nombre) {
  const n = norm(nombre);
  const map = [["blanque", "✨"], ["instrumental", "🔬"], ["endodon", "🦷"], ["protes", "🔧"], ["pótesis", "🔧"], ["cirug", "🔪"], ["ortodon", "😬"], ["facultad", "🎓"], ["descartab", "🧤"], ["radiolog", "☢️"], ["operatoria", "🧪"], ["fresa", "🔩"], ["cilindr", "🔩"], ["adhesiv", "🩹"], ["niño", "🧸"], ["periodon", "🪥"], ["medic", "💊"], ["piedra", "💎"]];
  for (const [k, e] of map) if (n.includes(k)) return e;
  return "🦷";
}

async function cargarCategorias() {
  try {
    const d = await (await fetch("/api/tienda/categorias")).json();
    const cats = (d.categorias || []).slice(0, 12);
    document.getElementById("cat-grid").innerHTML = cats.map((c) => {
      const subs = (c.hijas || []).slice(0, 4).map((h) => `<span class="cat-sub">${esc(h.name)}</span>`).join("");
      return `<a class="cat-card" href="/tienda?cat=${encodeURIComponent(c.name)}">
        <div class="cat-icon">${icono(c.name)}</div>
        <div class="cat-name">${esc(c.name)}</div>
        ${subs ? `<div class="cat-subs">${subs}</div>` : `<div class="cat-count">${c.count} productos</div>`}
      </a>`;
    }).join("");
    revelar(".cat-card", ".categories-grid");
  } catch (e) {}
}

async function cargarDestacados() {
  try {
    const d = await (await fetch("/api/tienda/catalogo")).json();
    const conFoto = (d.productos || []).filter((p) => p.imagen && p.precio > 0);
    const dest = conFoto.slice(0, 8);
    document.getElementById("prod-grid").innerHTML = dest.map((p) => `
      <a class="product-card" href="/tienda?p=${p.id}">
        <img class="product-img" src="${esc(p.imagen)}" alt="" loading="lazy">
        <div class="product-body">
          <div class="product-cats">${(p.categorias || []).slice(0, 2).map((c) => `<span class="product-cat-tag">${esc(c)}</span>`).join("")}</div>
          <p class="product-name">${esc(p.nombre)}</p>
          <div class="product-footer">
            <div class="product-price">${precio(p.precio)} <sub>ARS</sub></div>
            <span class="btn-ver">Ver →</span>
          </div>
        </div>
      </a>`).join("");
    revelar(".product-card", ".products-grid");
  } catch (e) {}
}

function revelar(sel, trigger) {
  if (!window.gsap || !window.ScrollTrigger) return;
  gsap.from(sel, { opacity: 0, y: 40, duration: 0.6, stagger: 0.08, ease: "power3.out", scrollTrigger: { trigger, start: "top 85%" } });
}

// Buscador del hero -> tienda
function buscarHome() {
  const q = (document.getElementById("home-q").value || "").trim();
  location.href = q ? "/tienda?cat=" + encodeURIComponent(q) : "/tienda";
}
const hs = document.getElementById("hero-search");
if (hs) { hs.addEventListener("submit", buscarHome); document.getElementById("home-q").addEventListener("keydown", (e) => { if (e.key === "Enter") buscarHome(); }); }

// Navbar scroll
const navbar = document.getElementById("navbar");
window.addEventListener("scroll", () => navbar.classList.toggle("scrolled", window.scrollY > 60), { passive: true });

// Animaciones de entrada del hero
if (window.gsap) {
  gsap.registerPlugin(window.ScrollTrigger);
  const tl = gsap.timeline({ delay: 0.2 });
  tl.to(".hero-logo", { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" })
    .to(".hero-badge", { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "-=0.4")
    .to(".hero-tagline", { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "-=0.45")
    .to(".hero-desc", { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "-=0.4")
    .to(".hero-search", { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "-=0.35")
    .to(".hero-actions", { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "-=0.35")
    .then(() => gsap.to(".hero-logo", { y: -7, duration: 3, ease: "sine.inOut", yoyo: true, repeat: -1 }));
  gsap.utils.toArray(".section-header").forEach((el) => gsap.from(el, { opacity: 0, y: 36, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 84%" } }));
  gsap.from(".stat-item", { opacity: 0, y: 24, duration: 0.55, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: ".stats-bar", start: "top 88%" } });
  gsap.from(".why-card", { opacity: 0, y: 32, duration: 0.6, stagger: 0.1, ease: "power3.out", scrollTrigger: { trigger: ".why-grid", start: "top 84%" } });
}

if (!window.gsap) {
  document.querySelectorAll(".hero-logo,.hero-badge,.hero-tagline,.hero-desc,.hero-search,.hero-actions").forEach((el) => { el.style.opacity = 1; el.style.transform = "none"; });
}
cargarCategorias();
cargarDestacados();
// Banner promocional (solo si está activo en Ajustes)
(async () => {
  try {
    const p = await (await fetch("/api/tienda/promo")).json();
    if (!p.activo) return;
    const hero = document.querySelector(".hero-content"); if (!hero) return;
    const div = document.createElement("div");
    div.className = "hero-promo";
    div.innerHTML = `🎉 ${esc(p.texto)}${p.codigo ? ` — código <b>${esc(p.codigo)}</b>` : ""}`;
    const badge = hero.querySelector(".hero-badge");
    if (badge) badge.after(div); else hero.prepend(div);
  } catch {}
})();

// Título animado cuando el visitante se va a otra pestaña ("volvé")
(function () {
  const orig = document.title;
  const msgs = ["👋 ¡Volvé!", "🦷 Te esperamos", "✨ El Pasaje Dental"];
  let t = null, i = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { t = setInterval(() => { document.title = msgs[i++ % msgs.length]; }, 1100); }
    else { clearInterval(t); t = null; i = 0; document.title = orig; }
  });
})();
