# Copia las páginas reales del sistema (sin scripts ni conexión a Supabase) a site/
# para grabarlas dentro de la laptop y el celular del video.
import re, shutil, os
ROOT = os.path.join(os.path.dirname(__file__), '..')
SITE = os.path.join(os.path.dirname(__file__), 'site')
for name in ['dashboard', 'configuracion', 'auditoria', 'productos', 'sucursales', 'login']:
    s = open(os.path.join(ROOT, name + '.html'), encoding='utf-8').read()
    s = re.sub(r'<script\b[^>]*>.*?</script>', '', s, flags=re.S)
    s = re.sub(r'https://fonts.googleapis.com/css2\?[^"\']*', 'fonts/fonts.css', s)
    s = s.replace('<div id="app" style="display:none">', '<div id="app">')
    s = s.replace('</head>', '<style>#loader{display:none!important}</style><link rel="stylesheet" href="mock.css"></head>', 1)
    s = s.replace('</body>', '<script src="mock.js"></script></body>')
    open(os.path.join(SITE, name + '.html'), 'w', encoding='utf-8').write(s)
for f in ['perfiles-guard.css', 'movil-sin-zoom.css', 'productos.css', 'negocio360-isotipo.png']:
    shutil.copy(os.path.join(ROOT, f), SITE)
shutil.copy(os.path.join(SITE, 'negocio360-isotipo.png'), os.path.join(SITE, 'iso.png'))
for f in ['piece0.png', 'piece1.png', 'piece2.png', 'piece3.png', 'wordmark_dark.png']:
    shutil.copy(os.path.join(ROOT, 'video-presentacion', f), SITE)
