/* =====================================================
   PEDIDOS DE AUTOSERVICIO (Restaurante / Heladería) — 05-nov-2026
   Pantalla para que los clientes pidan solos desde un dispositivo del local.
   Candados:
   - Solo funciona en un dispositivo AUTORIZADO con el PIN de un administrador
     (el servidor guarda solo la huella del pase; el pase vive en este equipo).
   - El precio lo pone el servidor; aquí solo se elige qué y cuántos.
   - Cada pedido lleva un código único: si se toca dos veces o se corta la señal, no se duplica.
   - Para salir del modo pedidos se pide otra vez el PIN de administrador
     (botón invisible en la esquina superior derecha: tocar 3 veces).
===================================================== */
const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const K = { uid: null, token: null, menu: null, carrito: [], cat: null, ref: null, demo: false, enviando: false, ultimaActividad: Date.now() };
const SIMBOLOS = { NIO: 'C$', USD: '$', CRC: '₡', HNL: 'L', GTQ: 'Q', MXN: '$', EUR: '€', COP: '$', PEN: 'S/', DOP: 'RD$' };
const ICONOS_CAT = [[/helad|cono|vaso/i, '🍦'], [/topping/i, '🍫'], [/sirope|crema/i, '🍯'], [/malteada|batido|bebida|jugo|refresco|caf/i, '🥤'], [/postre|pastel|brownie/i, '🍰'],
  [/paleta/i, '🍭'], [/llevar/i, '🛍️'], [/pizza/i, '🍕'], [/hambur/i, '🍔'], [/pollo/i, '🍗'], [/ensalada/i, '🥗'], [/carne|res/i, '🥩'], [/mar|pesc|camar/i, '🦐'], [/sopa/i, '🍲']];

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { const s = SIMBOLOS[K.menu?.moneda] || (K.menu?.moneda || 'C$'); return s + ' ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function nuevoRef() { try { return crypto.randomUUID(); } catch (_) { return 'k' + Date.now() + Math.random().toString(36).slice(2); } }
function iconoDe(cat) { const r = ICONOS_CAT.find(([re]) => re.test(cat || '')); return r ? r[1] : (K.menu?.heladeria ? '🍨' : '🍽️'); }
function claveToken() { return 'n360_kiosko_' + K.uid; }
function mostrar(id) { document.querySelectorAll('.pantalla').forEach(p => p.classList.add('oculto')); if (id) document.getElementById(id).classList.remove('oculto'); }
function lugar() { return K.menu?.heladeria ? 'barra' : 'cocina'; }

const MOTIVOS = {
  pase: 'Este dispositivo ya no está autorizado.', datos: 'Algún dato no es válido.', vacio: 'Tu pedido está vacío.',
  cantidad: 'Revisa las cantidades (máximo 30 por producto).', producto: 'Uno de los productos ya no está disponible. Quítalo e intenta de nuevo.',
  muchos: 'Hay muchos pedidos seguidos desde este equipo. Espera un momento.', admin: 'Elige un administrador.',
  incorrecto: 'PIN incorrecto.', formato: 'Escribe el PIN.', bloqueado: 'Demasiados intentos. Espera unos minutos.', desactivado: 'El módulo de Restaurante/Heladería no está encendido en este negocio.',
  mesa: 'Esa mesa ya no existe.',
};
const textoMotivo = (r) => MOTIVOS[r?.motivo] || r?.mensaje || 'No se pudo completar. Intenta de nuevo.';

/* ---------- inicio ---------- */
async function iniciar() {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { mostrar('p-login'); return; }
    K.uid = user.id;
    try { K.token = localStorage.getItem(claveToken()); } catch (_) { K.token = null; }
    if (K.token && await cargarMenu()) return;
    await pantallaAutorizar();
  } catch (e) { console.error('pedidos:', e); mostrar('p-login'); }
}

async function cargarMenu() {
  const { data, error } = await sb.rpc('kiosko_menu', { p_token: K.token });
  if (error || !data?.ok) { try { localStorage.removeItem(claveToken()); } catch (_) {} K.token = null; return false; }
  K.menu = data;
  document.body.classList.toggle('helado', !!data.heladeria);
  document.title = (data.negocio || 'Menú') + ' · Haz tu pedido';
  document.getElementById('c-neg').textContent = data.negocio || 'Menú';
  const logo = document.getElementById('c-logo');
  logo.innerHTML = data.logo ? `<img src="${esc(data.logo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:14px" onerror="this.parentNode.textContent='${data.heladeria ? '🍦' : '🍽️'}'">` : (data.heladeria ? '🍦' : '🍽️');
  pintarMenu();
  mostrar(null);
  return true;
}

/* ---------- autorizar ---------- */
async function pantallaAutorizar() {
  mostrar('p-autorizar');
  try { const { data } = await sb.rpc('kiosko_es_demo'); K.demo = data === true; } catch (_) { K.demo = false; }
  const admins = await listaAdmins();
  document.getElementById('a-admin-wrap').style.display = K.demo ? 'none' : '';
  document.getElementById('a-admin').innerHTML = admins.length ? admins.map(a => `<option value="${esc(a.id)}">${esc(a.nombre)}</option>`).join('') : '<option value="">No hay administradores con PIN</option>';
  try {
    const { data: mesas } = await sb.from('restaurante_mesas').select('id,numero').eq('auth_user_id', K.uid).eq('activo', true).order('numero');
    const sel = document.getElementById('a-mesa');
    (mesas || []).filter(m => m.numero !== 'Autoservicio').forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = 'Fijo en la mesa ' + m.numero; sel.appendChild(o); });
  } catch (_) {}
  document.getElementById('a-ok').onclick = autorizar;
}
async function listaAdmins() {
  try {
    let { data, error } = await sb.rpc('listar_perfiles_del_grupo_v2');
    if (error) ({ data } = await sb.rpc('listar_perfiles_del_grupo'));
    return (data || []).filter(p => p.tipo === 'admin' && p.activo !== false);
  } catch (_) { return []; }
}
async function autorizar() {
  const b = document.getElementById('a-ok'), err = document.getElementById('a-err'); err.textContent = '';
  const perfil = K.demo ? null : document.getElementById('a-admin').value || null;
  const pin = K.demo ? null : document.getElementById('a-pin').value.trim();
  if (!K.demo && (!perfil || !pin)) { err.textContent = 'Elige el administrador y escribe su PIN.'; return; }
  b.disabled = true; b.textContent = 'Autorizando…';
  try {
    const { data, error } = await sb.rpc('kiosko_autorizar', { p_perfil_id: perfil, p_pin: pin, p_nombre: document.getElementById('a-nombre').value.trim() || null, p_mesa_id: document.getElementById('a-mesa').value || null });
    if (error) throw error;
    if (!data?.ok) { err.textContent = textoMotivo(data); document.getElementById('a-pin').value = ''; return; }
    K.token = data.token; try { localStorage.setItem(claveToken(), K.token); } catch (_) {}
    if (!await cargarMenu()) err.textContent = 'No se pudo abrir el menú.';
  } catch (e) { console.error(e); err.textContent = 'No se pudo conectar. Revisa la señal.'; }
  finally { b.disabled = false; b.textContent = 'Autorizar y abrir pedidos'; }
}

/* ---------- menú ---------- */
function pintarMenu() {
  const prods = K.menu?.productos || [];
  const cats = [...new Set(prods.map(p => p.categoria))];
  const nav = document.getElementById('cats');
  nav.innerHTML = `<button class="cat ${!K.cat ? 'on' : ''}" onclick="elegirCat(null)">Todo</button>` + cats.map(c => `<button class="cat ${K.cat === c ? 'on' : ''}" onclick="elegirCat(${esc(JSON.stringify(c))})">${iconoDe(c)} ${esc(c)}</button>`).join('');
  const main = document.getElementById('menu');
  if (!prods.length) { main.innerHTML = '<div class="vacio">Todavía no hay productos con precio en el menú.</div>'; return; }
  main.innerHTML = cats.filter(c => !K.cat || c === K.cat).map(c => `
    <section class="seccion"><h2>${iconoDe(c)} ${esc(c)}</h2><div class="grid">
      ${prods.filter(p => p.categoria === c).map(p => {
        const en = K.carrito.find(x => x.id === p.id);
        return `<button class="prod" onclick="agregar('${p.id}')" aria-label="Agregar ${esc(p.nombre)}">
          <div class="prod-img">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${iconoDe(c)}'))">` : iconoDe(c)}</div>
          <div class="prod-cuerpo"><div class="prod-nom">${esc(p.nombre)}</div>${p.descripcion ? `<div class="prod-desc">${esc(p.descripcion)}</div>` : ''}
            <div class="prod-pie"><span class="precio">${fmt(p.precio)}</span>${en ? `<span class="badge-cant">${en.cant} en tu pedido</span>` : '<span class="mas" aria-hidden="true">+</span>'}</div></div>
        </button>`; }).join('')}
    </div></section>`).join('');
}
function elegirCat(c) { K.cat = c; pintarMenu(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

/* ---------- carrito ---------- */
function agregar(id) {
  const p = (K.menu?.productos || []).find(x => x.id === id); if (!p) return;
  const en = K.carrito.find(x => x.id === id);
  if (en) { if (en.cant >= 30) return; en.cant++; } else K.carrito.push({ id, nombre: p.nombre, precio: Number(p.precio), cant: 1, nota: '' });
  K.ref = null; actualizar();
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {}
}
function cambiar(id, d) {
  const en = K.carrito.find(x => x.id === id); if (!en) return;
  en.cant += d; if (en.cant <= 0) K.carrito = K.carrito.filter(x => x.id !== id); if (en.cant > 30) en.cant = 30;
  K.ref = null; actualizar(); if (!K.carrito.length) cerrarCarrito(); else pintarLista();
}
function total() { return K.carrito.reduce((a, x) => a + x.cant * x.precio, 0); }
function actualizar() {
  const n = K.carrito.reduce((a, x) => a + x.cant, 0);
  document.getElementById('barra').classList.toggle('oculto', !n);
  document.getElementById('b-cant').textContent = n;
  document.getElementById('b-total').textContent = fmt(total());
  document.getElementById('k-total').textContent = fmt(total());
  pintarMenu();
}
function pintarLista() {
  document.getElementById('lista').innerHTML = K.carrito.map(x => `
    <div class="linea">
      <div class="linea-nom">${esc(x.nombre)}</div><div class="linea-pre">${fmt(x.cant * x.precio)}</div>
      <div class="ctrl"><button onclick="cambiar('${x.id}',-1)" aria-label="Quitar uno">−</button><b>${x.cant}</b><button onclick="cambiar('${x.id}',1)" aria-label="Agregar uno">+</button></div><div></div>
      <input class="nota-inp" maxlength="120" placeholder="Indicación (ej. sabor, sin hielo)" value="${esc(x.nota)}" oninput="notaDe('${x.id}', this.value)">
    </div>`).join('');
  document.getElementById('k-total').textContent = fmt(total());
}
function notaDe(id, v) { const en = K.carrito.find(x => x.id === id); if (en) { en.nota = v; K.ref = null; } }
function abrirCarrito() { if (!K.carrito.length) return; pintarLista(); document.getElementById('k-err').textContent = ''; document.getElementById('velo').classList.remove('oculto'); document.getElementById('panel').classList.remove('oculto'); }
function cerrarCarrito() { document.getElementById('velo').classList.add('oculto'); document.getElementById('panel').classList.add('oculto'); }

/* ---------- enviar ---------- */
async function enviarPedido() {
  if (K.enviando || !K.carrito.length) return;
  const b = document.getElementById('k-ok'), err = document.getElementById('k-err'); err.textContent = '';
  K.enviando = true; b.disabled = true; b.textContent = 'Enviando…';
  if (!K.ref) K.ref = nuevoRef();   // mismo código si se reintenta: el servidor no lo duplica
  try {
    const { data, error } = await sb.rpc('kiosko_pedido', {
      p_token: K.token, p_cliente: document.getElementById('k-nombre').value.trim() || null, p_nota: document.getElementById('k-nota').value.trim() || null,
      p_items: K.carrito.map(x => ({ producto_id: x.id, cantidad: x.cant, nota: x.nota || null })), p_ref: K.ref,
    });
    if (error) throw error;
    if (!data?.ok) {
      err.textContent = textoMotivo(data);
      if (data?.motivo === 'pase') { try { localStorage.removeItem(claveToken()); } catch (_) {} setTimeout(() => location.reload(), 2500); }
      return;
    }
    cerrarCarrito();
    document.getElementById('l-num').textContent = '#' + data.numero;
    document.getElementById('l-txt').textContent = `Ya está en la ${lugar()}. Te llamaremos por tu número.`;
    mostrar('p-listo');
    K.carrito = []; K.ref = null; document.getElementById('k-nombre').value = ''; document.getElementById('k-nota').value = ''; actualizar();
    clearTimeout(K.tListo); K.tListo = setTimeout(nuevoPedido, 12000);
  } catch (e) {
    console.error(e); err.textContent = 'Sin señal. Toca "Enviar pedido" otra vez (no se duplica).';
  } finally { K.enviando = false; b.disabled = false; b.textContent = 'Enviar pedido'; }
}
function nuevoPedido() { clearTimeout(K.tListo); mostrar(null); K.cat = null; pintarMenu(); window.scrollTo({ top: 0 }); }

/* ---------- inactividad: si alguien deja el pedido a medias, se limpia ---------- */
['click', 'touchstart', 'keydown', 'scroll'].forEach(ev => document.addEventListener(ev, () => { K.ultimaActividad = Date.now(); }, { passive: true }));
setInterval(() => {
  if (K.carrito.length && Date.now() - K.ultimaActividad > 120000 && !K.enviando) { K.carrito = []; K.ref = null; cerrarCarrito(); actualizar(); }
}, 15000);

/* ---------- salir (administrador) ---------- */
let toques = 0, tToques;
function tocarEsquina() { toques++; clearTimeout(tToques); tToques = setTimeout(() => { toques = 0; }, 1500); if (toques >= 3 && K.token) { toques = 0; abrirSalir(); } }
async function abrirSalir() {
  mostrar('p-salir');
  document.getElementById('s-err').textContent = ''; document.getElementById('s-pin').value = '';
  document.getElementById('s-admin-wrap').style.display = K.demo ? 'none' : '';
  if (!K.demo) { const admins = await listaAdmins(); document.getElementById('s-admin').innerHTML = admins.map(a => `<option value="${esc(a.id)}">${esc(a.nombre)}</option>`).join(''); }
  document.getElementById('s-ok').onclick = async () => {
    const err = document.getElementById('s-err');
    const { data, error } = await sb.rpc('kiosko_salir', { p_token: K.token, p_perfil_id: K.demo ? null : document.getElementById('s-admin').value || null, p_pin: K.demo ? null : document.getElementById('s-pin').value.trim() });
    if (error || !data?.ok) { err.textContent = error ? 'No se pudo conectar.' : textoMotivo(data); return; }
    try { localStorage.removeItem(claveToken()); } catch (_) {}
    location.href = K.menu?.heladeria ? 'restaurante-comandas.html' : 'restaurante-comandas.html';
  };
}
document.addEventListener('DOMContentLoaded', () => {
  // Demo: saber de antemano si se pide PIN para salir
  sb.rpc('kiosko_es_demo').then(r => { K.demo = r.data === true; }, () => {});
  iniciar();
});
