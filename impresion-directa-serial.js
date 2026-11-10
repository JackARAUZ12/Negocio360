/* =====================================================================
   IMPRESION-DIRECTA-SERIAL.JS — Negocio360 (10-nov-2026)
   ---------------------------------------------------------------------
   Imprime DIRECTO en una impresora térmica (58/80 mm) conectada a la
   COMPUTADORA por Bluetooth o USB, sin driver y sin PDF:
     - Windows crea un puerto "COM" al emparejar la impresora Bluetooth.
     - Chrome / Edge pueden escribir en ese puerto (Web Serial).
     - Se mandan comandos ESC/POS: la impresora dibuja el código de barras
       ella misma (sale nítido y se escanea fácil).
   La primera vez el navegador pregunta cuál puerto es la impresora; luego
   lo recuerda.

   CANDADOS
     - Solo imprime: no lee ni guarda nada en la base de datos.
     - Un trabajo a la vez; si algo falla, el puerto se cierra siempre.
     - Texto limpio (sin tildes raras) para que la impresora no imprima basura.
   ===================================================================== */
(function () {
  const ESC = 0x1B, GS = 0x1D;

  const disponible = () => typeof navigator !== 'undefined' && !!navigator.serial;

  // Quita tildes y caracteres que las impresoras baratas no entienden.
  function textoPlano(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
      .replace(/[^\x20-\x7E]/g, '?');
  }
  const bytesDe = (s) => Array.from(textoPlano(s), ch => ch.charCodeAt(0));

  // Parte el nombre en renglones del ancho del papel (máx. 2).
  function renglones(txt, cols) {
    const pal = textoPlano(txt).split(/\s+/).filter(Boolean);
    const out = []; let ln = '';
    pal.forEach(w => {
      if (!ln) ln = w.slice(0, cols);
      else if ((ln + ' ' + w).length <= cols) ln += ' ' + w;
      else { out.push(ln); ln = w.slice(0, cols); }
    });
    if (ln) out.push(ln);
    return out.slice(0, 2);
  }

  // Datos CODE128 para GS k 73: set C (más compacto) si son solo dígitos
  // en cantidad par; si no, set B.
  function datosCode128(codigo) {
    const c = textoPlano(codigo);
    if (/^\d+$/.test(c) && c.length % 2 === 0 && c.length >= 4) {
      const d = [0x7B, 0x43]; // {C
      for (let i = 0; i < c.length; i += 2) d.push(parseInt(c.slice(i, i + 2), 10));
      return { datos: d, modulos: (c.length / 2 + 3) * 11 + 2 };
    }
    return { datos: [0x7B, 0x42].concat(bytesDe(c)), modulos: (c.length + 3) * 11 + 2 };
  }

  /**
   * Arma los bytes ESC/POS de N etiquetas.
   * opts: { nombre, codigo, copias, puntos (384 = 58 mm, 576 = 80 mm), alto (0-255) }
   */
  function bytesEtiquetas(opts) {
    const puntos = opts.puntos || 384;
    const cols = puntos >= 576 ? 48 : 32;
    const copias = Math.max(1, Math.min(200, parseInt(opts.copias, 10) || 1));
    const { datos, modulos } = datosCode128(opts.codigo);
    // Ancho de barra: el mayor que quepa en el papel (si no cabe, la impresora no imprime nada).
    let ancho = 3;
    while (ancho > 1 && modulos * ancho > puntos - 16) ancho--;
    if (modulos * ancho > puntos) throw new Error('El código es demasiado largo para este papel.');
    const alto = Math.max(40, Math.min(160, opts.alto || 80));

    const b = [ESC, 0x40]; // reiniciar
    for (let n = 0; n < copias; n++) {
      b.push(ESC, 0x61, 1);                 // centrado
      b.push(ESC, 0x45, 1);                 // negrita
      renglones(opts.nombre, cols).forEach(r => { b.push(...bytesDe(r), 0x0A); });
      b.push(ESC, 0x45, 0);
      b.push(GS, 0x48, 2);                  // número debajo del código
      b.push(GS, 0x66, 0);                  // letra normal para el número
      b.push(GS, 0x77, ancho);              // ancho de barra
      b.push(GS, 0x68, alto);               // alto de barra
      b.push(GS, 0x6B, 73, datos.length, ...datos);
      b.push(0x0A, ESC, 0x64, 3);           // avanzar 3 renglones (espacio para cortar)
    }
    b.push(ESC, 0x61, 0);
    return new Uint8Array(b);
  }

  let ocupado = false;

  async function elegirPuerto(forzarNuevo) {
    if (!forzarNuevo) {
      const ya = await navigator.serial.getPorts();
      if (ya && ya.length) return ya[ya.length - 1];
    }
    return navigator.serial.requestPort(); // el navegador muestra la lista de puertos
  }

  /** Envía bytes a la impresora. Devuelve { ok, motivo }. */
  async function imprimir(bytes, { cambiarImpresora = false } = {}) {
    if (!disponible()) return { ok: false, motivo: 'navegador' };
    if (ocupado) return { ok: false, motivo: 'ocupado' };
    ocupado = true;
    let puerto = null, escritor = null;
    try {
      try { puerto = await elegirPuerto(cambiarImpresora); }
      catch (e) { return { ok: false, motivo: 'cancelado' }; }
      try { await puerto.open({ baudRate: 9600 }); }
      catch (e) {
        // Puede que ya estuviera abierto por un intento anterior.
        if (!/already open/i.test(String(e && e.message))) return { ok: false, motivo: 'abrir', detalle: String(e && e.message || e) };
      }
      escritor = puerto.writable.getWriter();
      for (let i = 0; i < bytes.length; i += 512) {
        await escritor.write(bytes.slice(i, i + 512));
        await new Promise(r => setTimeout(r, 30)); // la impresora Bluetooth necesita respirar
      }
      await new Promise(r => setTimeout(r, Math.min(3000, 300 + bytes.length / 10)));
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: 'escribir', detalle: String(e && e.message || e) };
    } finally {
      try { if (escritor) escritor.releaseLock(); } catch (_) {}
      try { if (puerto) await puerto.close(); } catch (_) {}
      ocupado = false;
    }
  }

  const MOTIVOS = {
    navegador: 'Este navegador no puede imprimir directo. Use Google Chrome o Microsoft Edge en la computadora.',
    ocupado: 'Ya se está imprimiendo, espere un momento.',
    cancelado: 'No se eligió la impresora.',
    abrir: 'No se pudo conectar con la impresora. Revise que esté encendida, emparejada por Bluetooth y que eligió el puerto correcto (pruebe "Elegir otra impresora").',
    escribir: 'Se perdió la conexión mientras imprimía. Revise que la impresora esté encendida y cerca.',
  };

  window.N360ImpresionSerial = { disponible, bytesEtiquetas, imprimir, MOTIVOS };
})();
