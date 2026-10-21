'use strict';

(function exposeCctMaster(global) {
  const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
  const finite = value => value === null || value === undefined || value === ''
    ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null);

  const alcaldias = new Map([
    ['ALVARO OBREGON','Álvaro Obregón'], ['AZCAPOTZALCO','Azcapotzalco'],
    ['BENITO JUAREZ','Benito Juárez'], ['COYOACAN','Coyoacán'],
    ['CUAJIMALPA DE MORELOS','Cuajimalpa de Morelos'], ['CUAUHTEMOC','Cuauhtémoc'],
    ['GUSTAVO A. MADERO','Gustavo A. Madero'], ['IZTACALCO','Iztacalco'],
    ['IZTAPALAPA','Iztapalapa'], ['LA MAGDALENA CONTRERAS','La Magdalena Contreras'],
    ['MIGUEL HIDALGO','Miguel Hidalgo'], ['MILPA ALTA','Milpa Alta'],
    ['TLAHUAC','Tláhuac'], ['TLALPAN','Tlalpan'],
    ['VENUSTIANO CARRANZA','Venustiano Carranza'], ['XOCHIMILCO','Xochimilco']
  ]);

  const levels = new Map([
    ['primaria','Primaria'], ['preescolar','Preescolar'], ['secundaria','Secundaria'],
    ['educación inicial','Educación inicial'], ['inicial','Educación inicial'],
    ['especial','Especial'], ['especial - cam','Especial'], ['capep','CAPEP'], ['normal','Normal'],
    ['preescolar - comunitario','Preescolar - comunitario'],
    ['primaria - comunitaria','Primaria - comunitaria'],
    ['secundaria - comunitaria','Secundaria - comunitaria'],
    ['adultos - primaria','Adultos - primaria'], ['adultos - secundaria','Adultos - secundaria'],
    ['baja','Baja'], ['para adultos','Para adultos'], ['capacitación','Capacitación'],
    ['especial - otro','Especial - otro'], ['otro nivel educativo','Otro nivel educativo']
  ]);

  const excludedLevels = new Set(['Baja', 'Capacitación', 'CAPEP', 'Especial - otro', 'Para adultos']);

  function sentenceCase(value) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
    return text ? text.charAt(0).toLocaleUpperCase('es-MX') + text.slice(1) : '';
  }

  function canonicalAlcaldia(value) {
    return alcaldias.get(clean(value)) || sentenceCase(value);
  }

  function canonicalLevel(value) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return levels.get(text.toLocaleLowerCase('es-MX')) || sentenceCase(text);
  }

  function thematicDefaults() {
    return {
      prioridad_rm08:'Sin información', indice_rm08:null,
      prioridad_123_2026:null, prioridades_123_2026:[],
      distancia_fracturamiento_m:null, cercano_fracturamiento_250m:false,
      nivel_subsidencia:null, clase_subsidencia:'Sin información', subsidencia_alta:false,
      observacion_territorial:'Sin información', programas:[], programa_registros:[],
      registros_principales:[], prioridad_rm08_original:null, indice_rm08_original:null,
      nueva_base_coincidencias:0, nueva_base_idinmuebles:[],
      mantenimiento_disponible:false, mantenimiento_pendientes:[], mantenimiento_transformador:false,
      indice_mantenimiento:null, clase_mantenimiento:'Sin información', alerta_mantenimiento:'Sin información',
      nivel_fracturamiento:null, puntaje_fracturamiento:null, puntaje_subsidencia:null,
      indice_peligro_territorial:null, clase_peligro_territorial:'Sin información', calidad_peligro_territorial:'Sin información',
      indice_prioridad_final:null, clase_prioridad_final:'Sin información', calidad_indice_final:'Sin información',
      alerta_prioridad:'Sin información', tuvo_apoyo_previo:false, mejoras_previas:[], mejoras_previas_ids:[],
      apoyos_recibidos_detalle:[]
    };
  }

  function masterLevels(record, fallback = []) {
    const values = unique([...(record?.niveles || []), record?.nivel].map(canonicalLevel));
    return values.length ? values : unique(fallback.map(canonicalLevel));
  }

  function normalizeItem(item, turnCatalog) {
    let itemLevels = unique((item.niveles || [item.nivel]).map(canonicalLevel));
    if (item.tipo === 'cct' && itemLevels.includes('Para adultos')) {
      const adultLevels = unique((turnCatalog[item.cct] || [])
        .map(turn => canonicalLevel(turn.nivel))
        .filter(level => level === 'Adultos - primaria' || level === 'Adultos - secundaria'));
      if (adultLevels.length) itemLevels = unique([...itemLevels.filter(level => level !== 'Para adultos'), ...adultLevels]);
    }
    return {
      ...item,
      alcaldia: canonicalAlcaldia(item.alcaldia),
      nivel: itemLevels[0] || canonicalLevel(item.nivel),
      niveles: itemLevels
    };
  }

  function overlayCct(item, record, turnCatalog) {
    const normalized = normalizeItem(item, turnCatalog);
    if (!record) return normalized;
    const updatedLevels = masterLevels(record, normalized.niveles);
    const updatedName = record.nombre || normalized.nombre || `CCT ${item.cct}`;
    return {
      ...normalized,
      nombre: updatedName,
      nombres: [updatedName],
      alcaldia: record.alcaldia ? canonicalAlcaldia(record.alcaldia) : normalized.alcaldia,
      colonia: record.colonia || normalized.colonia,
      domicilio: record.domicilio || normalized.domicilio,
      nivel: updatedLevels[0] || normalized.nivel,
      niveles: updatedLevels.length ? updatedLevels : normalized.niveles,
      lat: finite(record.lat) ?? normalized.lat,
      lon: finite(record.lon) ?? normalized.lon,
      inmueble_cct: record.inmueble || normalized.inmueble_cct || '',
      sostenimiento: record.sostenimiento || normalized.sostenimiento || '',
      localidad: record.localidad || normalized.localidad || '',
      turnos: record.turnos || normalized.turnos || []
    };
  }

  function createCct(record, turnCatalog) {
    const cct = record.cct;
    const itemLevels = masterLevels(record);
    const name = record.nombre || `CCT ${cct}`;
    return normalizeItem({
      ...thematicDefaults(),
      uid:`cct:base-madre:${cct}`, tipo:'cct', codigo_dga:'', codigos_dga:[],
      cct, ccts:[cct], nombre:name, nombres:[name],
      alcaldia:record.alcaldia || '', colonia:record.colonia || '', domicilio:record.domicilio || '',
      nivel:itemLevels[0] || '', niveles:itemLevels,
      lon:finite(record.lon), lat:finite(record.lat),
      inmueble_cct:record.inmueble || '', sostenimiento:record.sostenimiento || '',
      localidad:record.localidad || '', turnos:record.turnos || []
    }, turnCatalog);
  }

  function updateInmueble(item, cctByKey, records, turnCatalog) {
    const normalized = normalizeItem(item, turnCatalog);
    const memberItems = normalized.ccts.map(cct => cctByKey.get(cct)).filter(Boolean);
    const updatedMembers = normalized.ccts.filter(cct => records[cct]).map(cct => cctByKey.get(cct)).filter(Boolean);
    if (!updatedMembers.length) return normalized;
    const names = unique(memberItems.map(member => member.nombre));
    const itemLevels = unique(memberItems.flatMap(member => member.niveles || []));
    const reference = updatedMembers.find(member => Number.isFinite(member.lat) && Number.isFinite(member.lon)) || updatedMembers[0];
    return {
      ...normalized,
      nombre:names[0] || normalized.nombre,
      nombres:names.length ? names : normalized.nombres,
      alcaldia:reference.alcaldia || normalized.alcaldia,
      colonia:reference.colonia || normalized.colonia,
      domicilio:reference.domicilio || normalized.domicilio,
      nivel:itemLevels[0] || normalized.nivel,
      niveles:itemLevels.length ? itemLevels : normalized.niveles,
      lat:Number.isFinite(reference.lat) ? reference.lat : normalized.lat,
      lon:Number.isFinite(reference.lon) ? reference.lon : normalized.lon
    };
  }

  function createInmueble(groupKey, members, turnCatalog) {
    const names = unique(members.map(member => member.nombre));
    const itemLevels = unique(members.flatMap(member => member.niveles || []));
    const reference = members.find(member => Number.isFinite(member.lat) && Number.isFinite(member.lon)) || members[0];
    const ccts = members.map(member => member.cct).sort();
    return normalizeItem({
      ...thematicDefaults(),
      uid:`inmueble:base-madre:${groupKey}`, tipo:'inmueble', codigo_dga:'', codigos_dga:[],
      cct:ccts[0], ccts, nombre:names[0] || `CCT ${ccts[0]}`, nombres:names,
      alcaldia:reference.alcaldia || '', colonia:reference.colonia || '', domicilio:reference.domicilio || '',
      nivel:itemLevels[0] || '', niveles:itemLevels,
      lon:reference.lon, lat:reference.lat
    }, turnCatalog);
  }

  function merge(main, catalog = {}) {
    const turnCatalog = catalog.ccts || {};
    const records = catalog.registros || {};
    const retainedKeys = new Set(catalog.cct_conservados || []);
    const allowedKeys = new Set([...Object.keys(records), ...retainedKeys]);
    const originalItems = main.ccts.filter(item => allowedKeys.has(item.cct));
    const originalKeys = new Set(originalItems.map(item => item.cct));
    const ccts = originalItems.map(item => overlayCct(item, records[item.cct], turnCatalog));
    const addedKeys = Object.keys(records).filter(cct => !originalKeys.has(cct));
    addedKeys.forEach(cct => ccts.push(createCct(records[cct], turnCatalog)));
    const cctByKey = new Map(ccts.map(item => [item.cct, item]));

    const inmuebles = main.inmuebles
      .map(item => ({...item, ccts:(item.ccts || []).filter(cct => allowedKeys.has(cct))}))
      .filter(item => item.ccts.length)
      .map(item => {
        const updated = updateInmueble({...item, cct:item.ccts[0]}, cctByKey, records, turnCatalog);
        const members = item.ccts.map(cct => cctByKey.get(cct)).filter(Boolean);
        const names = unique(members.map(member => member.nombre));
        const itemLevels = unique(members.flatMap(member => member.niveles || []));
        return {
          ...updated,
          cct:item.ccts[0],
          ccts:item.ccts,
          nombre:names[0] || updated.nombre,
          nombres:names.length ? names : updated.nombres,
          nivel:itemLevels[0] || updated.nivel,
          niveles:itemLevels.length ? itemLevels : updated.niveles
        };
      });
    const newGroups = new Map();
    addedKeys.forEach(cct => {
      const record = records[cct];
      const key = record.inmueble || `sin-inmueble-${cct}`;
      if (!newGroups.has(key)) newGroups.set(key, []);
      newGroups.get(key).push(cctByKey.get(cct));
    });
    newGroups.forEach((members, key) => inmuebles.push(createInmueble(key, members, turnCatalog)));

    const normalizedCctByKey = new Map(ccts.map(item => [item.cct, item]));
    const normalizedInmuebles = inmuebles.map(item => {
      if (!item.niveles.includes('Para adultos')) return item;
      const adultLevels = unique(item.ccts
        .flatMap(cct => normalizedCctByKey.get(cct)?.niveles || [])
        .filter(level => level === 'Adultos - primaria' || level === 'Adultos - secundaria'));
      return adultLevels.length ? {...item, nivel:adultLevels[0], niveles:adultLevels} : item;
    });

    const mappedCcts = ccts.filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon)).length;
    const mappedInmuebles = normalizedInmuebles.filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon)).length;
    return {
      ...main,
      metadata:{
        ...main.metadata,
        total_cct:ccts.length,
        cct_georreferenciados:mappedCcts,
        registros_sin_coordenadas:ccts.length - mappedCcts,
        total_inmuebles:normalizedInmuebles.length,
        inmuebles_georreferenciados:mappedInmuebles,
        fuente_catalogo_cct:catalog.metadata?.fuente || main.metadata?.fuente_catalogo_cct || '',
        nota_actualizacion:'Base Madre CCT actualizada; se conservaron los registros útiles y todos sus vínculos temáticos existentes.'
      },
      ccts,
      inmuebles:normalizedInmuebles
    };
  }

  global.CctMaster = {merge, canonicalAlcaldia, canonicalLevel, excludedLevels};
})(window);
