// 테마·폰트가 완전히 적용되는 커스텀 드롭다운 (네이티브 select 대체)
import { esc } from './util.js';

/**
 * dropdown({ options, value, placeholder, onChange, ariaLabel })
 *  - options: [{ value, label }]
 *  - 반환: { el, get(), set(v) }
 */
export function dropdown({ options, value = '', placeholder = '선택', onChange, ariaLabel } = {}) {
  const root = document.createElement('div');
  root.className = 'cselect';
  let current = value;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cselect-trigger';
  if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);

  const panel = document.createElement('div');
  panel.className = 'cselect-panel';

  const labelFor = (v) => {
    const o = options.find((o) => o.value === v);
    return o ? o.label : '';
  };
  const hasSelection = () => options.some((o) => o.value === current);

  function renderTrigger() {
    const lbl = hasSelection() ? labelFor(current) : '';
    trigger.innerHTML =
      `<span class="cselect-label${lbl === '' && !hasSelection() ? ' ph' : ''}">${esc(lbl || placeholder)}</span>` +
      `<span class="cselect-caret" aria-hidden="true">▾</span>`;
  }
  function renderPanel() {
    panel.innerHTML = options
      .map(
        (o) =>
          `<button type="button" class="cselect-option${o.value === current ? ' sel' : ''}" data-v="${esc(o.value)}">${esc(o.label)}</button>`
      )
      .join('');
  }
  function open() {
    // 다른 열린 드롭다운 닫기
    document.querySelectorAll('.cselect.open').forEach((el) => {
      if (el !== root) el.classList.remove('open');
    });
    root.classList.add('open');
    renderPanel();
    document.addEventListener('click', onDoc, true);
  }
  function close() {
    root.classList.remove('open');
    document.removeEventListener('click', onDoc, true);
  }
  function onDoc(e) {
    if (!root.contains(e.target)) close();
  }

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    root.classList.contains('open') ? close() : open();
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('.cselect-option');
    if (!b) return;
    current = b.dataset.v;
    renderTrigger();
    close();
    if (onChange) onChange(current);
  });

  renderTrigger();
  root.append(trigger, panel);
  return {
    el: root,
    get: () => current,
    set: (v) => {
      current = v;
      renderTrigger();
    },
  };
}
