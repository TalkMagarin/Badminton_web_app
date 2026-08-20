// 원형 프로필 크롭 — 파일 선택 후 이동/확대로 원형 영역을 맞춰 정사각 이미지로 반환.
//   cropImage(file, out=512) → Promise<Blob|null>  (취소 시 null)
export function cropImage(file, out = 512) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const CROP = 280; // 크롭 뷰포트(px)
      const base = Math.max(CROP / img.naturalWidth, CROP / img.naturalHeight); // 뷰포트를 덮는 최소 배율
      let scale = base; const minS = base, maxS = base * 5;
      let tx = 0, ty = 0; // 이미지 중심의 뷰포트 중심 대비 오프셋

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:360px;text-align:center">
          <div class="modal-head"><h3>사진 조절</h3><button class="icon-btn" id="cr-close">✕</button></div>
          <div class="modal-body">
            <div class="crop-view" id="cr-view"><div class="crop-mask"></div></div>
            <div class="crop-tools">
              <span>➖</span>
              <input type="range" id="cr-zoom" class="crop-zoom" min="1" max="5" step="0.01" value="1" />
              <span>➕</span>
            </div>
            <p class="crop-tip">드래그로 위치, 슬라이더로 확대</p>
            <div style="display:flex;gap:10px;margin-top:12px">
              <button class="btn btn-outline" id="cr-cancel" style="margin:0">취소</button>
              <button class="btn btn-primary" id="cr-apply" style="margin:0">적용</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.body.classList.add('modal-open');
      const view = overlay.querySelector('#cr-view');
      img.className = 'crop-img';
      view.insertBefore(img, view.firstChild);
      const zoom = overlay.querySelector('#cr-zoom');

      function reposition() {
        const dispW = img.naturalWidth * scale, dispH = img.naturalHeight * scale;
        const maxX = Math.max(0, dispW / 2 - CROP / 2), maxY = Math.max(0, dispH / 2 - CROP / 2);
        tx = Math.max(-maxX, Math.min(maxX, tx));
        ty = Math.max(-maxY, Math.min(maxY, ty));
        img.style.width = dispW + 'px';
        img.style.left = (CROP / 2 + tx - dispW / 2) + 'px';
        img.style.top = (CROP / 2 + ty - dispH / 2) + 'px';
      }
      reposition();

      // 드래그(포인터)
      let dragging = false, px = 0, py = 0;
      view.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; view.setPointerCapture(e.pointerId); });
      view.addEventListener('pointermove', (e) => { if (!dragging) return; tx += e.clientX - px; ty += e.clientY - py; px = e.clientX; py = e.clientY; reposition(); });
      view.addEventListener('pointerup', () => { dragging = false; });
      view.addEventListener('pointercancel', () => { dragging = false; });
      // 줌
      zoom.addEventListener('input', () => { scale = minS + (maxS - minS) * ((zoom.value - 1) / 4); reposition(); });

      const cleanup = () => { overlay.remove(); document.body.classList.remove('modal-open'); URL.revokeObjectURL(url); };
      const cancel = () => { cleanup(); resolve(null); };
      overlay.querySelector('#cr-close').addEventListener('click', cancel);
      overlay.querySelector('#cr-cancel').addEventListener('click', cancel);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
      overlay.querySelector('#cr-apply').addEventListener('click', () => {
        const c = document.createElement('canvas'); c.width = c.height = out;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out, out);
        const r = out / CROP, dispW = img.naturalWidth * scale, dispH = img.naturalHeight * scale;
        ctx.drawImage(img, (CROP / 2 + tx - dispW / 2) * r, (CROP / 2 + ty - dispH / 2) * r, dispW * r, dispH * r);
        c.toBlob((blob) => { cleanup(); resolve(blob); }, 'image/jpeg', 0.9);
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
