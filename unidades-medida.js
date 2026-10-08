/* ============================================================
   UNIDADES DE MEDIDA — catálogo compartido (Negocio360)
   Unidades del sistema + las que cada negocio crea (tabla
   unidades_medida). Solo describe unidades; nunca toca montos.
   ============================================================ */
(function () {
  const TIPOS = {
    conteo:   'Por conteo',
    peso:     'Por peso',
    volumen:  'Por volumen',
    longitud: 'Por longitud',
  };

  // codigo, nombre (singular), plural, abreviatura, tipo, fraccionable
  const SISTEMA = [
    ['unidad',    'Unidad',     'Unidades',   'u',     'conteo',   false],
    ['docena',    'Docena',     'Docenas',    'doc',   'conteo',   false],
    ['par',       'Par',        'Pares',      'par',   'conteo',   false],
    ['caja',      'Caja',       'Cajas',      'caja',  'conteo',   false],
    ['paquete',   'Paquete',    'Paquetes',   'paq',   'conteo',   false],
    ['bolsa',     'Bolsa',      'Bolsas',     'bolsa', 'conteo',   false],
    ['saco',      'Saco',       'Sacos',      'saco',  'conteo',   false],
    ['bulto',     'Bulto',      'Bultos',     'bulto', 'conteo',   false],
    ['frasco',    'Frasco',     'Frascos',    'frasco','conteo',   false],
    ['tableta',   'Tableta',    'Tabletas',   'tab',   'conteo',   false],
    ['libra',     'Libra',      'Libras',     'lb',    'peso',     true],
    ['onza',      'Onza',       'Onzas',      'oz',    'peso',     true],
    ['kilogramo', 'Kilogramo',  'Kilogramos', 'kg',    'peso',     true],
    ['gramo',     'Gramo',      'Gramos',     'g',     'peso',     true],
    ['quintal',   'Quintal',    'Quintales',  'qq',    'peso',     true],
    ['tonelada',  'Tonelada',   'Toneladas',  't',     'peso',     true],
    ['litro',     'Litro',      'Litros',     'L',     'volumen',  true],
    ['mililitro', 'Mililitro',  'Mililitros', 'ml',    'volumen',  true],
    ['galon',     'Galón',      'Galones',    'gal',   'volumen',  true],
    ['metro',     'Metro',      'Metros',     'm',     'longitud', true],
    ['centimetro','Centímetro', 'Centímetros','cm',    'longitud', true],
    ['pulgada',   'Pulgada',    'Pulgadas',   'pulg',  'longitud', true],
    ['pie',       'Pie',        'Pies',       'pie',   'longitud', true],
    ['vara',      'Vara',       'Varas',      'vara',  'longitud', true],
    ['yarda',     'Yarda',      'Yardas',     'yd',    'longitud', true],
  ].map(([codigo, nombre, plural, abreviatura, tipo, fraccionable]) =>
    ({ codigo, nombre, plural, abreviatura, tipo, fraccionable, sistema: true }));

  let personalizadas = [];

  const norm = s => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const api = {
    TIPOS,
    sistema: () => SISTEMA.slice(),
    personalizadas: () => personalizadas.slice(),
    todas: () => SISTEMA.concat(personalizadas),

    porCodigo(codigo) {
      if (!codigo) return null;
      return api.todas().find(u => u.codigo === codigo) || null;
    },

    // Texto antiguo (campo libre) -> unidad del catálogo, si coincide
    // por nombre, plural o abreviatura. Devuelve null si no hay match.
    porTexto(texto) {
      const t = norm(texto);
      if (!t) return null;
      return api.todas().find(u =>
        norm(u.nombre) === t || norm(u.plural) === t || norm(u.abreviatura) === t) || null;
    },

    // Carga las unidades propias del negocio (silencioso si falla).
    async cargarPersonalizadas(sb, userId) {
      try {
        const { data, error } = await sb.from('unidades_medida')
          .select('codigo,nombre,abreviatura,tipo,fraccionable,activo')
          .eq('auth_user_id', userId).eq('activo', true).order('nombre');
        if (error) throw error;
        personalizadas = (data || []).map(u => ({
          codigo: u.codigo, nombre: u.nombre, plural: u.nombre, abreviatura: u.abreviatura,
          tipo: u.tipo, fraccionable: !!u.fraccionable, sistema: false,
        }));
      } catch (e) {
        console.warn('unidades-medida: no se pudieron cargar las propias', e);
        personalizadas = [];
      }
      return personalizadas;
    },

    // Crea una unidad propia. Devuelve la unidad o lanza un Error con mensaje claro.
    async crearPersonalizada(sb, userId, { nombre, abreviatura, tipo, fraccionable }) {
      nombre = String(nombre || '').trim();
      abreviatura = String(abreviatura || '').trim();
      if (!nombre) throw new Error('Escribe el nombre de la unidad.');
      if (!abreviatura) throw new Error('Escribe la abreviatura (ej: lb, kg, m).');
      if (!TIPOS[tipo]) tipo = 'conteo';
      const yaExiste = api.todas().find(u => norm(u.nombre) === norm(nombre) || norm(u.abreviatura) === norm(abreviatura));
      if (yaExiste) throw new Error(`Ya existe "${yaExiste.nombre} (${yaExiste.abreviatura})".`);
      const codigo = 'x_' + norm(nombre).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
      const { error } = await sb.from('unidades_medida').insert({
        auth_user_id: userId, codigo, nombre, abreviatura, tipo, fraccionable: !!fraccionable,
      });
      if (error) throw new Error('No se pudo guardar la unidad. Intenta de nuevo.');
      await api.cargarPersonalizadas(sb, userId);
      return api.porCodigo(codigo);
    },

    // "1.5 lb", "2 u" -- para mostrar cantidades con su unidad.
    formatearCantidad(cantidad, codigo, textoLibre) {
      const n = Number(cantidad) || 0;
      const txt = n.toLocaleString('es-NI', { maximumFractionDigits: 3 });
      const u = api.porCodigo(codigo);
      const ab = u ? u.abreviatura : (textoLibre || '');
      return ab ? `${txt} ${ab}` : txt;
    },
  };

  window.N360Unidades = api;
})();
