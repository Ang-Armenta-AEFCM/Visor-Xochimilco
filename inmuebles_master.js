'use strict';
(function(global) {
  const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  const unique = values => [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
  const objects = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
  const mapped = item => Number.isFinite(item.lat) && Number.isFinite(item.lon);
  const best = members => members.reduce((chosen, member) => !chosen || (Number.isFinite(member.indice_prioridad_final) ? member.indice_prioridad_final : -1) > (Number.isFinite(chosen.indice_prioridad_final) ? chosen.indice_prioridad_final : -1) ? member : chosen, null);

  function apply(dataset, registry) {
    const byCct = new Map(dataset.ccts.map(record => [record.cct, record]));
    const legacyByCct = new Map();
    for (const group of dataset.inmuebles) for (const cct of group.ccts) {
      if (!legacyByCct.has(cct)) legacyByCct.set(cct, []);
      legacyByCct.get(cct).push(group);
    }
    const groupByCct = new Map(), groupIds = new Set();
    const groups = registry.map(source => {
      if (groupIds.has(source.id)) throw new Error('Identificador de inmueble repetido: '+source.id);
      groupIds.add(source.id);
      const ccts = unique(source.ccts || []);
      const members = ccts.map(cct => {
        if (!byCct.has(cct)) throw new Error('CCT del inmueble sin ficha: '+cct);
        if (groupByCct.has(cct)) throw new Error('CCT asociado a varios inmuebles: '+cct);
        groupByCct.set(cct, source.id);
        const member = byCct.get(cct);
        member.inmueble_master = source.id;
        if (source.ubicaciones_por_verificar?.[cct]) member.alerta_ubicacion = source.ubicaciones_por_verificar[cct];
        return member;
      });
      if (!members.length) throw new Error('Inmueble sin CCT: '+source.id);
      const representative = best(members);
      const reference = members.find(mapped) || members[0];
      const previous = objects(ccts.flatMap(cct => legacyByCct.get(cct) || []));
      const names = unique(members.map(member => member.nombre));
      const levels = unique(members.flatMap(member => member.niveles || []));
      const codigo = source.id.startsWith('INM-') ? source.id.slice(4) : '';
      return {
        ...representative,
        uid:'inmueble:maestro:'+source.id, tipo:'inmueble', inmueble_master:source.id,
        codigo_dga:codigo, codigos_dga:codigo ? [codigo] : [], cct:ccts[0], ccts,
        nombre:source.nombre || names[0], nombres:names, nivel:levels[0] || '', niveles:levels,
        alcaldia:reference.alcaldia, domicilio:source.domicilio || reference.domicilio,
        colonia:source.colonia_asentamiento || reference.colonia,
        lat:Number.isFinite(source.lat) ? source.lat : reference.lat,
        lon:Number.isFinite(source.lon) ? source.lon : reference.lon,
        programas:unique(members.flatMap(member => member.programas || [])),
        programa_registros:objects([...members, ...previous].flatMap(member => member.programa_registros || [])),
        mantenimiento_pendientes:unique(members.flatMap(member => member.mantenimiento_pendientes || [])),
        mantenimiento_disponible:members.some(member => member.mantenimiento_disponible),
        mantenimiento_transformador:members.some(member => member.mantenimiento_transformador),
        tuvo_apoyo_previo:members.some(member => member.tuvo_apoyo_previo),
        mejoras_previas:unique(members.flatMap(member => member.mejoras_previas || [])),
        mejoras_previas_ids:unique(members.flatMap(member => member.mejoras_previas_ids || [])),
        apoyos_recibidos_detalle:objects([...members, ...previous].flatMap(member => member.apoyos_recibidos_detalle || [])),
        registros_principales:objects([...members, ...previous].flatMap(member => member.registros_principales || [])),
        prioridades_123_2026:unique(members.flatMap(member => member.prioridades_123_2026 || [])),
        ubicaciones_por_verificar:source.ubicaciones_por_verificar || {}
      };
    });
    const missing = dataset.ccts.filter(record => !groupByCct.has(record.cct));
    if (missing.length) throw new Error('CCT sin asignación de inmueble: '+missing.map(record => record.cct).join(', '));
    dataset.inmuebles = groups;
    dataset.inmuebles_conteo = registry;
    dataset.inmuebleByCct = groupByCct;
    dataset.metadata = {...dataset.metadata,total_cct:dataset.ccts.length,total_inmuebles:groups.length,
      cct_georreferenciados:dataset.ccts.filter(mapped).length,
      inmuebles_georreferenciados:groups.filter(mapped).length,
      registros_sin_coordenadas:dataset.ccts.filter(record => !mapped(record)).length,
      cct_con_indice_final:dataset.ccts.filter(record => Number.isFinite(record.indice_prioridad_final)).length};
    dataset.programas = dataset.programas.map(program => ({...program,count:dataset.ccts.filter(record => record.programas.includes(program.id)).length}));
    return dataset;
  }

  function matchesCct(item, state) {
    const rankMin = state.rankMin === '' || state.rankMin == null ? null : Number(state.rankMin);
    const rankMax = state.rankMax === '' || state.rankMax == null ? null : Number(state.rankMax);
    if (state.alcaldia && clean(item.alcaldia) !== clean(state.alcaldia)) return false;
    if (state.nivel && !item.niveles.includes(state.nivel)) return false;
    if (state.prioridades?.length && !state.prioridades.includes(item.clase_prioridad_final)) return false;
    if (state.cct && !clean(item.cct).includes(clean(state.cct))) return false;
    if (state.nombre && !clean([item.nombre, ...(item.nombres || [])].join(' ')).includes(clean(state.nombre))) return false;
    if (rankMin !== null && (item.prioridad_123_2026 == null || item.prioridad_123_2026 < rankMin)) return false;
    if (rankMax !== null && (item.prioridad_123_2026 == null || item.prioridad_123_2026 > rankMax)) return false;
    if (state.programas?.length && !item.programas.some(id => state.programas.includes(id))) return false;
    if (state.mantenimiento?.length && !item.mantenimiento_pendientes.some(id => state.mantenimiento.includes(id))) return false;
    if (state.risk === 'obs_fractura' && !item.cercano_fracturamiento_250m) return false;
    if (state.risk === 'obs_subsidencia' && !item.subsidencia_alta) return false;
    if (state.risk === 'obs_combinada' && !(item.cercano_fracturamiento_250m && item.subsidencia_alta)) return false;
    return true;
  }
  const filterCcts = (dataset, state) => dataset.ccts.filter(record => matchesCct(record, state));
  function count(dataset, ccts) {
    return new Set(ccts.map(record => dataset.inmuebleByCct.get(typeof record === 'string' ? record : record.cct)).filter(Boolean)).size;
  }
  function groupsForCcts(dataset, records) {
    const selected = new Map();
    for (const record of records) {
      const id = dataset.inmuebleByCct.get(record.cct);
      if (!selected.has(id)) selected.set(id, []);
      selected.get(id).push(record);
    }
    return dataset.inmuebles.filter(group => selected.has(group.inmueble_master)).map(group => {
      const members = selected.get(group.inmueble_master), representative = best(members);
      return {...group,ccts_filtrados:members.map(member => member.cct),
        clase_prioridad_final:representative.clase_prioridad_final,
        indice_prioridad_final:representative.indice_prioridad_final};
    });
  }
  global.InmueblesMaster = {apply, matchesCct, filterCcts, count, groupsForCcts};
})(window);
