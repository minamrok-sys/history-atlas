// ============================================================================
// 하이퀄리티 3D 구글 위성 지구본 엔진 (MapLibre GL JS v5 + Natural Earth 50m 정밀 국경선)
// - 구글 어스와 동일하게 3D 지구본 구면에 실제 Google Maps 위성 타일 실시간 스트리밍
// - 241개국 실제 정밀 해안선·국경선(TopoJSON 50m)으로 칼같은 영토/호버/클릭 구현
// - 3D 지구본 ↔ 2D 평면 지도 전환, Pitch(기울기)·Bearing(회전)·자동공전·대권항로 아크 지원
// ============================================================================
window.HistoryMapEngine = (function () {
  let map = null;
  let mapReady = false;
  let pendingAction = null;
  let allWorldGeoJSON = null;
  let isoToFeatureMap = {};
  let hoverPopup = null;
  let hoveredIsoId = null;
  let spinFrameId = null;
  let isUserInteracting = false;

  let countryPickEnabled = true;
  let countryPickHandler = null;

  // 현재 상태
  let projectionMode = 'globe'; // 'globe' | 'mercator'
  let basemapMode = 'google_hybrid'; // 'google_hybrid' | 'google_sat' | 'google_terrain' | 'carto_dark'

  const fx = {
    autoRotate: false,
    rotateSpeed: 0.35,
    showPolygons: true,
    showBaseBorders: true,
    polygonOpacity: 0.38,
    showArcs: true,
    pitch: 20,
    bearing: 0,
    googleFilter: 'normal'
  };

  let currentState = {
    focus: { lat: 36.0, lng: 115.0, zoom: 2.6 },
    territories: [],
    markers: [],
    arcs: [],
    title: '3D 구글 위성 역사 지구본',
    subtitle: '지구본에서 원하는 나라를 클릭하면 그 나라의 전체 역사가 열립니다.'
  };

  // 타일 소스 정의 (초고화질 구글 위성/하이브리드/지형 한국어 지명 + 다크 아틀라스)
  const BASEMAPS = {
    google_hybrid: {
      tiles: ['https://mt0.google.com/vt/lyrs=y&hl=ko&x={x}&y={y}&z={z}', 'https://mt1.google.com/vt/lyrs=y&hl=ko&x={x}&y={y}&z={z}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Google Satellite Hybrid (KO)'
    },
    google_sat: {
      tiles: ['https://mt0.google.com/vt/lyrs=s&hl=ko&x={x}&y={y}&z={z}', 'https://mt1.google.com/vt/lyrs=s&hl=ko&x={x}&y={y}&z={z}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Google Satellite'
    },
    google_terrain: {
      tiles: ['https://mt0.google.com/vt/lyrs=p&hl=ko&x={x}&y={y}&z={z}', 'https://mt1.google.com/vt/lyrs=p&hl=ko&x={x}&y={y}&z={z}'],
      tileSize: 256,
      maxzoom: 18,
      attribution: 'Google Terrain (KO)'
    },
    carto_dark: {
      tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', 'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'CARTO Dark Atlas'
    }
  };

  const PRESETS = {
    korea:     { lat: 36.8, lng: 127.6, zoom: 5.5, pitch: 28, label: '한반도 중심 뷰' },
    east_asia: { lat: 36.0, lng: 118.0, zoom: 3.4, pitch: 22, label: '동아시아 전역' },
    europe:    { lat: 48.0, lng: 13.0,  zoom: 3.6, pitch: 24, label: '유럽 · 지중해' },
    mideast:   { lat: 31.5, lng: 43.0,  zoom: 3.6, pitch: 20, label: '서아시아 · 중동' },
    pacific:   { lat: 24.0, lng: 162.0, zoom: 2.4, pitch: 12, label: '태평양 전역' },
    world:     { lat: 32.0, lng: 75.0,  zoom: 1.9, pitch: 10, label: '글로벌 전체' }
  };

  // altitude(구버전 호환) -> MapLibre zoom 변환
  function altToZoom(focus) {
    if (!focus) return 2.5;
    if (typeof focus.zoom === 'number') return focus.zoom;
    const alt = focus.altitude || 1.7;
    if (alt <= 0.78) return 7.2;
    if (alt <= 0.95) return 5.2;
    if (alt <= 1.25) return 4.3;
    if (alt <= 1.55) return 3.6;
    if (alt <= 1.90) return 2.9;
    if (alt <= 2.25) return 2.3;
    return 1.85;
  }

  function updateCoordHud(lat, lng, note) {
    const el = document.getElementById('map-coord-readout');
    if (!el) return;
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    el.textContent = `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}${note ? ' · ' + note : ''}`;
  }

  // 1. Natural Earth 50m TopoJSON -> 241개국 정밀 GeoJSON 변환 및 인덱싱
  function prepareWorldBorders() {
    if (allWorldGeoJSON) return;
    if (!window.WORLD_50M_TOPO || typeof topojson === 'undefined') {
      allWorldGeoJSON = { type: 'FeatureCollection', features: [] };
      return;
    }

    const fc = topojson.feature(window.WORLD_50M_TOPO, window.WORLD_50M_TOPO.objects.countries);
    const meta = (window.HistoryData && window.HistoryData.countryGeoMeta) || {};
    const koNames = (window.HistoryData && window.HistoryData.isoKoreanNames) || {};
    const countries = (window.HistoryData && window.HistoryData.countries) || [];

    // isoId -> 18개 핵심 역사 국가 매핑 역인덱스
    const isoToCountry = {};
    Object.keys(meta).forEach(cid => {
      const cObj = countries.find(x => x.id === cid);
      (meta[cid].isoIds || []).forEach(iso => {
        isoToCountry[String(iso).padStart(3, '0')] = cObj;
        isoToCountry[String(Number(iso))] = cObj;
      });
    });

    fc.features.forEach(f => {
      const rawId = String(f.id || '').padStart(3, '0');
      const matched = isoToCountry[rawId] || isoToCountry[String(Number(f.id))];
      const koName = koNames[rawId] || (matched ? matched.name : (f.properties && f.properties.name) || '');
      f.properties = {
        ...f.properties,
        isoId: rawId,
        koName,
        countryId: matched ? matched.id : '',
        isCoreCountry: matched ? 1 : 0,
        coreColor: matched ? matched.color : '#94a3b8'
      };
      isoToFeatureMap[rawId] = f;
    });

    allWorldGeoJSON = fc;
  }

  // 2. 두 위경도 사이 구면 대권항로(Great Circle) 부드러운 곡선 생성
  function createGreatCircleLine(startLng, startLat, endLng, endLat, steps = 48) {
    const toRad = d => (d * Math.PI) / 180;
    const toDeg = r => (r * 180) / Math.PI;

    const p1 = toRad(startLat), l1 = toRad(startLng);
    const p2 = toRad(endLat), l2 = toRad(endLng);

    const x1 = Math.cos(p1) * Math.cos(l1), y1 = Math.cos(p1) * Math.sin(l1), z1 = Math.sin(p1);
    const x2 = Math.cos(p2) * Math.cos(l2), y2 = Math.cos(p2) * Math.sin(l2), z2 = Math.sin(p2);

    const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
    const omega = Math.acos(dot);
    if (omega < 1e-5) return [[startLng, startLat], [endLng, endLat]];

    const sinOmega = Math.sin(omega);
    const coords = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = Math.sin((1 - t) * omega) / sinOmega;
      const b = Math.sin(t * omega) / sinOmega;
      const x = a * x1 + b * x2;
      const y = a * y1 + b * y2;
      const z = a * z1 + b * z2;
      const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
      const lng = toDeg(Math.atan2(y, x));
      coords.push([lng, lat]);
    }
    return coords;
  }

  // 3. 영토 목록 -> 실제 Natural Earth 50m 정밀 GeoJSON FeatureCollection 생성
  function buildTerritoriesGeoJSON(territories) {
    const features = [];
    const isoMap = (window.HistoryData && window.HistoryData.territoryIsoMap) || {};

    (territories || []).forEach(t => {
      const isoList = t.isoIds || isoMap[t.name];
      if (isoList && isoList.length) {
        isoList.forEach(rawIso => {
          const padIso = String(rawIso).padStart(3, '0');
          const baseF = isoToFeatureMap[padIso];
          if (baseF) {
            features.push({
              type: 'Feature',
              geometry: baseF.geometry,
              properties: {
                name: t.name,
                desc: t.desc || '',
                color: t.color || '#38bdf8',
                countryId: t.countryId || baseF.properties.countryId || '',
                isoId: padIso
              }
            });
          }
        });
      } else if (t.coords && t.coords.length) {
        // iso 매핑이 없는 예외 항목 폴백
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: t.coords },
          properties: {
            name: t.name,
            desc: t.desc || '',
            color: t.color || '#38bdf8',
            countryId: t.countryId || ''
          }
        });
      }
    });

    return { type: 'FeatureCollection', features };
  }

  function buildMarkersGeoJSON(markers) {
    return {
      type: 'FeatureCollection',
      features: (markers || []).map(m => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: {
          name: m.name || '',
          desc: m.desc || '',
          color: m.color || '#facc15'
        }
      }))
    };
  }

  function buildArcsGeoJSON(arcs) {
    return {
      type: 'FeatureCollection',
      features: (arcs || []).map(a => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: createGreatCircleLine(a.startLng, a.startLat, a.endLng, a.endLat, 48)
        },
        properties: {
          label: a.label || '',
          color: a.color || '#38bdf8'
        }
      }))
    };
  }

  // 4. MapLibre GL JS v5 초기화
  function initMap() {
    const container = document.getElementById('maplibre-container');
    if (!container || typeof maplibregl === 'undefined') return;

    prepareWorldBorders();

    const styleSources = {};
    const baseLayers = [];

    Object.keys(BASEMAPS).forEach(key => {
      styleSources[`base_${key}`] = {
        type: 'raster',
        tiles: BASEMAPS[key].tiles,
        tileSize: BASEMAPS[key].tileSize,
        maxzoom: BASEMAPS[key].maxzoom,
        attribution: BASEMAPS[key].attribution
      };
      baseLayers.push({
        id: `layer_${key}`,
        type: 'raster',
        source: `base_${key}`,
        layout: { visibility: key === basemapMode ? 'visible' : 'none' }
      });
    });

    map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        projection: { type: projectionMode },
        sky: {
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0]
        },
        sources: styleSources,
        layers: baseLayers
      },
      center: [115, 36],
      zoom: 2.5,
      pitch: fx.pitch,
      bearing: fx.bearing,
      maxPitch: 68,
      antialias: true
    });

    // 우상단 내비게이션(확대·축소·나침반 3D 회전 리셋) 컨트롤
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'atlas-popup'
    });

    map.on('style.load', () => {
      try {
        map.setProjection({ type: projectionMode });
      } catch (e) { /* ignore */ }
    });

    map.on('load', () => {
      mapReady = true;

      // (A) 전 세계 241개국 정밀 국경선 베이스 소스
      map.addSource('world-borders', { type: 'geojson', data: allWorldGeoJSON });

      // 투명 클릭/호버 히트 레이어 (전 세계 어느 나라나 감지)
      map.addLayer({
        id: 'world-hit-fill',
        type: 'fill',
        source: 'world-borders',
        paint: {
          'fill-color': '#ffffff',
          'fill-opacity': 0.001
        }
      });

      // 정밀 국경선 (은은한 위성 아틀라스 스타일)
      map.addLayer({
        id: 'world-base-line',
        type: 'line',
        source: 'world-borders',
        paint: {
          'line-color': 'rgba(255, 255, 255, 0.28)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 5, 1.1]
        }
      });

      // (B) 활성 영토/국가/문명/전쟁 정밀 폴리곤 레이어
      map.addSource('active-territories', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'active-territories-fill',
        type: 'fill',
        source: 'active-territories',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': fx.polygonOpacity
        }
      });

      map.addLayer({
        id: 'active-territories-line',
        type: 'line',
        source: 'active-territories',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.3, 5, 2.4],
          'line-opacity': 0.92
        }
      });

      // (C) 호버 글로우 하이라이트 레이어 (실제 국경선이 부드럽게 빛남)
      map.addLayer({
        id: 'world-hover-fill',
        type: 'fill',
        source: 'world-borders',
        filter: ['==', ['get', 'isoId'], '__none__'],
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': 0.22
        }
      });

      map.addLayer({
        id: 'world-hover-line',
        type: 'line',
        source: 'world-borders',
        filter: ['==', ['get', 'isoId'], '__none__'],
        paint: {
          'line-color': '#fef08a',
          'line-width': 2.5,
          'line-opacity': 0.95
        }
      });

      // (D) 대권항로 곡선 아크 (외곽 글로우 + 코어 라인)
      map.addSource('active-arcs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'active-arcs-glow',
        type: 'line',
        source: 'active-arcs',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 6,
          'line-blur': 5,
          'line-opacity': 0.45
        }
      });

      map.addLayer({
        id: 'active-arcs-core',
        type: 'line',
        source: 'active-arcs',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#fef08a',
          'line-width': 2.2,
          'line-dasharray': [2, 1.4],
          'line-opacity': 0.95
        }
      });

      // (E) 주요 도시·유적·격전지 글로우 포인트
      map.addSource('active-markers', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'active-markers-halo',
        type: 'circle',
        source: 'active-markers',
        paint: {
          'circle-radius': 11,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.28,
          'circle-blur': 0.6
        }
      });

      map.addLayer({
        id: 'active-markers-core',
        type: 'circle',
        source: 'active-markers',
        paint: {
          'circle-radius': 5.2,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.8
        }
      });

      // 인터랙션 바인딩
      bindMapInteractions();
      applyFilterClass();

      if (pendingAction) {
        const fn = pendingAction;
        pendingAction = null;
        fn();
      } else {
        renderCurrentState(false);
      }

      startSpinLoop();
    });
  }

  // 5. 마우스 호버·클릭·좌표 추적 인터랙션
  function bindMapInteractions() {
    if (!map) return;

    // 사용자 드래그 시 자동 공전 일시 정지
    map.on('mousedown', () => { isUserInteracting = true; });
    map.on('touchstart', () => { isUserInteracting = true; });
    map.on('mouseup', () => { isUserInteracting = false; });
    map.on('touchend', () => { isUserInteracting = false; });

    // 마커 호버
    map.on('mousemove', 'active-markers-core', e => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features && e.features[0];
      if (!f) return;
      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="map-tooltip">
            <div class="map-tooltip-title">${f.properties.name}</div>
            ${f.properties.desc ? `<div class="map-tooltip-desc">${f.properties.desc}</div>` : ''}
          </div>
        `)
        .addTo(map);
    });

    map.on('mouseleave', 'active-markers-core', () => {
      map.getCanvas().style.cursor = '';
      hoverPopup.remove();
    });

    // 전 세계 241개국 정밀 국경선 호버
    map.on('mousemove', 'world-hit-fill', e => {
      updateCoordHud(e.lngLat.lat, e.lngLat.lng);
      const markerHit = map.queryRenderedFeatures(e.point, { layers: ['active-markers-core'] });
      if (markerHit && markerHit.length) return;

      const f = e.features && e.features[0];
      if (!f) return;

      const isoId = f.properties.isoId;
      if (isoId !== hoveredIsoId) {
        hoveredIsoId = isoId;
        map.setFilter('world-hover-fill', ['==', ['get', 'isoId'], isoId]);
        map.setFilter('world-hover-line', ['==', ['get', 'isoId'], isoId]);
      }

      map.getCanvas().style.cursor = 'pointer';

      // 활성 영토에 속하면 영토명도 함께 표시
      const activeHit = map.queryRenderedFeatures(e.point, { layers: ['active-territories-fill'] });
      const activeName = activeHit && activeHit[0] ? activeHit[0].properties.name : '';
      const countryName = f.properties.koName || f.properties.name || '';
      const hasDetail = !!f.properties.countryId;

      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="map-tooltip">
            <div class="map-tooltip-title">${activeName || countryName}</div>
            <div class="map-tooltip-desc">${
              hasDetail
                ? '클릭하면 이 나라의 고대~현대 전체 역사가 열립니다'
                : (countryName ? `${countryName} · 클릭 시 인접 핵심 문명/국가 역사 탐색` : '')
            }</div>
          </div>
        `)
        .addTo(map);
    });

    map.on('mouseleave', 'world-hit-fill', () => {
      hoveredIsoId = null;
      map.setFilter('world-hover-fill', ['==', ['get', 'isoId'], '__none__']);
      map.setFilter('world-hover-line', ['==', ['get', 'isoId'], '__none__']);
      map.getCanvas().style.cursor = '';
      hoverPopup.remove();
    });

    // 지구본/지도 클릭 시 정밀 국가 경계 판별 -> 전체 통사 패널 오픈!
    map.on('click', e => {
      const { lat, lng } = e.lngLat;
      updateCoordHud(lat, lng, '선택 지점');
      if (!countryPickEnabled || typeof countryPickHandler !== 'function') return;

      const feats = map.queryRenderedFeatures(e.point, { layers: ['world-hit-fill'] });
      const clickedCountryId = feats && feats[0] && feats[0].properties.countryId ? feats[0].properties.countryId : null;
      countryPickHandler(lat, lng, clickedCountryId);
    });

    // 슬라이더와 Pitch/Bearing 실시간 동기화
    map.on('pitch', () => {
      const el = document.getElementById('fx-pitch');
      if (el) el.value = Math.round(map.getPitch());
    });
    map.on('rotate', () => {
      const el = document.getElementById('fx-bearing');
      if (el) el.value = Math.round(map.getBearing());
    });
  }

  // 부드러운 3D 지구본 자동 공전 루프
  function startSpinLoop() {
    if (spinFrameId) cancelAnimationFrame(spinFrameId);
    let lastTime = performance.now();
    function tick(now) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (map && mapReady && fx.autoRotate && !isUserInteracting && map.getZoom() < 4.8) {
        const center = map.getCenter();
        center.lng -= fx.rotateSpeed * 12 * dt;
        map.jumpTo({ center });
      }
      spinFrameId = requestAnimationFrame(tick);
    }
    spinFrameId = requestAnimationFrame(tick);
  }

  function applyFilterClass() {
    const el = document.getElementById('maplibre-container');
    if (!el) return;
    el.classList.remove('filter-normal', 'filter-cinematic', 'filter-vintage', 'filter-vivid');
    el.classList.add(`filter-${fx.googleFilter}`);
  }

  function updateHud() {
    const titleEl = document.getElementById('map-hud-title');
    const subEl = document.getElementById('map-hud-subtitle');
    const legendEl = document.getElementById('map-legend');
    if (titleEl) titleEl.textContent = currentState.title || '';
    if (subEl) subEl.textContent = currentState.subtitle || '';
    if (legendEl) {
      const items = (currentState.territories || []).slice(0, 6);
      legendEl.innerHTML = items.map(t => `
        <span class="legend-chip">
          <span class="legend-dot" style="background:${t.color || '#38bdf8'}"></span>
          ${t.name}
        </span>
      `).join('');
    }
  }

  function renderCurrentState(skipFly) {
    if (!map || !mapReady) return;

    const terrSrc = map.getSource('active-territories');
    const markSrc = map.getSource('active-markers');
    const arcSrc = map.getSource('active-arcs');

    if (terrSrc) {
      terrSrc.setData(fx.showPolygons ? buildTerritoriesGeoJSON(currentState.territories) : { type: 'FeatureCollection', features: [] });
    }
    if (markSrc) {
      markSrc.setData(buildMarkersGeoJSON(currentState.markers));
    }
    if (arcSrc) {
      arcSrc.setData(fx.showArcs ? buildArcsGeoJSON(currentState.arcs) : { type: 'FeatureCollection', features: [] });
    }

    if (map.getLayer('active-territories-fill')) {
      map.setPaintProperty('active-territories-fill', 'fill-opacity', fx.polygonOpacity);
    }
    if (map.getLayer('world-base-line')) {
      map.setLayoutProperty('world-base-line', 'visibility', fx.showBaseBorders ? 'visible' : 'none');
    }

    if (!skipFly && currentState.focus) {
      map.flyTo({
        center: [currentState.focus.lng, currentState.focus.lat],
        zoom: altToZoom(currentState.focus),
        pitch: typeof currentState.focus.pitch === 'number' ? currentState.focus.pitch : fx.pitch,
        speed: 1.15,
        curve: 1.35,
        essential: true
      });
      updateCoordHud(currentState.focus.lat, currentState.focus.lng);
    }
  }

  function runWhenReady(fn) {
    if (mapReady) fn();
    else pendingAction = fn;
  }

  return {
    init() {
      initMap();
    },

    // 투영 전환: 'globe' (3D 지구본) | 'mercator' (2D 평면 지도)
    setProjection(newProj) {
      projectionMode = newProj === 'mercator' ? 'mercator' : 'globe';
      document.querySelectorAll('[data-projection]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.projection === projectionMode);
      });
      if (map && mapReady) {
        try {
          map.setProjection({ type: projectionMode });
        } catch (e) { /* ignore */ }
      }
    },

    // 위성/지형 베이스맵 전환
    setMode(newBasemap) {
      if (!BASEMAPS[newBasemap]) return;
      basemapMode = newBasemap;
      document.querySelectorAll('[data-map-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mapMode === basemapMode);
      });
      if (map && mapReady) {
        Object.keys(BASEMAPS).forEach(key => {
          if (map.getLayer(`layer_${key}`)) {
            map.setLayoutProperty(`layer_${key}`, 'visibility', key === basemapMode ? 'visible' : 'none');
          }
        });
      }
    },

    // 실시간 효과 컨트롤 API
    setEffect(key, value) {
      fx[key] = value;
      if (key === 'googleFilter') applyFilterClass();
      if (key === 'pitch' && map && mapReady) map.easeTo({ pitch: parseFloat(value) || 0, duration: 250 });
      if (key === 'bearing' && map && mapReady) map.easeTo({ bearing: parseFloat(value) || 0, duration: 250 });
      if (key === 'showPolygons' || key === 'polygonOpacity' || key === 'showArcs' || key === 'showBaseBorders') {
        renderCurrentState(true);
      }
    },

    teleport(presetKey) {
      const p = PRESETS[presetKey];
      if (!p) return;
      currentState.focus = { lat: p.lat, lng: p.lng, zoom: p.zoom, pitch: p.pitch };
      if (map && mapReady) {
        map.flyTo({ center: [p.lng, p.lat], zoom: p.zoom, pitch: p.pitch, bearing: 0, speed: 1.2, essential: true });
      }
      updateCoordHud(p.lat, p.lng, p.label);
    },

    setCountryPickHandler(fn) {
      countryPickHandler = fn;
    },

    setCountryPickEnabled(enabled) {
      countryPickEnabled = !!enabled;
    },

    loadSnapshot(snapshot) {
      if (!snapshot) return;
      currentState = {
        focus: snapshot.focus,
        territories: snapshot.territories || [],
        markers: snapshot.markers || [],
        arcs: snapshot.arcs || [],
        title: `[${snapshot.yearLabel}] ${snapshot.title}`,
        subtitle: snapshot.summary
      };
      updateHud();
      runWhenReady(() => renderCurrentState(false));
    },

    focusCivilization(civ) {
      if (!civ) return;
      const civIsoMap = (window.HistoryData && window.HistoryData.civIsoMap) || {};
      currentState = {
        focus: civ.center,
        territories: [{
          name: civ.name,
          color: civ.color,
          isoIds: civIsoMap[civ.id],
          coords: civ.polygon,
          desc: civ.period
        }],
        markers: (civ.sites || []).map(s => ({ ...s, color: civ.color })),
        arcs: [],
        title: `${civ.name} (${civ.period})`,
        subtitle: `${civ.region} · ${civ.river}`
      };
      updateHud();
      runWhenReady(() => renderCurrentState(false));
    },

    focusTimelinePair(item) {
      if (!item || !item.worldCoord) return;
      const kr = { lat: 37.57, lng: 126.98, name: '한반도 (한국사)', desc: item.koreaTitle, color: '#38bdf8' };
      const wd = { lat: item.worldCoord.lat, lng: item.worldCoord.lng, name: item.worldCoord.name, desc: item.worldTitle, color: '#f59e0b' };
      currentState = {
        focus: { lat: (kr.lat + wd.lat) / 2, lng: (kr.lng + wd.lng) / 2, zoom: 2.3, pitch: 18 },
        territories: [{ name: '한반도 (한국사)', color: '#38bdf8', isoIds: ['410', '408'] }],
        markers: [kr, wd],
        arcs: [{
          startLat: kr.lat,
          startLng: kr.lng,
          endLat: wd.lat,
          endLng: wd.lng,
          color: '#38bdf8',
          label: `${item.year}: ${item.koreaTitle} ↔ ${item.worldTitle}`
        }],
        title: `[${item.year}] 동시대 한·세계 연결`,
        subtitle: item.connection
      };
      updateHud();
      runWhenReady(() => renderCurrentState(false));
    },

    focusCountry(country) {
      if (!country) return;
      const meta = (window.HistoryData && window.HistoryData.countryGeoMeta) || {};
      const isoIds = (meta[country.id] && meta[country.id].isoIds) || country.isoIds;
      currentState = {
        focus: { lat: country.center.lat, lng: country.center.lng, zoom: country.id === 'korea' ? 5.6 : 3.7, pitch: 26 },
        territories: [{
          name: country.name,
          color: country.color,
          isoIds,
          desc: `${country.continent} · 전체 통사 열람 중`,
          countryId: country.id
        }],
        markers: [{
          lat: country.center.lat,
          lng: country.center.lng,
          name: country.name,
          desc: country.geography,
          color: country.color
        }],
        arcs: country.id !== 'korea' ? [{
          startLat: 37.57,
          startLng: 126.98,
          endLat: country.center.lat,
          endLng: country.center.lng,
          color: country.color,
          label: `대한민국 ↔ ${country.name} 역사적 연결`
        }] : [],
        title: `${country.name} 전체 역사`,
        subtitle: country.geography
      };
      updateHud();
      runWhenReady(() => renderCurrentState(false));
    },

    showAllCountries(countries) {
      if (!countries || !countries.length) return;
      const meta = (window.HistoryData && window.HistoryData.countryGeoMeta) || {};
      currentState = {
        focus: { lat: 35.0, lng: 98.0, zoom: 2.35, pitch: 18 },
        territories: countries.map(c => ({
          name: c.name,
          color: c.color,
          isoIds: (meta[c.id] && meta[c.id].isoIds) || c.isoIds,
          desc: '클릭하면 이 나라의 고대~현대 전체 역사가 열립니다',
          countryId: c.id
        })),
        markers: countries.map(c => ({
          lat: c.center.lat,
          lng: c.center.lng,
          name: c.name,
          desc: c.continent,
          color: c.color
        })),
        arcs: [],
        title: '세계 18개국 초정밀 3D 위성 지구본',
        subtitle: '실제 국경선 위에서 원하는 나라를 클릭하면 그 나라의 고대~현대 전체 역사가 열립니다.'
      };
      updateHud();
      runWhenReady(() => renderCurrentState(false));
    },

    focusPoint(lat, lng, name, desc, color = '#facc15') {
      currentState = {
        focus: { lat, lng, zoom: 7.4, pitch: 38 },
        territories: [],
        markers: [{ lat, lng, name, desc, color }],
        arcs: [],
        title: name,
        subtitle: desc
      };
      updateHud();
      runWhenReady(() => renderCurrentState(false));
    },

    refreshSize() {
      if (map) map.resize();
    }
  };
})();
