// ============================================================================
// 듀얼 지도 스튜디오 엔진: 3D 인터랙티브 지구본(Globe.gl) + 2D 구글 위성/지형(Leaflet)
// 실시간 효과: 주간/야간 지구본, 영토 투명도, 3D 파동 링(Ripple), 위경도선,
// 대기권 광채, 공전 속도, 구글 지도 비주얼 필터, 지역 텔레포트, 클릭 좌표 측정
// ============================================================================
window.HistoryMapEngine = (function () {
  let mode = '3d_day'; // '3d_day' | '3d_night' | 'google_hybrid' | 'google_sat' | 'google_terrain'
  let globeInstance = null;
  let leafletMap = null;
  let leafletTileLayer = null;
  let leafletOverlayGroup = null;
  let leafletClickLayer = null;
  let countryPickEnabled = true;
  let countryPickHandler = null;

  // 실시간 조절 옵션 상태
  const fx = {
    autoRotate: false,
    rotateSpeed: 0.45,
    showPolygons: true,
    polygonOpacity: 0.36,
    showArcs: true,
    showAtmosphere: true,
    showGraticules: true,
    googleFilter: 'normal' // 'normal' | 'cinematic' | 'vintage' | 'vivid'
  };

  let clickRings = [];

  let currentState = {
    focus: { lat: 37.5, lng: 127.0, altitude: 1.8 },
    territories: [],
    markers: [],
    arcs: [],
    title: '역사 · 지리 통합 지구본',
    subtitle: '시대 스냅샷·문명·전쟁·사건을 클릭하면 영토와 경로가 표시됩니다.'
  };

  const GLOBE_TEXTURES = {
    '3d_day': 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
    '3d_night': 'https://unpkg.com/three-globe/example/img/earth-night.jpg'
  };

  const GOOGLE_TILES = {
    google_hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    google_sat: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    google_terrain: 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'
  };

  // 원클릭 지역 텔레포트 프리셋
  const PRESETS = {
    korea: { lat: 37.5, lng: 127.2, altitude: 0.85, label: '한반도 중심 뷰' },
    east_asia: { lat: 36.5, lng: 118.0, altitude: 1.6, label: '동아시아 전역' },
    europe: { lat: 48.5, lng: 14.0, altitude: 1.45, label: '유럽 · 지중해' },
    mideast: { lat: 31.0, lng: 43.0, altitude: 1.55, label: '서아시아 · 중동' },
    pacific: { lat: 25.0, lng: 165.0, altitude: 2.25, label: '태평양 전역' },
    world: { lat: 28.0, lng: 60.0, altitude: 2.5, label: '유라시아 · 글로벌' }
  };

  function is3DMode() {
    return mode === '3d_day' || mode === '3d_night';
  }

  function hexToRgba(hex, alpha) {
    const clean = (hex || '#38bdf8').replace('#', '');
    if (clean.length !== 6) return `rgba(56,189,248,${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function updateCoordHud(lat, lng, note) {
    const el = document.getElementById('map-coord-readout');
    if (!el) return;
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    el.textContent = `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}${note ? ' · ' + note : ''}`;
  }

  // 1. 3D 지구본 초기화
  function initGlobe() {
    const container = document.getElementById('globe-container');
    if (!container || typeof Globe === 'undefined') return;

    const width = container.clientWidth || 760;
    const height = container.clientHeight || 480;

    globeInstance = Globe()(container)
      .width(width)
      .height(height)
      .backgroundColor('#05070d')
      .globeImageUrl(GLOBE_TEXTURES['3d_day'])
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(fx.showAtmosphere)
      .atmosphereColor('#38bdf8')
      .atmosphereAltitude(0.18)
      .showGraticules(fx.showGraticules)
      // 영토 폴리곤
      .polygonCapColor(d => hexToRgba(d.color || '#38bdf8', fx.polygonOpacity))
      .polygonSideColor(d => hexToRgba(d.color || '#38bdf8', Math.min(0.85, fx.polygonOpacity + 0.25)))
      .polygonStrokeColor(d => d.color || '#38bdf8')
      .polygonAltitude(0.016)
      .polygonLabel(d => `
        <div class="map-tooltip">
          <div class="map-tooltip-title" style="color:${d.color || '#38bdf8'}">${d.name}</div>
          ${d.desc ? `<div class="map-tooltip-desc">${d.desc}</div>` : ''}
        </div>
      `)
      // 마커 핀
      .pointLat('lat')
      .pointLng('lng')
      .pointColor(d => d.color || '#facc15')
      .pointAltitude(0.05)
      .pointRadius(0.52)
      .pointLabel(d => `
        <div class="map-tooltip">
          <div class="map-tooltip-title">${d.name}</div>
          <div class="map-tooltip-desc">${d.desc || ''}</div>
        </div>
      `)
      // 3D 아크 경로
      .arcStartLat('startLat')
      .arcStartLng('startLng')
      .arcEndLat('endLat')
      .arcEndLng('endLng')
      .arcColor(d => [d.color || '#38bdf8', '#fde047'])
      .arcDashLength(0.45)
      .arcDashGap(0.2)
      .arcDashAnimateTime(2000)
      .arcStroke(0.68)
      .arcLabel(d => `
        <div class="map-tooltip">
          <div class="map-tooltip-title">교류 · 진격 경로</div>
          <div class="map-tooltip-desc">${d.label || ''}</div>
        </div>
      `)
      // 3D 펄스 파동 링 (거점 강조 + 클릭 인터랙션)
      .ringLat('lat')
      .ringLng('lng')
      .ringColor(d => t => hexToRgba(d.color || '#38bdf8', Math.max(0, 1 - t)))
      .ringMaxRadius(d => d.maxR || 4.5)
      .ringPropagationSpeed(2.2)
      .ringRepeatPeriod(1400)
      // 지구본 클릭 시 파동 효과 + 좌표 표시 + 국가 역사 자동 연동
      .onGlobeClick(({ lat, lng }) => {
        clickRings = [{ lat, lng, color: '#fde047', maxR: 6 }];
        updateCoordHud(lat, lng, '선택 지점');
        refreshGlobeRings();
        if (countryPickEnabled && typeof countryPickHandler === 'function') {
          countryPickHandler(lat, lng, null);
        }
      })
      // 폴리곤 클릭 시 해당 국가 또는 좌표 연동
      .onPolygonClick((poly, event, coords) => {
        if (poly && poly.countryId && typeof countryPickHandler === 'function') {
          countryPickHandler(coords ? coords.lat : 0, coords ? coords.lng : 0, poly.countryId);
        } else if (countryPickEnabled && coords && typeof countryPickHandler === 'function') {
          countryPickHandler(coords.lat, coords.lng, null);
        }
      });

    const controls = globeInstance.controls();
    if (controls) {
      controls.autoRotate = fx.autoRotate;
      controls.autoRotateSpeed = fx.rotateSpeed;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
    }

    window.addEventListener('resize', handleResize);
  }

  function refreshGlobeRings() {
    if (!globeInstance) return;
    const markerRings = (currentState.markers || []).slice(0, 6).map(m => ({
      lat: m.lat,
      lng: m.lng,
      color: m.color || '#38bdf8',
      maxR: 3.2
    }));
    globeInstance.ringsData([...markerRings, ...clickRings]);
  }

  // 2. 2D 구글 위성/지형 지도 초기화
  function initLeaflet() {
    const container = document.getElementById('leaflet-container');
    if (!container || typeof L === 'undefined') return;

    leafletMap = L.map(container, {
      center: [37.5, 127.0],
      zoom: 4,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false
    });

    // 좌상단 HUD와 겹치지 않도록 우상단에 줌 컨트롤 배치
    L.control.zoom({ position: 'topright' }).addTo(leafletMap);

    leafletTileLayer = L.tileLayer(GOOGLE_TILES.google_hybrid, {
      attribution: 'Google Maps Satellite / Hybrid / Terrain',
      maxZoom: 18
    }).addTo(leafletMap);

    leafletOverlayGroup = L.layerGroup().addTo(leafletMap);
    leafletClickLayer = L.layerGroup().addTo(leafletMap);

    // 2D 구글 지도 클릭 시 펄스 마커 + 위경도 표시 + 국가 역사 자동 연동
    leafletMap.on('click', e => {
      const { lat, lng } = e.latlng;
      updateCoordHud(lat, lng, '구글 지도 클릭');
      leafletClickLayer.clearLayers();
      const pulseIcon = L.divIcon({
        className: 'leaflet-pulse-pin',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      L.marker([lat, lng], { icon: pulseIcon })
        .bindPopup(`<strong>선택 지점</strong><br>위도 ${lat.toFixed(3)}, 경도 ${lng.toFixed(3)}`)
        .addTo(leafletClickLayer);

      if (countryPickEnabled && typeof countryPickHandler === 'function') {
        countryPickHandler(lat, lng, null);
      }
    });

    leafletMap.on('mousemove', e => {
      updateCoordHud(e.latlng.lat, e.latlng.lng);
    });
  }

  function handleResize() {
    const globeEl = document.getElementById('globe-container');
    if (globeInstance && globeEl && globeEl.offsetParent !== null) {
      globeInstance.width(globeEl.clientWidth).height(globeEl.clientHeight);
    }
    if (leafletMap) {
      leafletMap.invalidateSize();
    }
  }

  // 3. 3D 지구본 데이터 반영
  function renderToGlobe(skipFly) {
    if (!globeInstance) return;

    const features = fx.showPolygons
      ? (currentState.territories || []).map(t => ({
          type: 'Feature',
          name: t.name,
          color: t.color,
          desc: t.desc || '',
          countryId: t.countryId || null,
          geometry: { type: 'Polygon', coordinates: t.coords }
        }))
      : [];

    globeInstance
      .polygonCapColor(d => hexToRgba(d.color || '#38bdf8', fx.polygonOpacity))
      .polygonSideColor(d => hexToRgba(d.color || '#38bdf8', Math.min(0.85, fx.polygonOpacity + 0.25)))
      .polygonsData(features)
      .pointsData(currentState.markers || [])
      .arcsData(fx.showArcs ? (currentState.arcs || []) : []);

    refreshGlobeRings();

    if (!skipFly && currentState.focus) {
      globeInstance.pointOfView({
        lat: currentState.focus.lat,
        lng: currentState.focus.lng,
        altitude: currentState.focus.altitude || 1.7
      }, 950);
      updateCoordHud(currentState.focus.lat, currentState.focus.lng);
    }
  }

  // 4. 2D 구글 지도 데이터 반영
  function renderToLeaflet(skipFly) {
    if (!leafletMap || !leafletOverlayGroup) return;
    leafletOverlayGroup.clearLayers();

    if (fx.showPolygons) {
      (currentState.territories || []).forEach(t => {
        const rings = (t.coords || []).map(ring => ring.map(([lng, lat]) => [lat, lng]));
        const poly = L.polygon(rings, {
          color: t.color || '#38bdf8',
          weight: 2,
          fillColor: t.color || '#38bdf8',
          fillOpacity: fx.polygonOpacity
        });
        poly.bindTooltip(`<strong>${t.name}</strong>${t.desc ? '<br>' + t.desc : ''}`, { sticky: true });
        if (t.countryId) {
          poly.on('click', ev => {
            L.DomEvent.stopPropagation(ev);
            if (typeof countryPickHandler === 'function') {
              countryPickHandler(ev.latlng.lat, ev.latlng.lng, t.countryId);
            }
          });
        }
        poly.addTo(leafletOverlayGroup);
      });
    }

    if (fx.showArcs) {
      (currentState.arcs || []).forEach(a => {
        const line = L.polyline(
          [[a.startLat, a.startLng], [a.endLat, a.endLng]],
          { color: a.color || '#fde047', weight: 2.6, dashArray: '7, 6', opacity: 0.92 }
        );
        if (a.label) line.bindTooltip(a.label, { sticky: true });
        line.addTo(leafletOverlayGroup);
      });
    }

    (currentState.markers || []).forEach(m => {
      const marker = L.circleMarker([m.lat, m.lng], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: m.color || '#facc15',
        fillOpacity: 0.96
      });
      marker.bindPopup(`<strong>${m.name}</strong><br><span style="font-size:12px;">${m.desc || ''}</span>`);
      marker.bindTooltip(m.name, { direction: 'top' });
      marker.addTo(leafletOverlayGroup);
    });

    if (!skipFly && currentState.focus) {
      const alt = currentState.focus.altitude || 1.7;
      let zoom = 4;
      if (alt <= 0.85) zoom = 7;
      else if (alt <= 1.35) zoom = 6;
      else if (alt <= 1.8) zoom = 5;
      else if (alt <= 2.3) zoom = 4;
      else zoom = 3;
      leafletMap.flyTo([currentState.focus.lat, currentState.focus.lng], zoom, { duration: 0.9 });
      updateCoordHud(currentState.focus.lat, currentState.focus.lng);
    }
  }

  function applyGoogleFilterClass() {
    const el = document.getElementById('leaflet-container');
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

  return {
    init() {
      initGlobe();
      initLeaflet();
      this.setMode('3d_day');
      applyGoogleFilterClass();
    },

    setMode(newMode) {
      mode = newMode;
      const globeEl = document.getElementById('globe-container');
      const leafletEl = document.getElementById('leaflet-container');

      if (is3DMode()) {
        if (globeEl) globeEl.style.display = 'block';
        if (leafletEl) leafletEl.style.display = 'none';
        if (globeInstance && GLOBE_TEXTURES[mode]) {
          globeInstance.globeImageUrl(GLOBE_TEXTURES[mode]);
          globeInstance.atmosphereColor(mode === '3d_night' ? '#818cf8' : '#38bdf8');
        }
        setTimeout(() => {
          handleResize();
          renderToGlobe(false);
        }, 40);
      } else {
        if (globeEl) globeEl.style.display = 'none';
        if (leafletEl) leafletEl.style.display = 'block';
        if (leafletMap && leafletTileLayer && GOOGLE_TILES[mode]) {
          leafletTileLayer.setUrl(GOOGLE_TILES[mode]);
        }
        applyGoogleFilterClass();
        setTimeout(() => {
          if (leafletMap) leafletMap.invalidateSize();
          renderToLeaflet(false);
        }, 40);
      }

      document.querySelectorAll('[data-map-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mapMode === mode);
      });
    },

    // 실시간 효과 토글 & 슬라이더 API
    setEffect(key, value) {
      fx[key] = value;
      if (key === 'autoRotate' && globeInstance && globeInstance.controls()) {
        globeInstance.controls().autoRotate = !!value;
      }
      if (key === 'rotateSpeed' && globeInstance && globeInstance.controls()) {
        globeInstance.controls().autoRotateSpeed = parseFloat(value) || 0.45;
      }
      if (key === 'showAtmosphere' && globeInstance) {
        globeInstance.showAtmosphere(!!value);
      }
      if (key === 'showGraticules' && globeInstance) {
        globeInstance.showGraticules(!!value);
      }
      if (key === 'googleFilter') {
        applyGoogleFilterClass();
      }
      if (key === 'showPolygons' || key === 'polygonOpacity' || key === 'showArcs') {
        if (is3DMode()) renderToGlobe(true);
        else renderToLeaflet(true);
      }
    },

    teleport(presetKey) {
      const p = PRESETS[presetKey];
      if (!p) return;
      currentState.focus = { lat: p.lat, lng: p.lng, altitude: p.altitude };
      if (is3DMode() && globeInstance) {
        globeInstance.pointOfView({ lat: p.lat, lng: p.lng, altitude: p.altitude }, 900);
      } else if (leafletMap) {
        const z = p.altitude <= 0.9 ? 7 : p.altitude <= 1.6 ? 5 : 3;
        leafletMap.flyTo([p.lat, p.lng], z, { duration: 0.9 });
      }
      updateCoordHud(p.lat, p.lng, p.label);
    },

    loadSnapshot(snapshot) {
      if (!snapshot) return;
      clickRings = [];
      currentState = {
        focus: snapshot.focus,
        territories: snapshot.territories || [],
        markers: snapshot.markers || [],
        arcs: snapshot.arcs || [],
        title: `[${snapshot.yearLabel}] ${snapshot.title}`,
        subtitle: snapshot.summary
      };
      updateHud();
      if (is3DMode()) renderToGlobe(false);
      else renderToLeaflet(false);
    },

    focusCivilization(civ) {
      if (!civ) return;
      clickRings = [];
      currentState = {
        focus: civ.center,
        territories: [{ name: civ.name, color: civ.color, coords: civ.polygon, desc: civ.period }],
        markers: (civ.sites || []).map(s => ({ ...s, color: civ.color })),
        arcs: [],
        title: `${civ.name} (${civ.period})`,
        subtitle: `${civ.region} · ${civ.river}`
      };
      updateHud();
      if (is3DMode()) renderToGlobe(false);
      else renderToLeaflet(false);
    },

    focusTimelinePair(item) {
      if (!item || !item.worldCoord) return;
      clickRings = [];
      const kr = { lat: 37.57, lng: 126.98, name: '한반도 (한국사)', desc: item.koreaTitle, color: '#38bdf8' };
      const wd = { lat: item.worldCoord.lat, lng: item.worldCoord.lng, name: item.worldCoord.name, desc: item.worldTitle, color: '#f59e0b' };
      currentState = {
        focus: { lat: (kr.lat + wd.lat) / 2, lng: (kr.lng + wd.lng) / 2, altitude: 2.1 },
        territories: [],
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
      if (is3DMode()) renderToGlobe(false);
      else renderToLeaflet(false);
    },

    focusPoint(lat, lng, name, desc, color = '#facc15') {
      clickRings = [{ lat, lng, color, maxR: 5 }];
      currentState = {
        focus: { lat, lng, altitude: 0.72 },
        territories: [],
        markers: [{ lat, lng, name, desc, color }],
        arcs: [],
        title: name,
        subtitle: desc
      };
      updateHud();
      if (is3DMode()) renderToGlobe(false);
      else renderToLeaflet(false);
    },

    setCountryPickHandler(fn) {
      countryPickHandler = fn;
    },

    setCountryPickEnabled(enabled) {
      countryPickEnabled = !!enabled;
    },

    // 특정 국가 선택 시 영토 하이라이트 + 파동 링 + 카메라 이동
    focusCountry(country) {
      if (!country) return;
      clickRings = [{ lat: country.center.lat, lng: country.center.lng, color: country.color, maxR: 5.5 }];
      currentState = {
        focus: country.center,
        territories: [{
          name: `${country.flag} ${country.name}`,
          color: country.color,
          coords: country.polygon,
          desc: `${country.continent} · 클릭하여 전체 통사 열람`,
          countryId: country.id
        }],
        markers: [{
          lat: country.center.lat,
          lng: country.center.lng,
          name: `${country.flag} ${country.name}`,
          desc: country.geography,
          color: country.color
        }],
        arcs: country.id !== 'korea' ? [{
          startLat: 37.57,
          startLng: 126.98,
          endLat: country.center.lat,
          endLng: country.center.lng,
          color: country.color,
          label: `한반도 ↔ ${country.name} 역사적 연결`
        }] : [],
        title: `${country.flag} ${country.name} 전체 역사`,
        subtitle: country.geography
      };
      updateHud();
      if (is3DMode()) renderToGlobe(false);
      else renderToLeaflet(false);
    },

    // 세계 18개국 클릭 탐색 레이어 전체 표시
    showAllCountries(countries) {
      if (!countries || !countries.length) return;
      clickRings = [];
      currentState = {
        focus: { lat: 34.0, lng: 55.0, altitude: 2.35 },
        territories: countries.map(c => ({
          name: `${c.flag} ${c.name}`,
          color: c.color,
          coords: c.polygon,
          desc: '클릭하면 이 나라의 전체 역사가 열립니다',
          countryId: c.id
        })),
        markers: countries.map(c => ({
          lat: c.center.lat,
          lng: c.center.lng,
          name: `${c.flag} ${c.name}`,
          desc: c.continent,
          color: c.color
        })),
        arcs: [],
        title: '세계 18개국 인터랙티브 역사 지구본',
        subtitle: '지도에서 원하는 나라를 클릭하면 그 나라의 고대~현대 전체 역사가 열립니다.'
      };
      updateHud();
      if (is3DMode()) renderToGlobe(false);
      else renderToLeaflet(false);
    },

    refreshSize() {
      handleResize();
    }
  };
})();
