/**
 * c360-core.js
 * ---------------------------------------------------------------
 * Logica COMPARTIDA entre las plantillas publicas de Catalogo360
 * (c360.html, c360-vibrante.html, c360-navidad.html).
 *
 * IMPORTANTE: este archivo NO toca el DOM ni conoce los prefijos de
 * id de ninguna plantilla (c-, v-, n-). Cada plantilla sigue siendo
 * responsable de su propio HTML/CSS y de como pinta los datos --
 * este archivo solo centraliza la parte que YA era identica en las
 * 3: conectarse a Supabase, traer el catalogo real, y el algoritmo
 * de busqueda/filtro/orden de productos.
 *
 * Si se corrige un bug aqui, se corrige en las 3 plantillas a la
 * vez. Si se agrega una 4ta plantilla, solo necesita incluir este
 * script y llamar a estas funciones -- no reinventar la conexion a
 * la base de datos otra vez.
 * ---------------------------------------------------------------
 */

const C360_SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const C360_SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

/** Crea el cliente real de Supabase. Identico en las 3 plantillas. */
function c360CrearCliente() {
  return window.supabase.createClient(C360_SUPABASE_URL, C360_SUPABASE_KEY);
}

/** Escapa HTML de forma segura -- identico en las 3 plantillas. */
function c360Esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/** Formatea moneda en cordobas -- identico en las 3 plantillas. */
function c360FmtC(n) {
  return 'C$' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Arma el enlace de WhatsApp con mensaje precargado. */
function c360LinkWA(numero, texto) {
  const limpio = (numero || '').replace(/[^\d]/g, '');
  return `https://wa.me/${limpio}?text=${encodeURIComponent(texto)}`;
}

/** Convierte un color hex a "r,g,b" para usar en rgba(). Con respaldo seguro. */
function c360HexARgb(hex, respaldo) {
  const limpio = (hex || respaldo || '#6366f1').replace('#', '');
  const bigint = parseInt(limpio.length === 3 ? limpio.split('').map(c => c + c).join('') : limpio, 16);
  if (isNaN(bigint)) return respaldo ? c360HexARgb(respaldo) : '99,102,241';
  return `${(bigint >> 16) & 255},${(bigint >> 8) & 255},${bigint & 255}`;
}

/**
 * Trae el catalogo publico completo (catalogo + productos activos +
 * categorias) desde Supabase -- exactamente la misma secuencia de
 * consultas que antes vivia triplicada en cada plantilla.
 *
 * @param {object} p
 * @param {object} p.sb - cliente de Supabase ya creado (c360CrearCliente())
 * @param {string|null} p.slug - slug publico del catalogo (?c=slug)
 * @param {string|null} p.idPreview - id del catalogo en modo vista previa (?preview=id)
 * @returns {Promise<{catalogo:object|null, productos:object[], categorias:object[], error:string|null}>}
 */
async function c360CargarCatalogoPublico({ sb, slug, idPreview }) {
  if (!slug && !idPreview) return { catalogo: null, productos: [], categorias: [], error: 'Enlace de catálogo no válido.' };

  let catalogo, error;
  if (idPreview) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) return { catalogo: null, productos: [], categorias: [], error: 'Inicia sesión en Negocio360 para ver la vista previa.', requierePreviewSesion: true };
    ({ data: catalogo, error } = await sb.from('catalogos').select('*').eq('id', idPreview).maybeSingle());
  } else {
    ({ data: catalogo, error } = await sb.from('catalogos').select('*').eq('slug_publico', slug).eq('estado', 'publicado').maybeSingle());
  }
  if (error || !catalogo) return { catalogo: null, productos: [], categorias: [], error: 'Este catálogo no existe o ya no está disponible.' };

  const { data: productosRaw } = await sb.from('catalogo_productos').select('*, catalogo_producto_fotos(*)')
    .eq('catalogo_id', catalogo.id).eq('activo', true).order('orden');
  const productos = (productosRaw || []).map(p => ({ ...p, fotos: (p.catalogo_producto_fotos || []).sort((a, b) => a.orden - b.orden) }));

  const { data: categorias } = await sb.from('catalogo_categorias').select('*').eq('catalogo_id', catalogo.id).order('orden');

  return { catalogo, productos, categorias: categorias || [], error: null };
}

/** Registra un evento real de analitica (visita, click, vista de producto). Nunca lanza error visible. */
function c360RegistrarEvento(sb, catalogoId, tipo, productoId, esPreview) {
  if (!catalogoId || esPreview) return;
  sb.rpc('catalogo_registrar_evento', { p_catalogo_id: catalogoId, p_tipo_evento: tipo, p_producto_id: productoId || null }).then(() => {}).catch(() => {});
}

/**
 * Filtra y ordena la lista de productos -- el mismo algoritmo que
 * antes vivia triplicado (busqueda, categoria, favoritos, ofertas,
 * precio maximo, y las 4 formas de orden).
 *
 * @param {object[]} productos - PRODUCTOS completo
 * @param {object} opciones
 * @param {string|null} opciones.categoriaId
 * @param {boolean} opciones.soloFavoritos
 * @param {string[]} opciones.favoritos
 * @param {boolean} opciones.soloOfertas
 * @param {string} opciones.textoBusqueda (ya en minusculas)
 * @param {number|null} opciones.precioMax
 * @param {string} opciones.orden - 'reciente' | 'precio_asc' | 'precio_desc' | 'nombre'
 * @returns {object[]}
 */
function c360FiltrarYOrdenar(productos, opciones = {}) {
  const { categoriaId = null, soloFavoritos = false, favoritos = [], soloOfertas = false, textoBusqueda = '', precioMax = null, orden = 'reciente' } = opciones;
  const precioReal = p => (p.etiqueta === 'oferta' && p.precio_oferta) ? p.precio_oferta : p.precio;

  let lista = categoriaId ? productos.filter(p => p.categoria_id === categoriaId) : productos.slice();
  if (soloFavoritos) lista = lista.filter(p => favoritos.includes(p.id));
  if (soloOfertas) lista = lista.filter(p => p.etiqueta === 'oferta' && p.precio_oferta);
  if (textoBusqueda) lista = lista.filter(p => p.nombre.toLowerCase().includes(textoBusqueda));
  if (precioMax != null) lista = lista.filter(p => precioReal(p) <= precioMax);

  if (orden === 'precio_asc') lista.sort((a, b) => precioReal(a) - precioReal(b));
  else if (orden === 'precio_desc') lista.sort((a, b) => precioReal(b) - precioReal(a));
  else if (orden === 'nombre') lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
  else lista.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return lista;
}

/** Calcula el precio maximo real entre los productos (para configurar el slider de precio). */
function c360PrecioMaximoReal(productos) {
  if (!productos.length) return 0;
  const precioReal = p => (p.etiqueta === 'oferta' && p.precio_oferta) ? p.precio_oferta : p.precio;
  return Math.ceil(Math.max(...productos.map(precioReal)));
}

/** Arma los datos estructurados JSON-LD (Schema.org Store) para SEO -- identico en las 3 plantillas, con campos opcionales extra si el catalogo los tiene. */
function c360DatosEstructurados(catalogo, productos) {
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    "name": catalogo.nombre_comercial || catalogo.nombre,
    "description": catalogo.descripcion || undefined,
    "telephone": catalogo.telefono || undefined,
    "image": catalogo.logo_url || undefined,
    "makesOffer": productos.slice(0, 30).map(p => ({
      "@type": "Offer",
      "itemOffered": { "@type": "Product", "name": p.nombre, "image": (p.fotos.find(f => f.es_principal) || p.fotos[0])?.url || undefined },
      "price": String((p.etiqueta === 'oferta' && p.precio_oferta) ? p.precio_oferta : p.precio),
      "priceCurrency": "NIO",
      "availability": p.etiqueta === 'agotado' ? "https://schema.org/OutOfStock" : "https://schema.org/InStock"
    }))
  };
}

/** Inserta (o reemplaza) el script JSON-LD en el <head>. */
function c360InsertarJSONLD(idScript, catalogo, productos) {
  const existente = document.getElementById(idScript);
  if (existente) existente.remove();
  const script = document.createElement('script');
  script.id = idScript;
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(c360DatosEstructurados(catalogo, productos));
  document.head.appendChild(script);
}

/**
 * Favoritos y vistos recientemente, con localStorage con prefijo
 * propio por plantilla (para no mezclar datos entre plantillas
 * distintas del mismo catalogo -- comportamiento identico al que ya
 * existia, solo centralizado).
 */
function c360CrearAlmacenLocal(prefijo) {
  const leer = (clave) => { try { return JSON.parse(localStorage.getItem(`${prefijo}_${clave}`) || '[]'); } catch (e) { return []; } };
  const guardar = (clave, valor) => localStorage.setItem(`${prefijo}_${clave}`, JSON.stringify(valor));
  return {
    obtenerFavoritos: () => leer('favoritos'),
    guardarFavoritos: (arr) => guardar('favoritos', arr),
    obtenerVistos: () => leer('vistos'),
    guardarVistos: (arr) => guardar('vistos', arr),
    obtenerTema: (respaldo) => localStorage.getItem(`${prefijo}_tema`) || respaldo || 'claro',
    guardarTema: (tema) => localStorage.setItem(`${prefijo}_tema`, tema),
  };
}
