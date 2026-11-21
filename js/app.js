// ============================================================================
// 한·세계사 통합 지리·역사 아틀라스 메인 컨트롤러 (js/app.js)
// ChatGPT 스타일 좌측 사이드바 + 전역 통합 탐색 + 지도 클릭 국가 통사 + 1·2차 세계대전
// ============================================================================
(function () {
  const Data = window.HistoryData || {};
  const MapEngine = window.HistoryMapEngine;
  const FamilyTree = window.JoseonFamilyTree;

  // 앱 상태
  let activeTab = 'atlas';
  let currentSnapshotIndex = 1;
  let selectedCountryId = null;
  let selectedCivId = 'korea_ancient';
  let selectedWarId = 'ww1';
  let timelineEraFilter = '전체';
  let timelineQuery = '';
  let joseonPeriodFilter = '전체';
  let joseonQuery = '';
  let rulersSubTab = 'ancient';

  document.addEventListener('DOMContentLoaded', () => {
    bindSidebarAndNav();
    bindOmniSearch();
    bindMapStudioControls();
    bindModal();

    if (MapEngine) {
      MapEngine.init();
      // 지도 클릭 시 해당 국가 전체 역사 오픈 핸들러 등록
      MapEngine.setCountryPickHandler((lat, lng, explicitCountryId) => {
        const countries = Data.countries || [];
        let country = null;
        if (explicitCountryId) {
          country = countries.find(c => c.id === explicitCountryId);
        } else if (typeof Data.findCountryByLatLng === 'function') {
          country = Data.findCountryByLatLng(lat, lng);
        }
        if (country) {
          selectCountry(country.id, false);
        }
      });

      // 초기 화면: 세계 18개국 인터랙티브 폴리곤 + 기본 스냅샷 준비
      MapEngine.showAllCountries(Data.countries || []);
    }

    renderCountryChips();
    renderAtlasDetail();
    renderCivilizations();
    renderEras();
    renderTimeline();
    renderWorldWars();
    renderJoseonKings();
    renderKoreaRulers();

    if (FamilyTree) {
      FamilyTree.render('family-tree-canvas', openKingModal);
    }
  });

  // ==========================================================================
  // 1. 좌측 사이드바 및 8대 학습 모듈 네비게이션
  // ==========================================================================
  function bindSidebarAndNav() {
    const shell = document.getElementById('app-shell');
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    const closeMobileBtn = document.getElementById('btn-sidebar-close-mobile');
    const backdrop = document.getElementById('sidebar-backdrop');

    function toggleSidebar() {
      if (window.innerWidth <= 980) {
        shell.classList.toggle('mobile-open');
      } else {
        shell.classList.toggle('sidebar-collapsed');
        setTimeout(() => MapEngine && MapEngine.refreshSize(), 240);
      }
    }

    if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
    if (closeMobileBtn) closeMobileBtn.addEventListener('click', () => shell.classList.remove('mobile-open'));
    if (backdrop) backdrop.addEventListener('click', () => shell.classList.remove('mobile-open'));

    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab, btn.dataset.title);
        shell.classList.remove('mobile-open');
      });
    });

    // 가계도 줌
    const btnIn = document.getElementById('tree-zoom-in');
    const btnOut = document.getElementById('tree-zoom-out');
    const btnReset = document.getElementById('tree-zoom-reset');
    if (btnIn) btnIn.addEventListener('click', () => FamilyTree && FamilyTree.zoomIn());
    if (btnOut) btnOut.addEventListener('click', () => FamilyTree && FamilyTree.zoomOut());
    if (btnReset) btnReset.addEventListener('click', () => FamilyTree && FamilyTree.resetZoom());
  }

  function switchTab(tabId, customTitle) {
    activeTab = tabId;
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
      if (btn.dataset.tab === tabId && !customTitle) {
        customTitle = btn.dataset.title;
      }
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    });
    const titleEl = document.getElementById('topbar-current-title');
    if (titleEl && customTitle) titleEl.textContent = customTitle;

    // 제1·2차 세계대전 탭 진입 시 자동으로 해당 전쟁 지도 반영
    if (tabId === 'world-wars') {
      const war = (Data.worldWars || []).find(w => w.id === selectedWarId);
      if (war && MapEngine) MapEngine.loadSnapshot(war.mapSnapshot);
    }
  }

  // ==========================================================================
  // 2. ChatGPT 스타일 전역 통합 역사 탐색 바
  // ==========================================================================
  function bindOmniSearch() {
    const input = document.getElementById('omni-search-input');
    const clearBtn = document.getElementById('omni-clear-btn');
    const submitBtn = document.getElementById('omni-submit-btn');
    const resultsBox = document.getElementById('omni-results');
    if (!input || !resultsBox) return;

    function runSearch() {
      const q = input.value.trim().toLowerCase();
      if (clearBtn) clearBtn.classList.toggle('visible', q.length > 0);
      if (!q) {
        resultsBox.classList.remove('open');
        resultsBox.innerHTML = '';
        return;
      }

      const hits = [];

      // 1) 국가 18개국
      (Data.countries || []).forEach(c => {
        const hay = `${c.name} ${c.engName} ${c.continent} ${c.geography} ${c.keyFigures.join(' ')} ${c.eras.map(e => e.title + ' ' + e.desc).join(' ')}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            tag: `${c.flag} 국가 전체 역사`,
            title: c.name,
            desc: c.geography.slice(0, 74) + '...',
            action: () => {
              selectCountry(c.id, true);
              closeOmni();
            }
          });
        }
      });

      // 2) 제1·2차 세계대전
      (Data.worldWars || []).forEach(w => {
        const hay = `${w.title} ${w.shortName} ${w.period} ${w.summary} ${w.koreaLink} ${w.timeline.map(t => t.title + ' ' + t.desc).join(' ')}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            tag: '⚔️ 세계대전',
            title: `${w.shortName} (${w.period})`,
            desc: w.subtitle,
            action: () => {
              selectedWarId = w.id;
              switchTab('world-wars');
              renderWorldWars();
              if (MapEngine) MapEngine.loadSnapshot(w.mapSnapshot);
              closeOmni();
            }
          });
        }
      });

      // 3) 조선 27대 왕
      (Data.joseonKings || []).forEach(k => {
        const hay = `${k.num}대 ${k.name} ${k.personalName} ${k.reign} ${k.achievements.join(' ')} ${k.events} ${k.worldSync}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            tag: `👑 조선 제${k.num}대`,
            title: `${k.name} (${k.personalName}, ${k.reign})`,
            desc: (k.achievements[0] || k.events).slice(0, 72) + '...',
            action: () => {
              openKingModal(k.num);
              closeOmni();
            }
          });
        }
      });

      // 4) 세계 8대 문명
      (Data.civilizations || []).forEach(c => {
        const hay = `${c.name} ${c.region} ${c.river} ${c.geography} ${c.achievements.join(' ')}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            tag: '🏛️ 세계 문명',
            title: c.name,
            desc: `${c.period} · ${c.region}`,
            action: () => {
              selectedCivId = c.id;
              switchTab('civilizations');
              renderCivilizations();
              if (MapEngine) MapEngine.focusCivilization(c);
              closeOmni();
            }
          });
        }
      });

      // 5) 동시대 연대기
      (Data.timeline || []).forEach(t => {
        const hay = `${t.year} ${t.koreaTitle} ${t.koreaDesc} ${t.worldTitle} ${t.worldDesc} ${t.connection}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            tag: `⏳ 동시대 비교 (${t.year})`,
            title: `${t.koreaTitle} ↔ ${t.worldTitle}`,
            desc: t.connection.slice(0, 74) + '...',
            action: () => {
              switchTab('timeline');
              if (MapEngine) MapEngine.focusTimelinePair(t);
              closeOmni();
            }
          });
        }
      });

      // 6) 대한민국 대통령 & 고대 국왕
      (Data.presidents || []).forEach(p => {
        const hay = `${p.order} ${p.name} ${p.party} ${p.republic} ${p.keyEvents.join(' ')}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            tag: `🏛️ 대한민국 대통령`,
            title: `${p.order} ${p.name} (${p.term})`,
            desc: p.keyEvents[0].slice(0, 72) + '...',
            action: () => {
              rulersSubTab = 'presidents';
              switchTab('korea-rulers');
              syncRulerSubTabUI();
              renderKoreaRulers();
              closeOmni();
            }
          });
        }
      });

      (Data.ancientKings || []).forEach(k => {
        const hay = `${k.era} ${k.name} ${k.capital} ${k.achievements}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            tag: `👑 ${k.era} 국왕`,
            title: `${k.name} (${k.period})`,
            desc: k.achievements.slice(0, 72) + '...',
            action: () => {
              rulersSubTab = 'ancient';
              switchTab('korea-rulers');
              syncRulerSubTabUI();
              renderKoreaRulers();
              if (MapEngine) MapEngine.focusPoint(k.lat, k.lng, `${k.era} ${k.name}`, k.achievements, '#38bdf8');
              closeOmni();
            }
          });
        }
      });

      const shown = hits.slice(0, 12);
      resultsBox.classList.add('open');
      if (!shown.length) {
        resultsBox.innerHTML = `<div class="omni-results-head"><span>"${input.value}" 검색 결과가 없습니다.</span><button class="ghost-btn" id="omni-close-inner">닫기</button></div>`;
      } else {
        resultsBox.innerHTML = `
          <div class="omni-results-head">
            <span><strong>${hits.length}건</strong>의 역사·지리 기록을 찾았습니다 (상위 ${shown.length}건 표시 · 클릭 시 즉시 이동)</span>
            <button class="ghost-btn" id="omni-close-inner">닫기</button>
          </div>
          <div class="omni-grid">
            ${shown.map((h, i) => `
              <div class="omni-card" data-omni-idx="${i}">
                <span class="omni-tag">${h.tag}</span>
                <h4>${h.title}</h4>
                <p>${h.desc}</p>
              </div>
            `).join('')}
          </div>
        `;
        resultsBox.querySelectorAll('[data-omni-idx]').forEach(card => {
          card.addEventListener('click', () => {
            const item = shown[parseInt(card.dataset.omniIdx, 10)];
            if (item && item.action) item.action();
          });
        });
      }

      const closeInner = document.getElementById('omni-close-inner');
      if (closeInner) closeInner.addEventListener('click', closeOmni);
    }

    function closeOmni() {
      resultsBox.classList.remove('open');
    }

    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') runSearch();
      if (e.key === 'Escape') closeOmni();
    });
    if (submitBtn) submitBtn.addEventListener('click', runSearch);
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        runSearch();
        input.focus();
      });
    }
  }

  // ==========================================================================
  // 3. 지도 스튜디오 컨트롤 (5종 맵 모드 + 실시간 효과 + 텔레포트 + 확장 + 타임슬라이더)
  // ==========================================================================
  function bindMapStudioControls() {
    // 5종 맵 모드 (사이드바 퀵버튼 + 상단 툴바 동기화)
    document.querySelectorAll('[data-map-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (MapEngine) MapEngine.setMode(btn.dataset.mapMode);
      });
    });

    // 지도 접기/펼치기
    const toggleMapBtn = document.getElementById('btn-toggle-map');
    const mapStage = document.getElementById('map-stage-wrapper');
    if (toggleMapBtn && mapStage) {
      toggleMapBtn.addEventListener('click', () => {
        const collapsed = mapStage.classList.toggle('collapsed');
        toggleMapBtn.textContent = collapsed ? '지도 펼치기 ▼' : '지도 접기 ▲';
        if (!collapsed && MapEngine) setTimeout(() => MapEngine.refreshSize(), 120);
      });
    }

    // 지도 크게 보기(전체화면 확장)
    const expandBtn = document.getElementById('btn-map-expand');
    const heroSection = document.getElementById('map-hero-section');
    if (expandBtn && heroSection) {
      expandBtn.addEventListener('click', () => {
        const isExpanded = heroSection.classList.toggle('expanded');
        expandBtn.textContent = isExpanded ? '✕ 축소하기' : '⛶ 크게 보기';
        setTimeout(() => MapEngine && MapEngine.refreshSize(), 80);
      });
    }

    // 세계 18개국 인터랙티브 선택 레이어 복원 버튼
    const allCountriesBtn = document.getElementById('btn-show-all-countries');
    if (allCountriesBtn) {
      allCountriesBtn.addEventListener('click', () => {
        if (MapEngine) MapEngine.showAllCountries(Data.countries || []);
        ensureMapVisibleAndScroll();
      });
    }

    // 실시간 효과 토글 & 슬라이더 바인딩
    const bindCheck = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          if (key === 'countryPick') MapEngine && MapEngine.setCountryPickEnabled(el.checked);
          else MapEngine && MapEngine.setEffect(key, el.checked);
        });
      }
    };
    bindCheck('fx-country-pick', 'countryPick');
    bindCheck('fx-polygons', 'showPolygons');
    bindCheck('fx-arcs', 'showArcs');
    bindCheck('fx-atmosphere', 'showAtmosphere');
    bindCheck('fx-graticules', 'showGraticules');
    bindCheck('fx-autorotate', 'autoRotate');

    const opacitySlider = document.getElementById('fx-opacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', () => {
        MapEngine && MapEngine.setEffect('polygonOpacity', parseFloat(opacitySlider.value));
      });
    }

    const rotSlider = document.getElementById('fx-rot-speed');
    if (rotSlider) {
      rotSlider.addEventListener('input', () => {
        MapEngine && MapEngine.setEffect('rotateSpeed', parseFloat(rotSlider.value));
      });
    }

    const googleFilterSelect = document.getElementById('fx-google-filter');
    if (googleFilterSelect) {
      googleFilterSelect.addEventListener('change', () => {
        MapEngine && MapEngine.setEffect('googleFilter', googleFilterSelect.value);
      });
    }

    // 지역 원클릭 텔레포트
    document.querySelectorAll('[data-teleport]').forEach(btn => {
      btn.addEventListener('click', () => {
        MapEngine && MapEngine.teleport(btn.dataset.teleport);
      });
    });

    // 시대별 영토 타임슬라이더 (9단계)
    const sliderTrack = document.getElementById('era-slider-buttons');
    const snapshots = Data.mapSnapshots || [];
    if (sliderTrack) {
      sliderTrack.innerHTML = snapshots.map((snap, idx) => `
        <button class="era-tick-btn ${idx === currentSnapshotIndex ? 'active' : ''}" data-snap-idx="${idx}">
          <span class="tick-year">${snap.yearLabel}</span>
          <span class="tick-name">${snap.title.split('·')[0].trim()}</span>
        </button>
      `).join('');

      sliderTrack.querySelectorAll('[data-snap-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          loadSnapshotByIndex(parseInt(btn.dataset.snapIdx, 10));
        });
      });
    }
  }

  function ensureMapVisibleAndScroll() {
    const mapStage = document.getElementById('map-stage-wrapper');
    const toggleMapBtn = document.getElementById('btn-toggle-map');
    if (mapStage && mapStage.classList.contains('collapsed')) {
      mapStage.classList.remove('collapsed');
      if (toggleMapBtn) toggleMapBtn.textContent = '지도 접기 ▲';
      setTimeout(() => MapEngine && MapEngine.refreshSize(), 100);
    }
    const mapSection = document.getElementById('map-hero-section');
    if (mapSection) mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function loadSnapshotByIndex(idx) {
    const snapshots = Data.mapSnapshots || [];
    if (!snapshots[idx]) return;
    currentSnapshotIndex = idx;

    document.querySelectorAll('[data-snap-idx]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.snapIdx, 10) === idx);
    });

    if (MapEngine) MapEngine.loadSnapshot(snapshots[idx]);
    renderAtlasDetail();
  }

  // ==========================================================================
  // 4. 지도 클릭 연동 — 선택 국가 전체 역사 백과 패널
  // ==========================================================================
  function renderCountryChips() {
    const listEl = document.getElementById('country-chip-list');
    const countries = Data.countries || [];
    if (!listEl) return;

    listEl.innerHTML = countries.map(c => `
      <button class="country-chip ${c.id === selectedCountryId ? 'active' : ''}" data-country-id="${c.id}">
        ${c.flag} ${c.name.split(' ')[0]}
      </button>
    `).join('');

    listEl.querySelectorAll('[data-country-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectCountry(btn.dataset.countryId, true);
      });
    });
  }

  function selectCountry(countryId, scrollToPanel) {
    const countries = Data.countries || [];
    const country = countries.find(c => c.id === countryId);
    if (!country) return;
    selectedCountryId = countryId;

    // 칩 활성 상태 업데이트
    document.querySelectorAll('[data-country-id]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.countryId === countryId);
    });

    // 지도에 국가 영토 하이라이트 & 3D 아크(한국과 연결)
    if (MapEngine) MapEngine.focusCountry(country);

    // 국가 전체 역사 패널 렌더링
    const drawer = document.getElementById('country-history-drawer');
    if (!drawer) return;

    drawer.innerHTML = `
      <div class="country-history-panel" style="border-top: 3px solid ${country.color}">
        <div class="country-history-head">
          <div>
            <div class="country-title-row">
              <span class="country-flag-lg">${country.flag}</span>
              <div>
                <span class="card-badge" style="color:${country.color}">${country.continent} · 지도 선택 국가 전체 통사</span>
                <h2 style="font-size:1.3rem;">${country.name} <span style="font-size:0.86rem; color:#a1a1aa; font-weight:500;">(${country.engName})</span></h2>
              </div>
            </div>
            <p class="card-text" style="margin-top:10px; margin-bottom:0;"><strong>지리 · 지정학:</strong> ${country.geography}</p>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="ghost-btn" id="btn-country-all-map">🌐 18개국 전체 지도로</button>
            <button class="ghost-btn" id="btn-country-close">패널 닫기 ✕</button>
          </div>
        </div>

        <div class="callout-box" style="margin-top:0; margin-bottom:14px;">
          <strong>한국사와의 역사적 연결</strong>
          <p>${country.koreaLink}</p>
        </div>

        <div class="sub-heading">대표 역사 인물</div>
        <div class="figure-row">
          ${country.keyFigures.map(f => `<span class="figure-chip">${f}</span>`).join('')}
        </div>

        <div class="sub-heading" style="margin-top:16px;">${country.name} 고대 ~ 현대 전체 통사</div>
        <div class="country-era-timeline">
          ${country.eras.map(e => `
            <div class="country-era-card">
              <div class="country-era-period">${e.period}</div>
              <div class="country-era-title">${e.title}</div>
              <div class="country-era-desc">${e.desc}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const closeBtn = document.getElementById('btn-country-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        selectedCountryId = null;
        drawer.innerHTML = '';
        renderCountryChips();
      });
    }

    const allMapBtn = document.getElementById('btn-country-all-map');
    if (allMapBtn) {
      allMapBtn.addEventListener('click', () => {
        MapEngine && MapEngine.showAllCountries(Data.countries || []);
      });
    }

    if (scrollToPanel) {
      drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ==========================================================================
  // 5. [탭 1] 지리·영토 아틀라스 브리핑
  // ==========================================================================
  function renderAtlasDetail() {
    const box = document.getElementById('atlas-detail-content');
    const snap = (Data.mapSnapshots || [])[currentSnapshotIndex];
    if (!box || !snap) return;

    box.innerHTML = `
      <div class="atlas-grid">
        <div class="card">
          <div class="card-badge">${snap.yearLabel} 지정학 브리핑</div>
          <h3 class="card-title">${snap.title}</h3>
          <p class="card-text">${snap.summary}</p>
          <div class="callout-box">
            <strong>지리 · 지정학적 핵심 포인트</strong>
            <p>${snap.geopolitics}</p>
          </div>
        </div>
        <div class="card">
          <div class="card-badge">지도 위 주요 거점 & 영토</div>
          <h3 class="card-title">표시된 국가 · 문명 영역</h3>
          <div class="tag-list">
            ${(snap.territories || []).map(t => `
              <span class="color-pill" style="border-color:${t.color}; color:${t.color}">● ${t.name}</span>
            `).join('')}
          </div>
          <h4 class="sub-heading">주요 도시 · 유적 · 격전지 (클릭 시 확대)</h4>
          <div class="site-list">
            ${(snap.markers || []).map(m => `
              <button class="site-item-btn" data-lat="${m.lat}" data-lng="${m.lng}" data-name="${m.name}" data-desc="${m.desc}" data-color="${m.color}">
                <span class="site-dot" style="background:${m.color}"></span>
                <div>
                  <div class="site-name">${m.name}</div>
                  <div class="site-desc">${m.desc}</div>
                </div>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    box.querySelectorAll('.site-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (MapEngine) {
          MapEngine.focusPoint(
            parseFloat(btn.dataset.lat),
            parseFloat(btn.dataset.lng),
            btn.dataset.name,
            btn.dataset.desc,
            btn.dataset.color
          );
          ensureMapVisibleAndScroll();
        }
      });
    });
  }

  // ==========================================================================
  // 6. [탭 2] 문명별 탐구
  // ==========================================================================
  function renderCivilizations() {
    const listEl = document.getElementById('civ-card-list');
    const detailEl = document.getElementById('civ-detail-box');
    const civs = Data.civilizations || [];
    if (!listEl || !detailEl) return;

    listEl.innerHTML = civs.map(c => `
      <button class="civ-card ${c.id === selectedCivId ? 'active' : ''}" data-civ-id="${c.id}">
        <div class="civ-card-dot" style="background:${c.color}"></div>
        <div class="civ-card-name">${c.name}</div>
        <div class="civ-card-period">${c.period}</div>
        <div class="civ-card-region">${c.region}</div>
      </button>
    `).join('');

    listEl.querySelectorAll('[data-civ-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCivId = btn.dataset.civId;
        renderCivilizations();
        const civ = civs.find(x => x.id === selectedCivId);
        if (civ && MapEngine) MapEngine.focusCivilization(civ);
      });
    });

    const civ = civs.find(x => x.id === selectedCivId) || civs[0];
    if (!civ) return;

    detailEl.innerHTML = `
      <div class="card" style="border-top: 3px solid ${civ.color}">
        <div class="civ-detail-header">
          <div>
            <span class="card-badge" style="color:${civ.color}">${civ.period}</span>
            <h3 class="card-title">${civ.name}</h3>
            <p class="muted-line">발상지 · 지리 축: <strong>${civ.region}</strong> | ${civ.river}</p>
          </div>
          <button class="primary-btn" id="btn-civ-fly">지구본에서 영토 보기</button>
        </div>

        <div class="two-col-detail">
          <div>
            <h4 class="sub-heading">지리적 환경과 문명의 성격</h4>
            <p class="card-text">${civ.geography}</p>
            <div class="callout-box">
              <strong>동시대 한국사와의 연결</strong>
              <p>${civ.koreaLink}</p>
            </div>
          </div>
          <div>
            <h4 class="sub-heading">핵심 문화유산 · 제도 · 발명</h4>
            <ul class="bullet-list">
              ${civ.achievements.map(a => `<li>${a}</li>`).join('')}
            </ul>
            <h4 class="sub-heading">주요 유적지 (클릭 시 지도로 이동)</h4>
            <div class="site-list">
              ${civ.sites.map(s => `
                <button class="site-item-btn" data-lat="${s.lat}" data-lng="${s.lng}" data-name="${s.name}" data-desc="${s.desc}" data-color="${civ.color}">
                  <span class="site-dot" style="background:${civ.color}"></span>
                  <div>
                    <div class="site-name">${s.name}</div>
                    <div class="site-desc">${s.desc}</div>
                  </div>
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const flyBtn = document.getElementById('btn-civ-fly');
    if (flyBtn) {
      flyBtn.addEventListener('click', () => {
        if (MapEngine) {
          MapEngine.focusCivilization(civ);
          ensureMapVisibleAndScroll();
        }
      });
    }

    detailEl.querySelectorAll('.site-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (MapEngine) {
          MapEngine.focusPoint(
            parseFloat(btn.dataset.lat),
            parseFloat(btn.dataset.lng),
            btn.dataset.name,
            btn.dataset.desc,
            btn.dataset.color
          );
          ensureMapVisibleAndScroll();
        }
      });
    });
  }

  // ==========================================================================
  // 7. [탭 3] 시대별 한국사 & 세계사
  // ==========================================================================
  function renderEras() {
    const krBox = document.getElementById('korean-eras-list');
    const wdBox = document.getElementById('world-eras-list');
    const snapshots = Data.mapSnapshots || [];

    if (krBox) {
      krBox.innerHTML = (Data.koreanEras || []).map((e, i) => `
        <div class="era-card">
          <div class="era-card-top">
            <span class="era-num">${String(i + 1).padStart(2, '0')}</span>
            <div>
              <div class="era-period">${e.period}</div>
              <h4 class="era-name">${e.name}</h4>
            </div>
            <button class="ghost-btn" data-jump-snap="${e.snapshotId}">지도 보기</button>
          </div>
          <p class="card-text">${e.summary}</p>
          <p class="territory-note"><strong>영토·지리:</strong> ${e.territoryNote}</p>
          <div class="keyword-row">
            ${e.keywords.map(k => `<span class="kw-chip">${k}</span>`).join('')}
          </div>
        </div>
      `).join('');
    }

    if (wdBox) {
      wdBox.innerHTML = (Data.worldEras || []).map((e, i) => `
        <div class="era-card world-accent">
          <div class="era-card-top">
            <span class="era-num world">${String(i + 1).padStart(2, '0')}</span>
            <div>
              <div class="era-period">${e.period}</div>
              <h4 class="era-name">${e.name}</h4>
            </div>
            <button class="ghost-btn" data-jump-snap="${e.snapshotId}">지도 보기</button>
          </div>
          <p class="card-text">${e.summary}</p>
          <div class="keyword-row">
            ${e.keywords.map(k => `<span class="kw-chip">${k}</span>`).join('')}
          </div>
        </div>
      `).join('');
    }

    document.querySelectorAll('[data-jump-snap]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = snapshots.findIndex(s => s.id === btn.dataset.jumpSnap);
        if (idx >= 0) {
          loadSnapshotByIndex(idx);
          ensureMapVisibleAndScroll();
        }
      });
    });
  }

  // ==========================================================================
  // 8. [탭 4] 동시대 한국사 vs 세계사
  // ==========================================================================
  function renderTimeline() {
    const filterEl = document.getElementById('timeline-filters');
    const searchEl = document.getElementById('timeline-search');
    const listEl = document.getElementById('timeline-list');
    if (!listEl) return;

    if (filterEl && !filterEl.dataset.ready) {
      const eras = ['전체', '고대', '중세', '근세', '근대', '현대'];
      filterEl.innerHTML = eras.map(er => `
        <button class="filter-pill ${er === timelineEraFilter ? 'active' : ''}" data-tl-era="${er}">${er}</button>
      `).join('');
      filterEl.dataset.ready = '1';

      filterEl.querySelectorAll('[data-tl-era]').forEach(btn => {
        btn.addEventListener('click', () => {
          timelineEraFilter = btn.dataset.tlEra;
          filterEl.querySelectorAll('[data-tl-era]').forEach(b => b.classList.toggle('active', b === btn));
          renderTimeline();
        });
      });

      if (searchEl) {
        searchEl.addEventListener('input', e => {
          timelineQuery = e.target.value.trim().toLowerCase();
          renderTimeline();
        });
      }
    }

    const items = (Data.timeline || []).filter(item => {
      const matchEra = timelineEraFilter === '전체' || item.era.includes(timelineEraFilter);
      const text = `${item.year} ${item.koreaTitle} ${item.koreaDesc} ${item.worldTitle} ${item.worldDesc} ${item.connection}`.toLowerCase();
      return matchEra && (!timelineQuery || text.includes(timelineQuery));
    });

    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state">검색 조건에 맞는 연대기 항목이 없습니다.</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="tl-row">
        <div class="tl-year-bar">
          <span class="tl-era-tag">${item.era}</span>
          <span class="tl-year-text">${item.year}</span>
          <button class="ghost-btn" data-tl-fly="${item.id}">지구본 연결 보기</button>
        </div>
        <div class="tl-dual-grid">
          <div class="tl-side korea">
            <div class="tl-side-label">한국사</div>
            <h4>${item.koreaTitle}</h4>
            <p>${item.koreaDesc}</p>
          </div>
          <div class="tl-side world">
            <div class="tl-side-label">동시대 세계사</div>
            <h4>${item.worldTitle}</h4>
            <p>${item.worldDesc}</p>
          </div>
        </div>
        <div class="tl-connection">
          <strong>역사적 연결고리:</strong> ${item.connection}
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-tl-fly]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = (Data.timeline || []).find(x => x.id === btn.dataset.tlFly);
        if (item && MapEngine) {
          MapEngine.focusTimelinePair(item);
          ensureMapVisibleAndScroll();
        }
      });
    });
  }

  // ==========================================================================
  // 9. [탭 5] 제1차 · 제2차 세계대전
  // ==========================================================================
  function renderWorldWars() {
    const switcherEl = document.getElementById('war-switcher');
    const detailEl = document.getElementById('war-detail-content');
    const wars = Data.worldWars || [];
    if (!switcherEl || !detailEl || !wars.length) return;

    switcherEl.innerHTML = wars.map(w => `
      <button class="war-tab-btn ${w.id === selectedWarId ? 'active' : ''}" data-war-id="${w.id}">
        <div class="war-tab-title">${w.title}</div>
        <div class="war-tab-sub">${w.period} · ${w.subtitle}</div>
      </button>
    `).join('');

    switcherEl.querySelectorAll('[data-war-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedWarId = btn.dataset.warId;
        renderWorldWars();
        const war = wars.find(x => x.id === selectedWarId);
        if (war && MapEngine) MapEngine.loadSnapshot(war.mapSnapshot);
      });
    });

    const war = wars.find(w => w.id === selectedWarId) || wars[0];

    detailEl.innerHTML = `
      <div class="card" style="border-top: 3px solid ${war.color}">
        <div class="civ-detail-header">
          <div>
            <span class="card-badge" style="color:${war.color}">${war.period}</span>
            <h3 class="card-title">${war.title}</h3>
            <p class="muted-line">${war.subtitle}</p>
          </div>
          <button class="primary-btn" id="btn-war-fly">지구본에서 전선·격전지 보기</button>
        </div>

        <p class="card-text">${war.summary}</p>

        <div class="faction-grid">
          ${war.factions.map(f => `
            <div class="faction-card" style="border-left: 3px solid ${f.color}">
              <h4 style="color:${f.color}">${f.name}</h4>
              <p>${f.members}</p>
            </div>
          `).join('')}
        </div>

        <div class="two-col-detail" style="margin-top:14px;">
          <div>
            <h4 class="sub-heading">발발 원인 및 배경</h4>
            <p class="card-text">${war.cause}</p>

            <div class="callout-box">
              <strong>동시대 한국사와의 결정적 연결</strong>
              <p>${war.koreaLink}</p>
            </div>

            <h4 class="sub-heading">결과 및 세계사적 영향</h4>
            <p class="card-text">${war.result}</p>

            <h4 class="sub-heading">주요 격전지 · 거점 (클릭 시 지도로 이동)</h4>
            <div class="site-list">
              ${(war.mapSnapshot.markers || []).map(m => `
                <button class="site-item-btn" data-lat="${m.lat}" data-lng="${m.lng}" data-name="${m.name}" data-desc="${m.desc}" data-color="${m.color}">
                  <span class="site-dot" style="background:${m.color}"></span>
                  <div>
                    <div class="site-name">${m.name}</div>
                    <div class="site-desc">${m.desc}</div>
                  </div>
                </button>
              `).join('')}
            </div>
          </div>

          <div>
            <h4 class="sub-heading">핵심 전개 연표</h4>
            <div class="war-timeline-list">
              ${war.timeline.map(t => `
                <div class="war-tl-item">
                  <div class="war-tl-year">${t.year}</div>
                  <div class="war-tl-title">${t.title}</div>
                  <div class="war-tl-desc">${t.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const flyBtn = document.getElementById('btn-war-fly');
    if (flyBtn) {
      flyBtn.addEventListener('click', () => {
        if (MapEngine) {
          MapEngine.loadSnapshot(war.mapSnapshot);
          ensureMapVisibleAndScroll();
        }
      });
    }

    detailEl.querySelectorAll('.site-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (MapEngine) {
          MapEngine.focusPoint(
            parseFloat(btn.dataset.lat),
            parseFloat(btn.dataset.lng),
            btn.dataset.name,
            btn.dataset.desc,
            btn.dataset.color
          );
          ensureMapVisibleAndScroll();
        }
      });
    });
  }

  // ==========================================================================
  // 10. [탭 6] 조선 27대 왕 상세 업적
  // ==========================================================================
  function renderJoseonKings() {
    const filterEl = document.getElementById('joseon-filters');
    const searchEl = document.getElementById('joseon-search');
    const gridEl = document.getElementById('joseon-kings-grid');
    if (!gridEl) return;

    if (filterEl && !filterEl.dataset.ready) {
      const periods = ['전체', '전기', '중기', '후기', '대한제국'];
      filterEl.innerHTML = periods.map(p => `
        <button class="filter-pill ${p === joseonPeriodFilter ? 'active' : ''}" data-js-period="${p}">${p}</button>
      `).join('');
      filterEl.dataset.ready = '1';

      filterEl.querySelectorAll('[data-js-period]').forEach(btn => {
        btn.addEventListener('click', () => {
          joseonPeriodFilter = btn.dataset.jsPeriod;
          filterEl.querySelectorAll('[data-js-period]').forEach(b => b.classList.toggle('active', b === btn));
          renderJoseonKings();
        });
      });

      if (searchEl) {
        searchEl.addEventListener('input', e => {
          joseonQuery = e.target.value.trim().toLowerCase();
          renderJoseonKings();
        });
      }
    }

    const kings = (Data.joseonKings || []).filter(k => {
      const matchP = joseonPeriodFilter === '전체' || k.period === joseonPeriodFilter;
      const text = `${k.num}대 ${k.name} ${k.personalName} ${k.reign} ${k.achievements.join(' ')} ${k.events} ${k.worldSync}`.toLowerCase();
      return matchP && (!joseonQuery || text.includes(joseonQuery));
    });

    gridEl.innerHTML = kings.map(k => `
      <div class="king-card" data-open-king="${k.num}">
        <div class="king-card-head">
          <span class="king-order">제${k.num}대</span>
          <span class="king-period-badge">${k.period}</span>
        </div>
        <h4 class="king-name">${k.name}</h4>
        <div class="king-meta">${k.personalName} · ${k.reign}</div>
        <p class="king-preview">${k.achievements[0] || k.events}</p>
        <div class="king-card-foot">
          <span class="king-world-mini">동시대: ${k.worldSync.slice(0, 28)}...</span>
          <span class="king-more-link">상세 업적 →</span>
        </div>
      </div>
    `).join('');

    gridEl.querySelectorAll('[data-open-king]').forEach(card => {
      card.addEventListener('click', () => openKingModal(parseInt(card.dataset.openKing, 10)));
    });
  }

  function openKingModal(kingNum) {
    const king = (Data.joseonKings || []).find(k => k.num === kingNum);
    const modal = document.getElementById('detail-modal');
    const body = document.getElementById('detail-modal-body');
    if (!king || !modal || !body) return;

    body.innerHTML = `
      <div class="modal-king-header">
        <div>
          <span class="card-badge">조선 제${king.num}대 국왕 · ${king.period}</span>
          <h2>${king.name} <span class="modal-subname">(${king.personalName})</span></h2>
          <p class="muted-line">재위 기간: <strong>${king.reign}</strong></p>
        </div>
        <button class="primary-btn" id="btn-modal-tomb">왕릉 위치 지도 보기</button>
      </div>

      <div class="modal-section">
        <h4>즉위 배경 및 계승</h4>
        <p>${king.succession}</p>
      </div>

      <div class="modal-section">
        <h4>핵심 업적 및 제도</h4>
        <ul class="bullet-list">
          ${king.achievements.map(a => `<li>${a}</li>`).join('')}
        </ul>
      </div>

      <div class="modal-section">
        <h4>주요 역사적 사건</h4>
        <p>${king.events}</p>
      </div>

      <div class="modal-section world-box">
        <h4>동시대 세계사 흐름</h4>
        <p>${king.worldSync}</p>
      </div>

      <div class="modal-section">
        <h4>능(왕릉) 위치</h4>
        <p>${king.tomb.name} (위도 ${king.tomb.lat}, 경도 ${king.tomb.lng})</p>
      </div>

      <div class="modal-nav-row">
        ${king.num > 1 ? `<button class="ghost-btn" id="btn-prev-king">← 제${king.num - 1}대 이전 왕</button>` : '<span></span>'}
        ${king.num < 27 ? `<button class="ghost-btn" id="btn-next-king">제${king.num + 1}대 다음 왕 →</button>` : '<span></span>'}
      </div>
    `;

    modal.classList.add('open');

    const tombBtn = document.getElementById('btn-modal-tomb');
    if (tombBtn) {
      tombBtn.addEventListener('click', () => {
        modal.classList.remove('open');
        if (MapEngine) {
          MapEngine.focusPoint(
            king.tomb.lat,
            king.tomb.lng,
            `${king.name} - ${king.tomb.name}`,
            `조선 제${king.num}대 (${king.reign})`,
            '#eab308'
          );
          ensureMapVisibleAndScroll();
        }
      });
    }

    const prevBtn = document.getElementById('btn-prev-king');
    const nextBtn = document.getElementById('btn-next-king');
    if (prevBtn) prevBtn.addEventListener('click', () => openKingModal(king.num - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => openKingModal(king.num + 1));
  }

  function bindModal() {
    const modal = document.getElementById('detail-modal');
    const closeBtn = document.getElementById('detail-modal-close');
    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.remove('open');
      });
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal) modal.classList.remove('open');
    });
  }

  // ==========================================================================
  // 11. [탭 8] 역대 국왕 · 대통령 · 정당사
  // ==========================================================================
  function syncRulerSubTabUI() {
    const subTabsEl = document.getElementById('rulers-subtabs');
    if (!subTabsEl) return;
    subTabsEl.querySelectorAll('[data-rulers-sub]').forEach(b => {
      b.classList.toggle('active', b.dataset.rulersSub === rulersSubTab);
    });
  }

  function renderKoreaRulers() {
    const subTabsEl = document.getElementById('rulers-subtabs');
    const contentEl = document.getElementById('rulers-content');
    if (!contentEl) return;

    if (subTabsEl && !subTabsEl.dataset.ready) {
      subTabsEl.querySelectorAll('[data-rulers-sub]').forEach(btn => {
        btn.addEventListener('click', () => {
          rulersSubTab = btn.dataset.rulersSub;
          syncRulerSubTabUI();
          renderKoreaRulers();
        });
      });
      subTabsEl.dataset.ready = '1';
    }

    if (rulersSubTab === 'ancient') {
      contentEl.innerHTML = `
        <div class="rulers-grid">
          ${(Data.ancientKings || []).map(k => `
            <div class="ruler-card">
              <div class="ruler-top">
                <span class="era-pill">${k.era}</span>
                <span class="ruler-period">${k.period}</span>
              </div>
              <h4>${k.name}</h4>
              <p class="card-text">${k.achievements}</p>
              <div class="ruler-foot">
                <span>도읍: ${k.capital}</span>
                <button class="ghost-btn" data-ruler-fly data-lat="${k.lat}" data-lng="${k.lng}" data-name="${k.era} ${k.name} (${k.capital})" data-desc="${k.achievements}">지도 위치</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      contentEl.querySelectorAll('[data-ruler-fly]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (MapEngine) {
            MapEngine.focusPoint(
              parseFloat(btn.dataset.lat),
              parseFloat(btn.dataset.lng),
              btn.dataset.name,
              btn.dataset.desc,
              '#38bdf8'
            );
            ensureMapVisibleAndScroll();
          }
        });
      });
    } else if (rulersSubTab === 'presidents') {
      contentEl.innerHTML = `
        <div class="president-list">
          ${(Data.presidents || []).map(p => `
            <div class="president-card" style="border-left: 4px solid ${p.partyColor}">
              <div class="president-head">
                <div>
                  <span class="pres-order">${p.order}</span>
                  <h4 class="pres-name">${p.name}</h4>
                  <span class="pres-republic">${p.republic}</span>
                </div>
                <div class="pres-meta">
                  <span class="pres-term">${p.term}</span>
                  <span class="pres-party" style="background:${p.partyColor}22; color:${p.partyColor}; border-color:${p.partyColor}55">${p.party}</span>
                </div>
              </div>
              <ul class="bullet-list">
                ${p.keyEvents.map(ev => `<li>${ev}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      `;
    } else if (rulersSubTab === 'parties') {
      contentEl.innerHTML = `
        <div class="party-columns">
          ${(Data.partyHistory || []).map(group => `
            <div class="party-col" style="border-top: 3px solid ${group.color}">
              <h3 style="color:${group.color}">${group.wing}</h3>
              <p class="card-text">${group.desc}</p>
              <div class="party-chain">
                ${group.lineage.map(item => `
                  <div class="party-node">
                    <div class="party-year" style="color:${group.color}">${item.year}</div>
                    <div class="party-name">${item.name}</div>
                    <div class="party-note">${item.note}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  }
})();
