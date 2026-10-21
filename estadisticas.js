'use strict';

const q = id => document.getElementById(id);
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const fmt = value => Number(value || 0).toLocaleString('es-MX');
const pct = (value, total) => total ? `${(value * 100 / total).toFixed(1)}%` : '0.0%';

let dataset;
let programMap = new Map();
let maintenanceMap = new Map();
let filtered = [];

init();

async function init() {
  try {
    const [main, turnCatalog, conteoInmuebles] = await Promise.all([
      loadMainData(),
      fetchJson('data/catalogo_cct_turnos.json'),
      fetchJson('data/inmuebles_conteo.json')
    ]);
    dataset = InmueblesMaster.apply(CctMaster.merge(main, turnCatalog), conteoInmuebles);
    dataset.metadata.cct_con_indice_final = dataset.ccts.filter(record => Number.isFinite(record.indice_prioridad_final)).length;
    dataset.programas = dataset.programas.map(program => ({...program, count:dataset.ccts.filter(record => record.programas.includes(program.id)).length}));
    programMap = new Map(dataset.programas.map(program => [program.id, program]));
    maintenanceMap = new Map(dataset.mantenimiento_variables.map(variable => [variable.id, variable]));
    buildFilters();
    bindEvents();
    restoreState();
    render();
  } catch (error) {
    console.error(error);
    q('statsContext').textContent = `No fue posible cargar la información: ${error.message}`;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error(`Error ${response.status} al cargar ${url}`);
  return response.json();
}

async function loadMainData() {
  const manifest = await fetchJson('data/rm08_infraestructura.json');
  if (!Array.isArray(manifest.partes_datos) || !manifest.partes_datos.length) return manifest;
  const [parts, supports] = await Promise.all([
    Promise.all(manifest.partes_datos.map(file => fetchJson(`data/${file}`))),
    fetchJson('data/apoyos_detallados.json')
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


function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), 'es'));
}

function fillSelect(select, values) {
  values.forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
}

function buildFilters() {
  const all = [...dataset.inmuebles, ...dataset.ccts];
  fillSelect(q('stAlcaldia'), unique(all.map(item => item.alcaldia)));
  fillSelect(q('stNivel'), unique(all.flatMap(item => item.niveles)).filter(level => !CctMaster.excludedLevels.has(level)));
  q('stPrograms').innerHTML = dataset.programas.map(program =>
    `<label><input type="checkbox" value="${escapeHtml(program.id)}"><span><i class="program-dot" style="--program-color:${escapeHtml(program.color)}"></i>${escapeHtml(program.label)}</span></label>`
  ).join('');
  q('stMaintenance').innerHTML = dataset.mantenimiento_variables.map(variable =>
    `<label title="${escapeHtml(variable.nombre_completo)}"><input type="checkbox" value="${escapeHtml(variable.id)}"><span>${escapeHtml(variable.nombre)} <small>· ${variable.peso} pts</small></span></label>`
  ).join('');
}

function bindEvents() {
  ['stViewMode','stAlcaldia','stNivel','stCCT','stNombre','stRankMin','stRankMax'].forEach(id => {
    q(id).addEventListener(id === 'stViewMode' || id.startsWith('stA') || id === 'stNivel' ? 'change' : 'input', render);
  });
  q('stPriorityFilters').addEventListener('change', render);
  q('stPrograms').addEventListener('change', render);
  q('stMaintenance').addEventListener('change', render);
  document.querySelectorAll('input[name="stRisk"]').forEach(input => input.addEventListener('change', render));
  q('stAllPrograms').onclick = () => setPrograms(true);
  q('stClearPrograms').onclick = () => setPrograms(false);
  q('stAllMaintenance').onclick = () => setMaintenance(true);
  q('stClearMaintenance').onclick = () => setMaintenance(false);
  q('stAllPriorities').onclick = () => setPriorities(true);
  q('stClearPriorities').onclick = () => setPriorities(false);
  q('stClearRisk').onclick = () => {
    document.querySelectorAll('input[name="stRisk"]').forEach(input => input.checked = false);
    render();
  };
  q('stLimpiar').onclick = clearFilters;
}

function setPrograms(checked) {
  document.querySelectorAll('#stPrograms input').forEach(input => input.checked = checked);
  render();
}

function setPriorities(checked) {
  document.querySelectorAll('#stPriorityFilters input').forEach(input => input.checked = checked);
  render();
}

function setMaintenance(checked) {
  document.querySelectorAll('#stMaintenance input').forEach(input => input.checked = checked);
  render();
}

function getState() {
  return {
    mode:q('stViewMode').value,
    alcaldia:q('stAlcaldia').value,
    nivel:q('stNivel').value,
    prioridades:[...document.querySelectorAll('#stPriorityFilters input:checked')].map(input => input.value),
    cct:q('stCCT').value,
    nombre:q('stNombre').value,
    rankMin:q('stRankMin').value,
    rankMax:q('stRankMax').value,
    programas:[...document.querySelectorAll('#stPrograms input:checked')].map(input => input.value),
    mantenimiento:[...document.querySelectorAll('#stMaintenance input:checked')].map(input => input.value),
    risk:document.querySelector('input[name="stRisk"]:checked')?.value || ''
  };
}

function restoreState() {
  try {
    const state = JSON.parse(localStorage.getItem('rm08_visor_state_xochimilco') || 'null');
    if (!state) return;
    q('stViewMode').value = 'cct';
    ['alcaldia','nivel'].forEach(field => {
      const id = `st${field.charAt(0).toUpperCase() + field.slice(1)}`;
      if ([...q(id).options].some(option => option.value === state[field])) q(id).value = state[field] || '';
    });
    const restoredPriorities = state.prioridades || (state.prioridad ? [state.prioridad] : []);
    document.querySelectorAll('#stPriorityFilters input').forEach(input => input.checked = restoredPriorities.includes(input.value));
    q('stCCT').value = state.cct || '';
    q('stNombre').value = state.nombre || '';
    q('stRankMin').value = state.rankMin || '';
    q('stRankMax').value = state.rankMax || '';
    document.querySelectorAll('#stPrograms input').forEach(input => input.checked = (state.programas || []).includes(input.value));
    document.querySelectorAll('#stMaintenance input').forEach(input => input.checked = (state.mantenimiento || []).includes(input.value));
    const risk = document.querySelector(`input[name="stRisk"][value="${state.risk}"]`);
    if (risk) risk.checked = true;
  } catch (_) {}
}

function render() {
  if (!dataset) return;
  const state = getState();
  try { localStorage.setItem('rm08_visor_state_xochimilco', JSON.stringify(state)); } catch (_) {}
  filtered = InmueblesMaster.filterCcts(dataset, state);
  updateContext(state);
  updateCards(state);
  updatePriorityTable();
  updateLevelTable();
  updateProgramTable();
  updateMaintenanceTable();
  updateRiskTable();
  updateAlcaldiaTable();
  updateRanking(state);
}

function updateContext(state) {
  const tags = [];
  if (state.alcaldia) tags.push(state.alcaldia);
  if (state.nivel) tags.push(state.nivel);
  if (state.prioridades.length) tags.push(`IPA: ${state.prioridades.join(', ')}`);
  if (state.cct) tags.push(`CCT: ${state.cct}`);
  if (state.nombre) tags.push(`Plantel: ${state.nombre}`);
  if (state.rankMin || state.rankMax) tags.push(`Clasificación ${state.rankMin || 1}–${state.rankMax || 464}`);
  if (state.programas.length) tags.push(`${state.programas.length} mejora(s)`);
  if (state.mantenimiento.length) tags.push(`${state.mantenimiento.length} necesidad(es) de mantenimiento`);
  if (state.risk) tags.push('Observación territorial');
  q('statsContext').textContent = tags.length ? `Se aplican ${tags.length} criterio(s) de manera simultánea.` : 'Sin filtros: se muestra la base completa.';
  q('statsTags').innerHTML = tags.map(tag => `<span class="mini-tag blue">${escapeHtml(tag)}</span>`).join('');
}

function updateCards(state) {
  const unit = state.mode === 'cct' ? 'CCT' : 'Inmuebles';
  q('stTotalLabel').textContent = `${unit} del resultado`;
  q('stTotal').textContent = fmt(filtered.length);
  q('stInmuebles').textContent = fmt(InmueblesMaster.count(dataset, filtered));
  q('stMapped').textContent = fmt(filtered.filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon)).length);
  q('stHigh').textContent = fmt(filtered.filter(item => ['Alta','Muy alta'].includes(item.clase_prioridad_final)).length);
  q('stTerritorial').textContent = fmt(filtered.filter(item => item.observacion_territorial !== 'Sin observación').length);
  q('stSupport').textContent = fmt(filtered.filter(item => item.tuvo_apoyo_previo).length);
  q('stMaintenancePending').textContent = fmt(filtered.filter(item => item.mantenimiento_pendientes.length).length);
  ['stDistributionUnit','stLevelUnit','stProgramUnit','stRiskUnit','stMaintenanceUnit','stAlcaldiaUnit'].forEach(id => q(id).textContent = unit);
}

function updatePriorityTable() {
  const labels = ['Muy alta','Alta','Media','Baja','Muy baja','Sin información'];
  q('tablaDistribucion').innerHTML = labels.map(label => {
    const count = filtered.filter(item => item.clase_prioridad_final === label).length;
    return `<tr><td>${escapeHtml(label)}</td><td>${fmt(count)}</td><td>${barCell(count, filtered.length)}</td></tr>`;
  }).join('');
}

function updateLevelTable() {
  const rows = groupBy(filtered, item => item.nivel || 'Sin nivel').map(([label, items]) => ({
    label, count:items.length, high:items.filter(item => ['Alta','Muy alta'].includes(item.clase_prioridad_final)).length
  })).sort((a,b) => b.count - a.count);
  q('tablaNivel').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${fmt(row.count)}</td><td>${fmt(row.high)}</td></tr>`).join('') : emptyRow(3);
}

function updateMaintenanceTable() {
  q('tablaMantenimiento').innerHTML = dataset.mantenimiento_variables.map(variable => {
    const count = filtered.filter(item => item.mantenimiento_pendientes.includes(variable.id)).length;
    return `<tr><td title="${escapeHtml(variable.nombre_completo)}">${escapeHtml(variable.nombre)}</td><td>${fmt(count)}</td><td>${barCell(count, filtered.length)}</td></tr>`;
  }).join('');
}

function updateProgramTable() {
  q('tablaProgramas').innerHTML = dataset.programas.map(program => {
    const count = filtered.filter(item => item.programas.includes(program.id)).length;
    return `<tr><td><i class="program-dot" style="--program-color:${escapeHtml(program.color)}"></i>${escapeHtml(program.label)}</td><td>${fmt(count)}</td><td>${barCell(count, filtered.length)}</td></tr>`;
  }).join('');
}

function updateRiskTable() {
  const labels = ['Observación combinada','Cercanía a fracturamiento','Subsidencia alta','Sin observación','Información territorial incompleta'];
  q('tablaRiesgos').innerHTML = labels.map(label => {
    const count = filtered.filter(item => item.observacion_territorial === label).length;
    return `<tr><td>${escapeHtml(label)}</td><td>${fmt(count)}</td><td>${barCell(count, filtered.length)}</td></tr>`;
  }).join('');
}

function updateAlcaldiaTable() {
  const rows = groupBy(filtered, item => item.alcaldia || 'Sin alcaldía').map(([label, items]) => ({
    label, count:items.length,
    high:items.filter(item => ['Alta','Muy alta'].includes(item.clase_prioridad_final)).length,
    program:items.filter(item => item.programas.length).length,
    support:items.filter(item => item.tuvo_apoyo_previo).length
  })).sort((a,b) => b.count - a.count);
  q('tablaAlcaldia').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${fmt(row.count)}</td><td>${fmt(row.high)}</td><td>${fmt(row.program)}</td><td>${fmt(row.support)}</td><td>${barCell(row.count, filtered.length)}</td></tr>`).join('') : emptyRow(6);
}

function updateRanking(state) {
  const rows = [...filtered].sort((a,b) =>
    (b.indice_prioridad_final ?? -1) - (a.indice_prioridad_final ?? -1) ||
    (a.prioridad_123_2026 ?? 9999) - (b.prioridad_123_2026 ?? 9999) ||
    a.nombre.localeCompare(b.nombre, 'es')
  ).slice(0, 500);
  q('stRankingTitle').textContent = `${state.mode === 'cct' ? 'CCT' : 'Inmuebles'} del resultado`;
  q('tablaRanking').innerHTML = rows.length ? rows.map((item,index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.nombre)}</td><td>${escapeHtml(item.ccts.join(', ') || '—')}</td><td>${escapeHtml(item.alcaldia || '—')}</td><td>${escapeHtml(item.niveles.join(', ') || '—')}</td><td><span class="priority-pill p-${clean(item.clase_prioridad_final).toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(item.clase_prioridad_final)} · ${item.indice_prioridad_final ?? '—'}</span></td><td>${item.indice_mantenimiento === null ? 'Sin información' : `${item.indice_mantenimiento} · ${escapeHtml(item.clase_mantenimiento)}`}</td><td>${item.tuvo_apoyo_previo ? 'Sí' : 'No'}</td><td>${escapeHtml(item.mejoras_previas.join('; ') || '—')}</td><td>${item.prioridad_123_2026 ?? '—'}</td><td>${escapeHtml(item.programas.map(id => programMap.get(id)?.label || id).join('; ') || '—')}</td><td>${escapeHtml(item.observacion_territorial)}</td></tr>`).join('') : emptyRow(12);
}

function groupBy(items, getter) {
  const map = new Map();
  items.forEach(item => {
    const key = getter(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()];
}

function barCell(value, total) {
  const width = total ? value * 100 / total : 0;
  return `<div class="bar"><span style="width:${width.toFixed(2)}%"></span></div><small>${pct(value,total)}</small>`;
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" class="empty-row">No hay resultados para este cruce.</td></tr>`;
}

function clearFilters() {
  ['stAlcaldia','stNivel','stCCT','stNombre','stRankMin','stRankMax'].forEach(id => q(id).value = '');
  q('stViewMode').value = 'cct';
  document.querySelectorAll('#stPriorityFilters input, #stPrograms input, #stMaintenance input, input[name="stRisk"]').forEach(input => input.checked = false);
  render();
}
