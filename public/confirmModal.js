// 공용 확인/입력 모달 — 네이티브 confirm()/alert() 대체.
//   showConfirm(opts)  → Promise<boolean>
//   showPrompt(opts)   → Promise<string|null>  (취소 시 null, 확인 시 입력값)
//   showAlert(opts)    → Promise<void>          (확인 버튼 하나)
// opts: 문자열(메시지) 또는 { title, message, confirmText, cancelText, danger, inputPlaceholder, inputValue }
(function () {
  let overlay, titleEl, msgEl, inputEl, okBtn, cancelBtn, resolver = null, isPrompt = false;

  function ensure() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'cmodal-overlay';
    overlay.innerHTML =
      '<div class="cmodal-box" role="dialog" aria-modal="true">' +
        '<div class="cmodal-title"></div>' +
        '<div class="cmodal-msg"></div>' +
        '<textarea class="cmodal-input" rows="2" style="display:none"></textarea>' +
        '<div class="cmodal-btns">' +
          '<button type="button" class="cmodal-btn cancel"></button>' +
          '<button type="button" class="cmodal-btn confirm"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    titleEl   = overlay.querySelector('.cmodal-title');
    msgEl     = overlay.querySelector('.cmodal-msg');
    inputEl   = overlay.querySelector('.cmodal-input');
    cancelBtn = overlay.querySelector('.cmodal-btn.cancel');
    okBtn     = overlay.querySelector('.cmodal-btn.confirm');

    okBtn.addEventListener('click',     () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
    document.addEventListener('keydown', e => {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter' && !isPrompt) finish(true);
    });
  }

  function finish(ok) {
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    const r = resolver, wasPrompt = isPrompt;
    resolver = null; isPrompt = false;
    if (!r) return;
    if (wasPrompt) r(ok ? (inputEl.value || '') : null);
    else r(ok);
  }

  function open(opts, promptMode, hideCancel) {
    ensure();
    if (typeof opts === 'string') opts = { message: opts };
    opts = opts || {};
    isPrompt = !!promptMode;

    const title = (opts.title != null) ? opts.title : (promptMode ? '입력' : '확인');
    titleEl.textContent  = title;
    titleEl.style.display = title ? '' : 'none';
    msgEl.textContent     = opts.message || '';
    msgEl.style.display   = opts.message ? '' : 'none';
    cancelBtn.textContent = opts.cancelText  || '취소';
    cancelBtn.style.display = hideCancel ? 'none' : '';
    okBtn.textContent     = opts.confirmText || '확인';
    okBtn.classList.toggle('danger', !!opts.danger);

    inputEl.style.display = promptMode ? '' : 'none';
    if (promptMode) {
      inputEl.value = opts.inputValue || '';
      inputEl.placeholder = opts.inputPlaceholder || '';
    }

    if (resolver) { const r = resolver; resolver = null; r(isPrompt ? null : false); }

    return new Promise(resolve => {
      resolver = resolve;
      document.body.classList.remove('page-fade-in');
      overlay.classList.add('open');
      document.body.classList.add('modal-open');
      if (promptMode) setTimeout(() => inputEl.focus(), 50);
    });
  }

  window.showConfirm = function (opts) {
    if (typeof opts === 'string') opts = { message: opts };
    opts = opts || {};
    return open(Object.assign({ confirmText: '예', cancelText: '아니오' }, opts), false, false);
  };
  window.showPrompt = function (opts) {
    if (typeof opts === 'string') opts = { message: opts };
    return open(opts, true, false);
  };
  // alert() 대체 — 확인 버튼 하나
  window.showAlert = function (opts) {
    if (typeof opts === 'string') opts = { message: opts };
    return open(opts, false, true).then(() => {});
  };
})();
