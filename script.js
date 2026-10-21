'use strict';

const DATA = {
  main: 'data/rm08_infraestructura.json',
  turnos: 'data/catalogo_cct_turnos.json',
  conteoInmuebles: 'data/inmuebles_conteo.json?v=20261005-inmuebles-2769',
  detalleObra: 'data/detalle_obra_2025.json?v=20261005-actas-2025',
  supports: 'data/apoyos_detallados.json',
  alcaldias: 'data/alcaldias.json',
  subsidencias: 'data/subsidencias.json',
  fracturamiento: 'data/fracturamiento.json'
};

document.head.insertAdjacentHTML('beforeend', `<style id="support-detail-styles">
.support-detail-list{display:grid;gap:9px}.support-detail{padding:11px;border:1px solid #a7d8c9;border-left:4px solid #0f766e;border-radius:9px;background:#f7fffc}.support-detail-head{display:grid;grid-template-columns:26px 1fr;gap:9px;align-items:start}.support-check{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#0f766e;color:#fff;font-size:14px;font-weight:900;line-height:1}.support-detail-head small{display:block;color:#64748b;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.support-detail-head strong{display:block;margin-top:2px;color:#134e4a;font-size:12px;line-height:1.35}.support-detail-head em{display:block;margin-top:3px;color:#52677a;font-size:10px;font-style:normal;line-height:1.4}.support-detail>p{margin:9px 0 0 32px!important;color:#64748b;font-size:11px!important;line-height:1.45!important}.support-work-list{display:grid;gap:6px;margin:10px 0 0 32px;padding:0;list-style:none}.support-work-list li{display:grid;grid-template-columns:19px 1fr;gap:7px;align-items:start;padding:7px 8px;border:1px solid #d1fae5;border-radius:7px;background:#fff}.support-work-list li span{display:grid;place-items:center;width:18px;height:18px;border-radius:4px;background:#d1fae5;color:#047857;font-size:11px;font-weight:900}.support-work-list li strong{color:#334155;font-size:11px;line-height:1.4}@media(max-width:600px){.support-work-list,.support-detail>p{margin-left:0!important}}
</style>`);

const q = id => document.getElementById(id);
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const formatNumber = value => Number(value || 0).toLocaleString('es-MX');
const isMapped = item => Number.isFinite(item.lat) && Number.isFinite(item.lon);

let dataset;
let detalleObraPorCct = {};
let programMap = new Map();
let maintenanceMap = new Map();
let cctRecordMap = new Map();
let turnCatalogMap = new Map();
let currentItems = [];
let currentCcts = [];
let markersLayer;
let subsidyLayer;
let fractureLayer;
let alcaldiasLayer;
let hasFitResult = false;

const EXCLUDED_LEVEL_FILTERS = new Set(['Baja', 'Capacitación', 'CAPEP', 'Especial - otro', 'Para adultos']);

const map = L.map('map', {zoomControl:false, preferCanvas:true, minZoom:9}).setView([19.35, -99.13], 10);
L.control.zoom({position:'topright'}).addTo(map);

const lightBasemapPane = map.createPane('infraBasemapLight');
lightBasemapPane.style.zIndex = '200';
const darkBasemapPane = map.createPane('infraBasemapDark');
darkBasemapPane.style.zIndex = '200';
darkBasemapPane.style.filter = 'brightness(.62) contrast(1.3) saturate(.55) hue-rotate(180deg) invert(1)';
const esriBasemapUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const esriAttribution = 'Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), NOSTRA, &copy; OpenStreetMap contributors, and the GIS User Community';
const baseLayers = {
  'Claro': L.tileLayer(esriBasemapUrl, {
    maxZoom: 20, attribution: esriAttribution, pane: 'infraBasemapLight'
  }),
  'Oscuro': L.tileLayer(esriBasemapUrl, {
    maxZoom: 20, attribution: esriAttribution, pane: 'infraBasemapDark'
  })
};
baseLayers.Claro.addTo(map);
L.control.layers(baseLayers, {}, {collapsed:true, position:'bottomright'}).addTo(map);

bootstrap();

async function bootstrap() {
  try {
    const [main, turnCatalog, alcaldias, subsidencias, fracturamiento, conteoInmuebles, detalleObra] = await Promise.all([
      loadMainData(), fetchJson(DATA.turnos), fetchJson(DATA.alcaldias), fetchJson(DATA.subsidencias), fetchJson(DATA.fracturamiento), fetchJson(DATA.conteoInmuebles), fetchJson(DATA.detalleObra)
    ]);
    dataset = InmueblesMaster.apply(CctMaster.merge(main, turnCatalog), conteoInmuebles);
    dataset.metadata.cct_con_indice_final = dataset.ccts.filter(record => Number.isFinite(record.indice_prioridad_final)).length;
    dataset.programas = dataset.programas.map(program => ({...program, count:dataset.ccts.filter(record => record.programas.includes(program.id)).length}));
    dataset.inmuebles_conteo = conteoInmuebles;
    detalleObraPorCct = detalleObra;
    programMap = new Map(dataset.programas.map(program => [program.id, program]));
    maintenanceMap = new Map(dataset.mantenimiento_variables.map(variable => [variable.id, variable]));
    cctRecordMap = new Map(dataset.ccts.map(record => [record.cct, record]));
    turnCatalogMap = new Map(Object.entries(turnCatalog.ccts || {}));
    markersLayer = L.layerGroup().addTo(map);
    configureBoundary(alcaldias);
    configureTerritorialLayers(subsidencias, fracturamiento);
    buildControls();
    bindEvents();
    restoreState();
    render(true);
    q('mapStatus').classList.add('hidden');
  } catch (error) {
    console.error(error);
    q('mapStatus').textContent = `No fue posible cargar la información del visor: ${error.message}`;
    q('mapStatus').classList.add('error');
  }
}

async function loadMainData() {
  const manifest = await fetchJson(DATA.main);
  if (!Array.isArray(manifest.partes_datos) || !manifest.partes_datos.length) return manifest;
  const [parts, supports] = await Promise.all([
    Promise.all(manifest.partes_datos.map(file => fetchJson(`data/${file}`))),
    fetchJson(DATA.supports)
  ]);
  const updates = Array.isArray(supports.actualizaciones_programas) ? supports.actualizaciones_programas : [];
  const attachSupportDetails = (items, collection) => items.map(item => {
    const details = [...(supports[collection]?.[item.uid] || [])];
    const matchingUpdates = updates.filter(update => item.ccts.includes(update.cct));
    matchingUpdates.forEach(update => {
      if (!details.some(detail => detail.programa === update.programa_nombre && detail.ejecutor === update.ejecutor)) {
        details.push({programa:update.programa_nombre, ejecutor:update.ejecutor});
      }
    });
    const updatedItem = matchingUpdates.reduce((updated, update) => ({
      ...updated,
      programas: [...new Set([...updated.programas, update.programa_id])],
      mejoras_previas: [...new Set([...updated.mejoras_previas, update.programa_label])],
      mejoras_previas_ids: [...new Set([...updated.mejoras_previas_ids, update.programa_id])],
      tuvo_apoyo_previo: true,
      apoyos_recibidos_detalle: details
    }), {...item});
    if (updatedItem.programas.includes('ilife_180_2026')) {
      updatedItem.mejoras_previas = updatedItem.mejoras_previas.map(label => label === '180 ILIFE · 2026' ? '181 ILIFE · 2026' : label);
    }
    return {...updatedItem, apoyos_recibidos_detalle:details};
  });
  const inmuebles = attachSupportDetails(parts.flatMap(part => part.inmuebles || []), 'inmuebles');
  const ccts = attachSupportDetails(parts.flatMap(part => part.ccts || []), 'ccts');
  const programas = manifest.programas.map(program => ({
    ...program,
    label: program.id === 'ilife_180_2026' ? '181 ILIFE · 2026' : program.label,
    count: program.id === 'ilife_180_2026' ? 181 : program.count
  }));
  return {
    ...manifest,
    programas,
    inmuebles,
    ccts
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error(`Error ${response.status} al cargar ${url}`);
  return response.json();
}

const OFFICIAL_ALCALDIAS = new Map([
  ['ALVARO OBREGON','Álvaro Obregón'], ['AZCAPOTZALCO','Azcapotzalco'],
  ['BENITO JUAREZ','Benito Juárez'], ['COYOACAN','Coyoacán'],
  ['CUAJIMALPA DE MORELOS','Cuajimalpa de Morelos'], ['CUAUHTEMOC','Cuauhtémoc'],
  ['GUSTAVO A. MADERO','Gustavo A. Madero'], ['IZTACALCO','Iztacalco'],
  ['IZTAPALAPA','Iztapalapa'], ['LA MAGDALENA CONTRERAS','La Magdalena Contreras'],
  ['MIGUEL HIDALGO','Miguel Hidalgo'], ['MILPA ALTA','Milpa Alta'],
  ['TLAHUAC','Tláhuac'], ['TLALPAN','Tlalpan'],
  ['VENUSTIANO CARRANZA','Venustiano Carranza'], ['XOCHIMILCO','Xochimilco']
]);

const OFFICIAL_LEVELS = new Map([
  ['primaria','Primaria'], ['preescolar','Preescolar'], ['secundaria','Secundaria'],
  ['educación inicial','Educación inicial'], ['especial','Especial'], ['inicial','Educación inicial'],
  ['especial - cam','Especial'], ['capep','CAPEP'], ['normal','Normal'],
  ['preescolar - comunitario','Preescolar - comunitario'],
  ['primaria - comunitaria','Primaria - comunitaria'],
  ['secundaria - comunitaria','Secundaria - comunitaria'],
  ['adultos - primaria','Adultos - primaria'], ['adultos - secundaria','Adultos - secundaria'],
  ['baja','Baja'], ['para adultos','Para adultos'], ['capacitación','Capacitación'],
  ['especial - otro','Especial - otro']
]);

function sentenceCase(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
  return text ? text.charAt(0).toLocaleUpperCase('es-MX') + text.slice(1) : '';
}

function canonicalAlcaldia(value) {
  return OFFICIAL_ALCALDIAS.get(clean(value)) || sentenceCase(value);
}

function canonicalLevel(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return OFFICIAL_LEVELS.get(text.toLocaleLowerCase('es-MX')) || sentenceCase(text);
}

function normalizeDatasetCategories(main, turnCatalog = {}) {
  const normalizeItem = item => {
    let niveles = unique((item.niveles || [item.nivel]).map(canonicalLevel));
    if (item.tipo === 'cct' && niveles.includes('Para adultos')) {
      const adultLevels = unique((turnCatalog[item.cct] || [])
        .map(turn => canonicalLevel(turn.nivel))
        .filter(level => level === 'Adultos - primaria' || level === 'Adultos - secundaria'));
      if (adultLevels.length) niveles = unique([...niveles.filter(level => level !== 'Para adultos'), ...adultLevels]);
    }
    return {
      ...item,
      alcaldia: canonicalAlcaldia(item.alcaldia),
      nivel: niveles[0] || canonicalLevel(item.nivel),
      niveles
    };
  };
  const ccts = main.ccts.map(normalizeItem);
  const cctByKey = new Map(ccts.map(item => [item.cct, item]));
  const inmuebles = main.inmuebles.map(item => {
    const normalized = normalizeItem(item);
    if (!normalized.niveles.includes('Para adultos')) return normalized;
    const adultLevels = unique(normalized.ccts
      .flatMap(cct => cctByKey.get(cct)?.niveles || [])
      .filter(level => level === 'Adultos - primaria' || level === 'Adultos - secundaria'));
    return adultLevels.length
      ? {...normalized, nivel:adultLevels[0], niveles:adultLevels}
      : normalized;
  });
  return {
    ...main,
    inmuebles,
    ccts
  };
}

function configureBoundary(geojson) {
  alcaldiasLayer = L.geoJSON(geojson, {
    style: {color:'#315b7d', weight:1.1, fillColor:'#dbe7ef', fillOpacity:.05, dashArray:'4 3'},
    interactive:false
  }).addTo(map);
  map.fitBounds(alcaldiasLayer.getBounds(), {padding:[24,24]});
  hasFitResult = true;
}

function configureTerritorialLayers(subsidencias, fracturamiento) {
  const colors = {1:'#006837', 2:'#78c679', 3:'#ffd166', 4:'#f97316', 5:'#dc2626'};
  subsidyLayer = L.geoJSON(subsidencias, {
    style: feature => ({color:colors[feature.properties.gridcode] || '#64748b', fillColor:colors[feature.properties.gridcode] || '#64748b', fillOpacity:.3, weight:.35}),
    interactive:false
  });
  fractureLayer = L.geoJSON(fracturamiento, {
    style: {color:'#a21caf', weight:2.2, opacity:.85},
    onEachFeature: (feature, layer) => {
      const type = feature.properties?.TIPO || 'Fractura cartografiada';
      layer.bindTooltip(escapeHtml(type), {className:'fracture-tooltip', sticky:true});
    }
  });
}

function buildControls() {
  const all = [...dataset.inmuebles, ...dataset.ccts];
  fillSelect(q('filtroAlcaldia'), unique(all.flatMap(item => item.alcaldia || [])));
  fillSelect(q('filtroNivel'), unique(all.flatMap(item => item.niveles || [item.nivel])).filter(level => !EXCLUDED_LEVEL_FILTERS.has(level)));
  q('programFilters').innerHTML = dataset.programas.map(program =>
    `<label class="inline-check"><input type="checkbox" value="${escapeHtml(program.id)}"><span><i class="program-dot" style="--program-color:${escapeHtml(program.color)}"></i>${escapeHtml(program.label)} <small>(${formatNumber(program.count)})</small></span></label>`
  ).join('');
  q('maintenanceFilters').innerHTML = dataset.mantenimiento_variables.map(variable =>
    `<label class="inline-check" title="${escapeHtml(variable.nombre_completo)}"><input type="checkbox" value="${escapeHtml(variable.id)}"><span>${escapeHtml(variable.nombre)} <small>· ${variable.peso} pts</small></span></label>`
  ).join('');
  refreshDatalists();
  q('coverageNote').textContent = `${formatNumber(dataset.metadata.cct_con_indice_final)} de ${formatNumber(dataset.metadata.total_cct)} CCT tienen índice final completo · ${formatNumber(dataset.metadata.registros_sin_coordenadas)} registros fuente sin coordenadas no se dibujan.${dataset.ccts.some(record => record.alerta_ubicacion) ? ` ${formatNumber(dataset.ccts.filter(record => record.alerta_ubicacion).length)} CCT tienen ubicación pendiente de verificación.` : ''}`;
}

function fillSelect(select, values) {
  values.forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), 'es'));
}

function activeMode() {
  return document.querySelector('input[name="viewMode"]:checked')?.value || 'inmueble';
}

function activeItems() {
  return dataset.inmuebles;
}

function refreshDatalists() {
  const items = activeItems();
  q('listaCCT').innerHTML = unique(items.flatMap(item => item.ccts)).map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  q('listaNombres').innerHTML = unique(items.flatMap(item => item.nombres)).map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function bindEvents() {
  document.querySelectorAll('input[name="viewMode"]').forEach(input => input.addEventListener('change', () => {
    hasFitResult = false;
    refreshDatalists();
    render(true);
  }));
  ['filtroAlcaldia','filtroNivel','buscarCCT','buscarNombre','rankMin','rankMax','toggleSchools']
    .forEach(id => q(id).addEventListener(id.startsWith('buscar') || id.startsWith('rank') ? 'input' : 'change', () => render(false)));
  bindSearchFocus(q('buscarCCT'), 'cct');
  bindSearchFocus(q('buscarNombre'), 'nombre');
  q('priorityFilters').addEventListener('change', () => render(false));
  document.querySelectorAll('input[name="riskMode"]').forEach(input => input.addEventListener('change', () => render(false)));
  q('programFilters').addEventListener('change', () => render(false));
  q('maintenanceFilters').addEventListener('change', () => render(false));
  q('selectAllProgramas').onclick = () => setChecks('#programFilters input', true);
  q('clearProgramas').onclick = () => setChecks('#programFilters input', false);
  q('selectAllMantenimiento').onclick = () => setChecks('#maintenanceFilters input', true);
  q('clearMantenimiento').onclick = () => setChecks('#maintenanceFilters input', false);
  q('selectAllPrioridades').onclick = () => setChecks('#priorityFilters input', true);
  q('clearPrioridades').onclick = () => setChecks('#priorityFilters input', false);
  q('clearRiesgos').onclick = () => {
    document.querySelectorAll('input[name="riskMode"]').forEach(input => input.checked = false);
    render(false);
  };
  q('btnLimpiar').onclick = clearFilters;
  q('toggleSubsidencias').onchange = toggleSubsidencies;
  q('toggleFracturamiento').onchange = toggleFractures;
  q('toggleProgramas').onclick = () => toggleMenu('programasBody','programasArrow','toggleProgramas');
  q('toggleMantenimiento').onclick = () => toggleMenu('mantenimientoBody','mantenimientoArrow','toggleMantenimiento');
  q('toggleRiesgos').onclick = () => toggleMenu('riesgosBody','riesgosArrow','toggleRiesgos');
  q('toggleLegend').onclick = () => toggleLegend('legendBody','toggleLegend');
  q('toggleSubLegend').onclick = () => toggleLegend('subLegendBody','toggleSubLegend');
  q('toggleSidebar').onclick = hideSidebar;
  q('showSidebar').onclick = showSidebar;
  q('closeDetail').onclick = () => q('detailPanel').classList.remove('open');
  q('fullscreenButton').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', syncFullscreen);
  window.addEventListener('resize', () => map.invalidateSize());
}

function setChecks(selector, checked) {
  document.querySelectorAll(selector).forEach(input => input.checked = checked);
  render(false);
}

function toggleMenu(bodyId, arrowId, buttonId) {
  const body = q(bodyId);
  const open = body.classList.toggle('hidden') === false;
  q(arrowId).textContent = open ? '⌄' : '›';
  q(buttonId).setAttribute('aria-expanded', String(open));
}

function toggleLegend(bodyId, buttonId) {
  const body = q(bodyId);
  body.classList.toggle('hidden');
  q(buttonId).textContent = body.classList.contains('hidden') ? '+' : '−';
}

function toggleSubsidencies() {
  if (q('toggleSubsidencias').checked) {
    subsidyLayer.addTo(map);
    subsidyLayer.bringToBack();
    if (alcaldiasLayer) alcaldiasLayer.bringToBack();
    q('subsidenciaLegend').classList.remove('hidden');
  } else {
    map.removeLayer(subsidyLayer);
    q('subsidenciaLegend').classList.add('hidden');
  }
}

function toggleFractures() {
  if (q('toggleFracturamiento').checked) fractureLayer.addTo(map);
  else map.removeLayer(fractureLayer);
}

function selectedPrograms() {
  return [...document.querySelectorAll('#programFilters input:checked')].map(input => input.value);
}

function selectedMaintenance() {
  return [...document.querySelectorAll('#maintenanceFilters input:checked')].map(input => input.value);
}

function selectedPriorities() {
  return [...document.querySelectorAll('#priorityFilters input:checked')].map(input => input.value);
}

function selectedRisk() {
  return document.querySelector('input[name="riskMode"]:checked')?.value || '';
}

function getState() {
  return {
    mode: activeMode(),
    alcaldia: q('filtroAlcaldia').value,
    nivel: q('filtroNivel').value,
    prioridades: selectedPriorities(),
    cct: q('buscarCCT').value,
    nombre: q('buscarNombre').value,
    rankMin: q('rankMin').value,
    rankMax: q('rankMax').value,
    programas: selectedPrograms(),
    mantenimiento: selectedMaintenance(),
    risk: selectedRisk()
  };
}

function restoreState() {
  try {
    const state = JSON.parse(localStorage.getItem('rm08_visor_state_xochimilco') || 'null');
    if (!state) return;
    const mode = document.querySelector(`input[name="viewMode"][value="${state.mode}"]`);
    if (mode) mode.checked = true;
    ['alcaldia','nivel'].forEach(field => {
      const target = q(`filtro${field.charAt(0).toUpperCase() + field.slice(1)}`);
      if (target && [...target.options].some(option => option.value === state[field])) target.value = state[field] || '';
    });
    const restoredPriorities = state.prioridades || (state.prioridad ? [state.prioridad] : []);
    document.querySelectorAll('#priorityFilters input').forEach(input => input.checked = restoredPriorities.includes(input.value));
    q('buscarCCT').value = state.cct || '';
    q('buscarNombre').value = state.nombre || '';
    q('rankMin').value = state.rankMin || '';
    q('rankMax').value = state.rankMax || '';
    document.querySelectorAll('#programFilters input').forEach(input => input.checked = (state.programas || []).includes(input.value));
    document.querySelectorAll('#maintenanceFilters input').forEach(input => input.checked = (state.mantenimiento || []).includes(input.value));
    const risk = document.querySelector(`input[name="riskMode"][value="${state.risk}"]`);
    if (risk) risk.checked = true;
  } catch (error) {
    console.warn('No se pudo restaurar el estado previo.', error);
  }
}

function render(fitResult) {
  if (!dataset) return;
  const state = getState();
  try { localStorage.setItem('rm08_visor_state_xochimilco', JSON.stringify(state)); } catch (_) {}
  currentCcts = InmueblesMaster.filterCcts(dataset, state);
  currentItems = InmueblesMaster.groupsForCcts(dataset, currentCcts);
  drawMarkers();
  updateSummary(state);
  if (fitResult && !hasFitResult) fitCurrentResult();
}

function drawMarkers() {
  markersLayer.clearLayers();
  if (!q('toggleSchools').checked) return;
  const canvas = L.canvas({padding:.35});
  const coincident = new Map();
  currentItems.filter(isMapped).forEach(item => {
    const key = `${item.lat.toFixed(7)}|${item.lon.toFixed(7)}`;
    if (!coincident.has(key)) coincident.set(key, []);
    coincident.get(key).push(item);
  });
  currentItems.filter(isMapped).forEach(item => {
    const group = coincident.get(`${item.lat.toFixed(7)}|${item.lon.toFixed(7)}`);
    const angle = 2 * Math.PI * group.indexOf(item) / group.length;
    const radius = group.length > 1 ? 0.000075 : 0;
    const marker = L.circleMarker([item.lat + Math.sin(angle) * radius, item.lon + Math.cos(angle) * radius], {
      renderer:canvas,
      radius:6,
      color:'#fff',
      weight:1.3,
      fillColor:priorityColor(item.clase_prioridad_final),
      fillOpacity:.9
    });
    marker.bindTooltip(`<div class="popup-title">${escapeHtml(item.nombre)}</div><div class="popup-meta">${escapeHtml(item.ccts.join(', ') || 'Sin CCT')} · ${escapeHtml(item.clase_prioridad_final)}${item.indice_prioridad_final === null ? '' : ` · IPA ${item.indice_prioridad_final.toFixed(1)}`}</div>`, {sticky:true});
    marker.on('click', () => showDetail(item, item.ccts_filtrados?.length === 1 ? {cct:item.ccts_filtrados[0]} : {}));
    marker.addTo(markersLayer);
  });
}

function priorityColor(priority) {
  return ({'Muy alta':'#991b1b', 'Alta':'#dc2626', 'Media':'#f59e0b', 'Baja':'#65a30d', 'Muy baja':'#16a34a'})[priority] || '#64748b';
}

function countOriginalInmueblesForCcts(ccts) {
  return InmueblesMaster.count(dataset, ccts);
}

function updateSummary(state) {
  const visibleCcts = currentCcts;
  const metricByTurn = predicate => visibleCcts
    .filter(predicate)
    .reduce((total, record) => total + cctTurnCount(record.cct), 0);
  q('kpiPlanteles').textContent = formatNumber(countOriginalInmueblesForCcts(visibleCcts.map(record => record.cct)));
  q('kpiCct').textContent = formatNumber(new Set(visibleCcts.map(record => record.cct)).size);
  q('kpi2').textContent = formatNumber(metricByTurn(item => ['Alta','Muy alta'].includes(item.clase_prioridad_final)));
  q('kpi3').textContent = formatNumber(metricByTurn(item => item.programas.length));
  q('kpi4').textContent = formatNumber(metricByTurn(item => item.observacion_territorial !== 'Sin observación' && item.observacion_territorial !== 'Sin información'));
  q('kpi5').textContent = formatNumber(metricByTurn(item => item.tuvo_apoyo_previo));
  q('kpi6').textContent = formatNumber(metricByTurn(item => item.mantenimiento_pendientes.length));
  const parts = [];
  if (state.prioridades.length) parts.push(`IPA: ${state.prioridades.map(value => value.toLowerCase()).join(', ')}`);
  if (state.programas.length) parts.push(`${state.programas.length} mejora(s)`);
  if (state.mantenimiento.length) parts.push(`${state.mantenimiento.length} necesidad(es) de mantenimiento`);
  if (state.risk) parts.push('observación territorial');
  if (state.rankMin || state.rankMax) parts.push(`clasificación 1,2,3: ${state.rankMin || 1}–${state.rankMax || 464}`);
  q('activeCrossSummary').textContent = parts.length ? `Cruce activo: ${parts.join(' + ')}.` : 'Sin cruces temáticos activos.';
}

function cctTurnCount(cct) {
  const turns = turnCatalogMap.get(cct);
  return Array.isArray(turns) && turns.length ? turns.length : 1;
}

function cctMatchesState(item, state) {
  return InmueblesMaster.matchesCct(item, state);
}

function fitCurrentResult() {
  const points = currentItems.filter(isMapped).map(item => [item.lat, item.lon]);
  if (points.length) {
    map.fitBounds(L.latLngBounds(points), {padding:[28,28], maxZoom:15});
    hasFitResult = true;
  }
}

function bindSearchFocus(input, type) {
  const focus = () => focusSearchResult(type, input.value);
  input.addEventListener('change', focus);
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    focus();
  });
}

function focusSearchResult(type, rawValue) {
  const value = clean(rawValue);
  if (!value) return;
  const items = activeItems();
  const values = item => type === 'cct' ? item.ccts : item.nombres;
  const item = items.find(candidate => values(candidate).some(entry => clean(entry) === value))
    || items.find(candidate => values(candidate).some(entry => clean(entry).includes(value)));
  if (!item) return;
  if (isMapped(item)) map.setView([item.lat, item.lon], 17, {animate:true});
  showDetail(item);
}

function clearFilters() {
  ['filtroAlcaldia','filtroNivel','buscarCCT','buscarNombre','rankMin','rankMax'].forEach(id => q(id).value = '');
  document.querySelectorAll('#priorityFilters input, #programFilters input, #maintenanceFilters input, input[name="riskMode"]').forEach(input => input.checked = false);
  hasFitResult = false;
  render(true);
}

function showDetail(item, selection = {}) {
  const hostItem = item.tipo === 'inmueble'
    ? item
    : dataset.inmuebles.find(candidate => candidate.ccts.includes(item.cct)) || item;
  const selectedCct = selection.cct || (hostItem.tipo === 'cct' || hostItem.ccts.length === 1 ? hostItem.cct || hostItem.ccts[0] : '');
  const selectedCctItem = selectedCct ? cctRecordMap.get(selectedCct) : null;
  const detailItem = selectedCctItem || hostItem;
  const turns = selectedCct ? (turnCatalogMap.get(selectedCct) || []) : [];
  const selectedTurn = turns.find(turn => `${turn.id}|${turn.turno}` === selection.turno) || null;
  const effectiveTurn = selectedTurn || (turns.length === 1 ? turns[0] : null);
  const selectedTurnLabel = effectiveTurn?.turno || (turns.length > 1 ? 'Seleccione un turno' : selectedCct ? 'Sin dato' : 'Seleccione un CCT');
  const cctSelector = hostItem.tipo === 'inmueble' && hostItem.ccts.length > 1
    ? `<section class="entity-selector"><span>Seleccione un CCT</span><div>${hostItem.ccts.map(key => `<button type="button" class="selector-button${selectedCct === key ? ' active' : ''}" data-cct="${escapeHtml(key)}">${escapeHtml(key)}</button>`).join('')}</div></section>`
    : '';
  const turnSelector = selectedCct && turns.length > 1
    ? `<section class="entity-selector"><span>Seleccione un turno</span><div>${turns.map(turn => {
        const key = `${turn.id}|${turn.turno}`;
        return `<button type="button" class="selector-button${selection.turno === key ? ' active' : ''}" data-turn="${escapeHtml(key)}">${escapeHtml(turn.turno)}</button>`;
      }).join('')}</div></section>`
    : '';
  q('detailTitle').textContent = effectiveTurn?.nombre || detailItem.nombre;
  const prioritySlug = clean(detailItem.clase_prioridad_final).toLowerCase().replace(/\s+/g, '-');
  const programCards = detailItem.programa_registros.length
    ? renderProgramSummary(detailItem.programa_registros)
    : '<p class="muted-box">No hay registros de mejoras vinculados a esta unidad.</p>';
  const supportDetails = renderSupportDetails(detailItem);
  const locationWarnings = selectedCct
    ? [selectedCctItem?.alerta_ubicacion].filter(Boolean)
    : Object.values(hostItem.ubicaciones_por_verificar || {});
  const obraRows = getDetalleObraRows(selectedCct ? [selectedCct] : hostItem.ccts);
  const maintenanceCards = detailItem.mantenimiento_disponible
    ? (detailItem.mantenimiento_pendientes.length
      ? detailItem.mantenimiento_pendientes.map(renderMaintenanceNeed).join('')
      : '<p class="status-box status-ok">El diagnóstico no reporta necesidades pendientes en las variables evaluadas.</p>')
    : '<p class="status-box status-missing">Este inmueble no cuenta con diagnóstico de mantenimiento en la nueva base. No se interpreta como ausencia de necesidades.</p>';
  q('detailContent').innerHTML = `
    <div class="detail-tabs">
      <button class="tab-btn active" data-tab="general">General</button>
      <button class="tab-btn" data-tab="prioridad">Prioridad</button>
      <button class="tab-btn" data-tab="mantenimiento">Mantenimiento <span class="tab-count">${detailItem.mantenimiento_pendientes.length}</span></button>
      <button class="tab-btn" data-tab="programas">Mejoras <span class="tab-count">${detailItem.programa_registros.length}</span></button>
      ${obraRows.length ? '<button class="tab-btn" data-tab="detalle-obra">Detalle de obra</button>' : ''}
      <button class="tab-btn" data-tab="territorio">Territorio</button>
    </div>
    <div class="tab-pane active" data-pane="general">
      ${cctSelector}${turnSelector}
      ${locationWarnings.map(message => `<p class="context-note">${escapeHtml(message)}</p>`).join('')}
      <dl class="general-info-grid"><dt>Unidad</dt><dd>${selectedCct ? 'CCT' : 'Plantel'}</dd><dt>Código DGA</dt><dd>${escapeHtml(detailItem.codigos_dga.join(', ') || 'Sin dato')}</dd><dt>CCT</dt><dd>${escapeHtml(selectedCct || detailItem.ccts.join(', ') || 'Sin CCT')}</dd><dt>Turno</dt><dd>${escapeHtml(selectedTurnLabel)}</dd><dt>Alcaldía</dt><dd>${escapeHtml(effectiveTurn?.alcaldia || detailItem.alcaldia || 'Sin dato')}</dd><dt>Colonia</dt><dd>${escapeHtml(effectiveTurn?.colonia || detailItem.colonia || 'Sin dato')}</dd><dt>Domicilio</dt><dd>${escapeHtml(effectiveTurn?.domicilio || detailItem.domicilio || 'Sin dato')}</dd><dt>Nivel educativo</dt><dd>${escapeHtml(effectiveTurn?.nivel || detailItem.niveles.join(', ') || 'Sin dato')}</dd><dt>Coordenadas</dt><dd>${isMapped(detailItem) ? `${detailItem.lat.toFixed(6)}, ${detailItem.lon.toFixed(6)}` : 'Sin coordenadas'}</dd></dl>
      <div class="support-summary ${detailItem.tuvo_apoyo_previo ? 'has-support' : ''}"><span>Apoyo previo identificado</span><strong>${detailItem.tuvo_apoyo_previo ? 'Sí' : 'No'}</strong></div>
      ${detailItem.tuvo_apoyo_previo ? `<h3 class="section-subtitle">Apoyos y trabajos recibidos</h3>${supportDetails}` : ''}
    </div>
    <div class="tab-pane" data-pane="prioridad">
      <div class="priority-card priority-${prioritySlug}"><span>Índice de Prioridad de Atención</span><strong>${escapeHtml(detailItem.clase_prioridad_final)}</strong><em>${detailItem.indice_prioridad_final === null ? 'Sin índice completo' : `${detailItem.indice_prioridad_final.toFixed(1)} / 100`}</em></div>
      <dl><dt>Condición de mantenimiento</dt><dd>${detailItem.indice_mantenimiento === null ? 'Sin información' : `${detailItem.indice_mantenimiento.toFixed(1)} / 100 · ${escapeHtml(detailItem.clase_mantenimiento)}`}</dd><dt>Peligro territorial</dt><dd>${detailItem.indice_peligro_territorial === null ? 'Sin información' : `${detailItem.indice_peligro_territorial.toFixed(1)} / 100 · ${escapeHtml(detailItem.clase_peligro_territorial)}`}</dd><dt>Calidad del índice</dt><dd>${escapeHtml(detailItem.calidad_indice_final)}</dd><dt>Alerta</dt><dd>${escapeHtml(detailItem.alerta_prioridad)}</dd><dt>Prioridad RM08 original</dt><dd>${escapeHtml(detailItem.prioridad_rm08_original || 'Sin clasificación')} · índice ${detailItem.indice_rm08_original ?? '—'}</dd><dt>1, 2, 3 2026</dt><dd>${detailItem.prioridades_123_2026.length ? `Clasificación ${escapeHtml(detailItem.prioridades_123_2026.join(', '))} de 464` : 'Sin clasificación'}</dd></dl>
      <p class="method-note">Índice final = 60% condición de mantenimiento + 40% peligro territorial. El peligro territorial combina 70% subsidencia/hundimiento y 30% cercanía a fracturas. Los faltantes no se convierten en cero.</p>
    </div>
    <div class="tab-pane" data-pane="mantenimiento">
      <div class="maintenance-score"><span>Condición de mantenimiento</span><strong>${detailItem.indice_mantenimiento === null ? 'Sin diagnóstico' : `${detailItem.indice_mantenimiento.toFixed(1)} / 100`}</strong><small>${escapeHtml(detailItem.clase_mantenimiento)} · ${escapeHtml(detailItem.alerta_mantenimiento)}</small></div>
      ${detailItem.mantenimiento_transformador ? '<p class="context-note">El inmueble reporta subestación o transformador. Este dato no suma puntos, pero especializa la revisión eléctrica.</p>' : ''}
      <div class="maintenance-detail-list">${maintenanceCards}</div>
    </div>
    <div class="tab-pane" data-pane="programas">
      <div class="support-summary ${detailItem.tuvo_apoyo_previo ? 'has-support' : ''}"><span>Apoyo previo identificado</span><strong>${detailItem.tuvo_apoyo_previo ? 'Sí' : 'No'}</strong></div>
      <h3 class="section-subtitle">Apoyos y trabajos recibidos</h3>${supportDetails}
      <h3 class="section-subtitle">Registros de mejoras</h3>${programCards}
    </div>
    ${obraRows.length ? `<div class="tab-pane" data-pane="detalle-obra">${renderDetalleObra(obraRows)}</div>` : ''}
    <div class="tab-pane" data-pane="territorio">
      <dl class="territory-info-grid"><dt>Índice territorial</dt><dd>${detailItem.indice_peligro_territorial === null ? 'Sin información' : `${detailItem.indice_peligro_territorial.toFixed(1)} / 100 · ${escapeHtml(detailItem.clase_peligro_territorial)}`}</dd><dt>Calidad territorial</dt><dd>${escapeHtml(detailItem.calidad_peligro_territorial)}</dd><dt>Resultado de observación</dt><dd>${escapeHtml(detailItem.observacion_territorial)}</dd><dt>Fracturamiento</dt><dd>${detailItem.cercano_fracturamiento_250m ? 'Sí, dentro de 250 m' : detailItem.distancia_fracturamiento_m === null ? 'Sin información' : 'No, fuera de 250 m'}</dd><dt>Distancia mínima</dt><dd>${detailItem.distancia_fracturamiento_m === null ? 'Sin información' : `${formatNumber(detailItem.distancia_fracturamiento_m)} m · nivel ${detailItem.nivel_fracturamiento}`}</dd><dt>Subsidencia/hundimiento</dt><dd>${escapeHtml(detailItem.clase_subsidencia)}${detailItem.nivel_subsidencia ? ` · nivel ${detailItem.nivel_subsidencia}` : ''}</dd></dl>
      <p class="method-note">La proximidad a fracturas y la clasificación de subsidencia son referencias territoriales para ordenar revisiones; no constituyen un dictamen estructural.</p>
    </div>`;
  q('detailPanel').classList.add('open');
  q('detailContent').querySelectorAll('.tab-btn').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  q('detailContent').querySelectorAll('[data-cct]').forEach(button => button.addEventListener('click', () => showDetail(hostItem, {cct:button.dataset.cct})));
  q('detailContent').querySelectorAll('[data-turn]').forEach(button => button.addEventListener('click', () => showDetail(hostItem, {cct:selectedCct, turno:button.dataset.turn})));
}

function getDetalleObraRows(ccts) {
  const rows = (ccts || []).flatMap(cct => detalleObraPorCct[cct] || []);
  return [...new Map(rows.map(row => [JSON.stringify([row.contrato, row.descripcion]), row])).values()];
}

function renderDetalleObra(rows) {
  return `<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;line-height:1.5"><thead><tr><th style="width:34%;padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid #cbd5e1;overflow-wrap:anywhere">No. de contrato</th><th style="padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid #cbd5e1;overflow-wrap:anywhere">Descripción de los trabajos en acta entrega-recepción</th></tr></thead><tbody>${rows.map(row => `<tr><td style="padding:9px;vertical-align:top;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere;white-space:pre-wrap">${escapeHtml(row.contrato)}</td><td style="padding:9px;vertical-align:top;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere;white-space:pre-wrap">${escapeHtml(row.descripcion)}</td></tr>`).join('')}</tbody></table>`;
}

function activateTab(tab) {
  q('detailContent').querySelectorAll('.tab-btn').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  q('detailContent').querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === tab));
}

function renderProgramSummary(refs) {
  const entries = refs.map(ref => {
    const meta = programMap.get(ref.programa);
    const label = meta?.label || ref.programa;
    const positionField = ref.programa === 'faltantes_464'
      ? (ref.registro?.campos || []).find(field => clean(field.campo) === clean('1, 2, 3 2026 PRIORIDAD 464'))
      : null;
    const position = positionField && positionField.valor !== '' && positionField.valor !== null
      ? Number(positionField.valor)
      : Number.NaN;
    return {
      key: `${ref.programa}|${Number.isFinite(position) ? position : ''}`,
      label: Number.isFinite(position) ? `${label} · ${formatNumber(position)} de 464` : label,
      color: meta?.color || '#174a72'
    };
  });
  const uniqueEntries = [...new Map(entries.map(entry => [entry.key, entry])).values()];
  return `<ul class="improvement-list">${uniqueEntries.map(entry => `<li><i class="program-dot" style="--program-color:${escapeHtml(entry.color)}"></i><strong>${escapeHtml(entry.label)}</strong></li>`).join('')}</ul>`;
}

function renderMaintenanceNeed(variableId) {
  const variable = maintenanceMap.get(variableId);
  if (!variable) return '';
  return `<article class="maintenance-need"><div><span>${escapeHtml(variable.grupo)}</span><strong>${escapeHtml(variable.nombre_completo)}</strong></div><b>${variable.peso} pts</b><p>${escapeHtml(variable.descripcion)}</p></article>`;
}

function renderSupportDetails(item) {
  const supports = Array.isArray(item.apoyos_recibidos_detalle) ? item.apoyos_recibidos_detalle : [];
  if (!item.tuvo_apoyo_previo) return '<p class="muted-box">No se identificaron apoyos previos vinculados.</p>';
  if (!supports.length) {
    return item.mejoras_previas.length
      ? `<div class="support-detail-list">${item.mejoras_previas.map(programa => `<article class="support-detail"><div class="support-detail-head"><span class="support-check" aria-hidden="true">✓</span><div><small>Programa de apoyo</small><strong>${escapeHtml(programa)}</strong></div></div><p>El padrón confirma el apoyo, pero la base no incluye el desglose de los trabajos.</p></article>`).join('')}</div>`
      : '<p class="muted-box">El padrón confirma apoyo previo, pero no incluye su desglose.</p>';
  }
  return `<div class="support-detail-list">${supports.map(support => {
    const metadata = [
      support.ejecutor ? `Ejecutor: ${support.ejecutor}` : '',
      support.etapa || '',
      support.estado || '',
      support.contrato ? `Contrato: ${support.contrato}` : ''
    ].filter(Boolean);
    const works = Array.isArray(support.trabajos) ? support.trabajos : [];
    return `<article class="support-detail">
      <div class="support-detail-head"><span class="support-check" aria-hidden="true">✓</span><div><small>Programa de apoyo</small><strong>${escapeHtml(support.programa || 'Apoyo registrado')}</strong>${metadata.length ? `<em>${metadata.map(escapeHtml).join(' · ')}</em>` : ''}</div></div>
      ${works.length ? `<ul class="support-work-list">${works.map(work => `<li><span aria-hidden="true">✓</span><strong>${escapeHtml(work)}</strong></li>`).join('')}</ul>` : '<p>El padrón confirma el apoyo, pero la base no incluye el desglose de los trabajos.</p>'}
    </article>`;
  }).join('')}</div>`;
}

function hideSidebar() {
  q('layout').classList.add('sidebar-collapsed');
  q('showSidebar').classList.remove('hidden');
  setTimeout(() => map.invalidateSize(), 220);
}

function showSidebar() {
  q('layout').classList.remove('sidebar-collapsed');
  q('showSidebar').classList.add('hidden');
  setTimeout(() => map.invalidateSize(), 220);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.warn('Pantalla completa no disponible.', error);
  }
}

function syncFullscreen() {
  const active = Boolean(document.fullscreenElement);
  q('fullscreenButton').textContent = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  q('fullscreenButton').setAttribute('aria-pressed', String(active));
  document.body.classList.toggle('is-fullscreen', active);
  setTimeout(() => map.invalidateSize(), 100);
}
