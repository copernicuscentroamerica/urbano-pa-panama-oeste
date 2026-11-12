/***************************************************************
PROYECTO: Monitoreo multitemporal de expansión urbana - Panamá Oeste
ENTORNO: Google Earth Engine Code Editor (JavaScript)
VERSIÓN: PMV 1.0
IMPORTANTE:
1) Suba los tres KML como TABLE assets en GEE.
2) Reemplace los tres IDs de asset de ejemplo.
3) Este flujo genera indicadores y candidatos preliminares, NO certifica informalidad.
4) Las bandas SWIR (B11) son 20 m. No se debe afirmar resolución de 10 m para NDBI.
****************************************************************/

// ---------- 0. CONFIGURACIÓN DEL USUARIO ----------
var ASSET_AREA1 = 'users/USUARIO/Area_de_Proyecto_1';
var ASSET_CRECIMIENTO = 'users/USUARIO/Crecimiento_Informal';
var ASSET_INVASION = 'users/USUARIO/Zona_de_Invasion';

// Periodos comparables: enero-abril (estación relativamente seca).
// Cambie el intervalo si la institución define otra temporada.
var PERIODOS = [
  {nombre: '2016_10_anios', inicio: '2016-01-01', fin: '2016-05-01'},
  {nombre: '2021_5_anios',  inicio: '2021-01-01', fin: '2021-05-01'},
  {nombre: '2024_2_anios',  inicio: '2024-01-01', fin: '2024-05-01'},
  {nombre: '2026_reciente', inicio: '2026-01-01', fin: '2026-05-01'}
];

var ESCALA_RGB = 10;
var ESCALA_INDICES = 20; // NDBI usa B11 (20 m); usar escala 20 m para comparabilidad.
var CARPETA_DRIVE = 'GEE_Panama_Oeste_Copernicus';

// ---------- 1. CARGA DE ÁREAS ----------
var area1 = ee.FeatureCollection(ASSET_AREA1);
var crecimiento = ee.FeatureCollection(ASSET_CRECIMIENTO);
var invasion = ee.FeatureCollection(ASSET_INVASION);

Map.centerObject(area1, 14);
Map.addLayer(area1, {color: '00FFFF'}, 'Área de Proyecto 1', true);
Map.addLayer(crecimiento, {color: 'FFFF00'}, 'Crecimiento Informal', true);
Map.addLayer(invasion, {color: 'FF00FF'}, 'Zona de Invasión', true);

var areas = [
  {nombre: 'Area_Proyecto_1', fc: area1},
  {nombre: 'Crecimiento_Informal', fc: crecimiento},
  {nombre: 'Zona_Invasion', fc: invasion}
];

// ---------- 2. SENTINEL-2: MÁSCARA Y COMPOSICIÓN ----------
function prepararS2(img) {
  var scl = img.select('SCL');
  // Excluir saturación/no datos, sombras, nubes medias/altas, cirros y nieve.
  var mascara = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  var reflectancia = img.select(['B2','B3','B4','B8','B11','B12'])
    .multiply(0.0001);
  return reflectancia.updateMask(mascara)
    .copyProperties(img, ['system:time_start','CLOUDY_PIXEL_PERCENTAGE']);
}

function compuestoS2(roi, periodo) {
  var coleccion = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate(periodo.inicio, periodo.fin)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 90))
    .map(prepararS2);

  print('Sentinel-2 escenas ' + periodo.nombre, coleccion.size());
  var mediana = coleccion.median().clip(roi);
  var ndvi = mediana.normalizedDifference(['B8','B4']).rename('NDVI');
  var ndbi = mediana.normalizedDifference(['B11','B8']).rename('NDBI');

  return mediana.addBands(ndvi).addBands(ndbi)
    .set('periodo', periodo.nombre)
    .set('inicio', periodo.inicio)
    .set('fin', periodo.fin)
    .set('numero_escenas', coleccion.size());
}

// ---------- 3. SENTINEL-1 SAR: COMPLEMENTO PARA NUBOSIDAD ----------
function compuestoS1(roi, periodo) {
  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(roi)
    .filterDate(periodo.inicio, periodo.fin)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV','VH']);

  print('Sentinel-1 escenas ' + periodo.nombre, s1.size());
  // Sentinel-1 GRD de GEE está expresado en dB.
  return s1.median().clip(roi).rename(['VV_dB','VH_dB'])
    .set('periodo', periodo.nombre);
}

// ---------- 4. PROCESAR CADA POLÍGONO ----------
areas.forEach(function(area) {
  var roi = area.fc.geometry();
  var productosS2 = [];
  var productosS1 = [];

  PERIODOS.forEach(function(p) {
    var s2 = compuestoS2(roi, p);
    var s1 = compuestoS1(roi, p);
    productosS2.push(s2);
    productosS1.push(s1);

    Map.addLayer(s2, {bands:['B4','B3','B2'], min:0.02, max:0.25, gamma:1.15},
      area.nombre + ' RGB ' + p.nombre, false);
    Map.addLayer(s2, {bands:['B8','B4','B3'], min:0.02, max:0.35, gamma:1.1},
      area.nombre + ' Falso color ' + p.nombre, false);
    Map.addLayer(s2.select('NDVI'), {min:-0.2,max:0.8,palette:['8c510a','f6e8c3','01665e']},
      area.nombre + ' NDVI ' + p.nombre, false);
    Map.addLayer(s2.select('NDBI'), {min:-0.5,max:0.5,palette:['2166ac','f7f7f7','b2182b']},
      area.nombre + ' NDBI ' + p.nombre, false);
    Map.addLayer(s1.select('VV_dB'), {min:-20,max:0},
      area.nombre + ' Sentinel-1 VV ' + p.nombre, false);

    // Exportación de compuestos. NDBI/NDVI se exportan a 20 m para no
    // sobreinterpretar la banda SWIR de 20 m usada en NDBI.
    Export.image.toDrive({
      image: s2.select(['B4','B3','B2','B8']),
      description: area.nombre + '_RGB_NIR_' + p.nombre,
      folder: CARPETA_DRIVE, fileNamePrefix: area.nombre + '_S2_' + p.nombre,
      region: roi, scale: ESCALA_RGB, maxPixels: 1e13
    });
    Export.image.toDrive({
      image: s2.select(['NDVI','NDBI']),
      description: area.nombre + '_Indices_' + p.nombre,
      folder: CARPETA_DRIVE, fileNamePrefix: area.nombre + '_Indices_' + p.nombre,
      region: roi, scale: ESCALA_INDICES, maxPixels: 1e13
    });
    Export.image.toDrive({
      image: s1,
      description: area.nombre + '_SAR_' + p.nombre,
      folder: CARPETA_DRIVE, fileNamePrefix: area.nombre + '_S1_' + p.nombre,
      region: roi, scale: 10, maxPixels: 1e13
    });
  });

  // ---------- 5. CAMBIO MULTITEMPORAL ----------
  var baseS2 = ee.Image(productosS2[0]);
  var actualS2 = ee.Image(productosS2[3]);
  var baseS1 = ee.Image(productosS1[0]);
  var actualS1 = ee.Image(productosS1[3]);

  var dNDVI = actualS2.select('NDVI').subtract(baseS2.select('NDVI')).rename('dNDVI_2016_2026');
  var dNDBI = actualS2.select('NDBI').subtract(baseS2.select('NDBI')).rename('dNDBI_2016_2026');
  var dVV = actualS1.select('VV_dB').subtract(baseS1.select('VV_dB')).rename('dVV_dB_2016_2026');

  // Umbrales iniciales demostrativos. CALIBRAR con muestras locales.
  // Condición: aumento de NDBI + descenso de NDVI. SAR se conserva como
  // evidencia adicional; no se impone como requisito por su variabilidad.
  var candidato = dNDBI.gt(0.08)
    .and(dNDVI.lt(-0.10))
    .rename('candidato_cambio')
    .selfMask();

  // Intensidad relativa (no temperatura física): combinación normalizada
  // de cambio urbano y pérdida de vegetación.
  var intensidad = dNDBI.max(0).add(dNDVI.multiply(-1).max(0))
    .rename('intensidad_relativa_cambio');

  // Suavizado focal para representar concentración tipo "huella de calor".
  var huella = intensidad.focal_mean({radius: 30, units: 'meters'})
    .rename('huella_calor_cambio');

  Map.addLayer(dNDVI, {min:-0.4,max:0.4,palette:['a50026','ffffbf','006837']},
    area.nombre + ' Cambio NDVI 2016-2026', false);
  Map.addLayer(dNDBI, {min:-0.3,max:0.3,palette:['2166ac','f7f7f7','b2182b']},
    area.nombre + ' Cambio NDBI 2016-2026', false);
  Map.addLayer(candidato, {palette:['ff0000']},
    area.nombre + ' Candidatos preliminares', true);
  Map.addLayer(huella, {min:0,max:0.35,palette:['ffffcc','fd8d3c','800026']},
    area.nombre + ' Huella de calor (cambio relativo)', false);

  var salida = ee.Image.cat([dNDVI,dNDBI,dVV,candidato.unmask(0),huella]).clip(roi);
  Export.image.toDrive({
    image: salida,
    description: area.nombre + '_Cambios_2016_2026',
    folder: CARPETA_DRIVE,
    fileNamePrefix: area.nombre + '_Cambios_2016_2026',
    region: roi, scale: ESCALA_INDICES, maxPixels: 1e13
  });

  // Vectorización de candidatos. El filtro de área elimina pequeños parches
  // de ruido; ajustar según escala y validación local.
  var vectores = candidato.reduceToVectors({
    geometry: roi, scale: ESCALA_INDICES, geometryType: 'polygon',
    eightConnected: true, labelProperty: 'candidato',
    reducer: ee.Reducer.countEvery(), maxPixels: 1e13
  }).map(function(f) {
    return f.set({
      area_m2: f.geometry().area(1),
      area_ha: f.geometry().area(1).divide(10000),
      area_piloto: area.nombre,
      periodo_base: '2016_enero_abril',
      periodo_actual: '2026_enero_abril',
      regla: 'dNDBI>0.08 AND dNDVI<-0.10',
      estado: 'PENDIENTE_VALIDACION'
    });
  }).filter(ee.Filter.gte('area_ha', 0.05));

  Export.table.toDrive({
    collection: vectores,
    description: area.nombre + '_Poligonos_Candidatos',
    folder: CARPETA_DRIVE,
    fileNamePrefix: area.nombre + '_Poligonos_Candidatos',
    fileFormat: 'GeoJSON'
  });
  print('Polígonos candidatos ' + area.nombre, vectores.limit(10));
});

print('PMV preparado. Revise Tasks y ejecute exportaciones manualmente.');
