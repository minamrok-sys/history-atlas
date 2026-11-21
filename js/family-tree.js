// ============================================================================
// 조선왕조 27대 인터랙티브 SVG 가계도 렌더러 (window.JoseonFamilyTree)
// 직계/방계/반정 계승선 구분 + 줌/초기화 + 노드 클릭 시 국왕 상세 모달 연동
// ============================================================================
window.JoseonFamilyTree = (function () {
  let scale = 1;
  let onSelectKingCallback = null;

  function render(containerId, onSelectKing) {
    onSelectKingCallback = onSelectKing;
    const container = document.getElementById(containerId);
    const tree = window.HistoryData && window.HistoryData.joseonTree;
    if (!container || !tree) return;

    const nodeMap = {};
    tree.nodes.forEach(n => { nodeMap[n.id] = n; });

    const NODE_W = 148;
    const NODE_H = 54;

    // SVG 마커(화살표) 및 엣지 생성
    let edgesSvg = '';
    tree.edges.forEach(e => {
      const from = nodeMap[e.from];
      const to = nodeMap[e.to];
      if (!from || !to) return;

      const x1 = from.x;
      const y1 = from.y;
      const x2 = to.x;
      const y2 = to.y;

      // 곡선 베지어 경로 계산
      const dx = x2 - x1;
      const dy = y2 - y1;
      let pathD = '';
      if (Math.abs(dy) < 20) {
        // 같은 행(수평 연결)
        const sx = dx > 0 ? x1 + NODE_W / 2 : x1 - NODE_W / 2;
        const ex = dx > 0 ? x2 - NODE_W / 2 : x2 + NODE_W / 2;
        pathD = `M ${sx} ${y1} C ${(sx + ex) / 2} ${y1 - 24}, ${(sx + ex) / 2} ${y2 - 24}, ${ex} ${y2}`;
      } else {
        // 세로 연결
        const sy = y1 + NODE_H / 2;
        const ey = y2 - NODE_H / 2;
        const midY = (sy + ey) / 2;
        pathD = `M ${x1} ${sy} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${ey}`;
      }

      let stroke = '#eab308'; // 직계 (금색 실선)
      let dash = '';
      let marker = 'url(#arrow-direct)';
      if (e.type === 'collateral') {
        stroke = '#38bdf8'; // 방계/입적 (스카이 점선)
        dash = '6,4';
        marker = 'url(#arrow-collateral)';
      } else if (e.type === 'coup') {
        stroke = '#f43f5e'; // 반정/정난 (적색 점선)
        dash = '5,3';
        marker = 'url(#arrow-coup)';
      }

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 - (Math.abs(dy) < 20 ? 16 : 0);

      edgesSvg += `
        <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="2"
              ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="${marker}" opacity="0.85" />
        ${e.label ? `
          <rect x="${mx - 32}" y="${my - 9}" width="64" height="17" rx="4" fill="#0b1224" opacity="0.92" />
          <text x="${mx}" y="${my + 3}" text-anchor="middle" fill="${stroke}" font-size="10.5" font-weight="600">${e.label}</text>
        ` : ''}
      `;
    });

    // 노드(왕/추존왕/대원군) 생성
    let nodesSvg = '';
    tree.nodes.forEach(n => {
      const x = n.x - NODE_W / 2;
      const y = n.y - NODE_H / 2;
      let fill = '#131f3a';
      let stroke = '#eab308';
      let titleColor = '#fef08a';
      let cursor = n.kingNum ? 'pointer' : 'default';

      if (n.type === 'deposed') {
        fill = '#2a121d';
        stroke = '#f43f5e';
        titleColor = '#fda4af';
      } else if (n.type === 'posthumous') {
        fill = '#162033';
        stroke = '#94a3b8';
        titleColor = '#cbd5e1';
      } else if (n.type === 'regent') {
        fill = '#0f2536';
        stroke = '#38bdf8';
        titleColor = '#7dd3fc';
      }

      nodesSvg += `
        <g class="tree-node ${n.kingNum ? 'clickable' : ''}" data-king-num="${n.kingNum || ''}" style="cursor:${cursor}">
          <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10"
                fill="${fill}" stroke="${stroke}" stroke-width="${n.kingNum ? 2 : 1.5}"
                ${!n.kingNum ? 'stroke-dasharray="4,3"' : ''} />
          <text x="${n.x}" y="${n.y - 4}" text-anchor="middle" fill="${titleColor}" font-size="13.5" font-weight="700">${n.label}</text>
          <text x="${n.x}" y="${n.y + 15}" text-anchor="middle" fill="#94a3b8" font-size="11">${n.sub}</text>
        </g>
      `;
    });

    container.innerHTML = `
      <div class="tree-canvas-inner" id="tree-zoom-target" style="transform: scale(${scale}); transform-origin: top center;">
        <svg viewBox="0 0 ${tree.width} ${tree.height}" width="${tree.width}" height="${tree.height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <marker id="arrow-direct" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
              <polygon points="0 0, 8 3.5, 0 7" fill="#eab308" />
            </marker>
            <marker id="arrow-collateral" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
              <polygon points="0 0, 8 3.5, 0 7" fill="#38bdf8" />
            </marker>
            <marker id="arrow-coup" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
              <polygon points="0 0, 8 3.5, 0 7" fill="#f43f5e" />
            </marker>
          </defs>
          ${edgesSvg}
          ${nodesSvg}
        </svg>
      </div>
    `;

    // 국왕 노드 클릭 이벤트 연결
    container.querySelectorAll('.tree-node.clickable').forEach(el => {
      el.addEventListener('click', () => {
        const num = parseInt(el.getAttribute('data-king-num'), 10);
        if (num && typeof onSelectKingCallback === 'function') {
          onSelectKingCallback(num);
        }
      });
    });
  }

  function applyZoom() {
    const target = document.getElementById('tree-zoom-target');
    if (target) {
      target.style.transform = `scale(${scale})`;
    }
    const label = document.getElementById('tree-zoom-label');
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
  }

  return {
    render,
    zoomIn() {
      scale = Math.min(1.6, +(scale + 0.15).toFixed(2));
      applyZoom();
    },
    zoomOut() {
      scale = Math.max(0.55, +(scale - 0.15).toFixed(2));
      applyZoom();
    },
    resetZoom() {
      scale = 1;
      applyZoom();
    }
  };
})();
