import { token } from './state.js';

let draggedItem = null;
let draggedType = null;
let lastTouchTarget = null;

function setDraggingState(active) {
  if (active) document.body.classList.add('is-dragging');
  else document.body.classList.remove('is-dragging');
}

export function handleDragStart(e, type, index) {
  draggedItem = index;
  draggedType = type;
  setDraggingState(true);
  e.currentTarget.style.opacity = '0.4';
}

export function handleDragEnd(e) {
  setDraggingState(false);
  e.currentTarget.style.opacity = '1';
  document.querySelectorAll('.queue-item, .pl-card').forEach(el => el.classList.remove('drag-over'));
}

export function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
  return false;
}

export function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

export function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

export async function handleDrop(e, type, toIndex) {
  if (e.stopPropagation) e.stopPropagation();
  setDraggingState(false);

  document.querySelectorAll('.queue-item, .pl-card').forEach(el => el.classList.remove('drag-over'));

  if (draggedItem === null || draggedType !== type || draggedItem === toIndex) return;

  const fromIndex = draggedItem;
  draggedItem = null;

  try {
    const res = await fetch('/api/move-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, type, from: fromIndex, to: toIndex }),
    });
    if (!res.ok) console.error('이동 실패');
  }
  catch (err) {
    console.error('이동 요청 오류:', err);
  }
}

export async function deleteItem(type, index) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  try {
    const res = await fetch('/api/delete-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, type, index }),
    });
    if (!res.ok) console.error('삭제 실패');
  }
  catch (err) {
    console.error('삭제 요청 오류:', err);
  }
}

export function setupTouchEvents(el, type, index) {
  el.addEventListener('touchstart', () => {
    draggedItem = index;
    draggedType = type;
    el.style.opacity = '0.4';
    setDraggingState(true);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (draggedItem === null) return;

    if (e.cancelable) e.preventDefault();

    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const item = target?.closest('.queue-item, .pl-card');

    document.querySelectorAll('.queue-item, .pl-card').forEach(i => i.classList.remove('drag-over'));
    if (item && draggedType === (item.classList.contains('queue-item') ? 'queue' : 'playlist')) {
      item.classList.add('drag-over');
      lastTouchTarget = item;
    }
  }, { passive: false });

  el.addEventListener('touchend', async (e) => {
    el.style.opacity = '1';
    setDraggingState(false);
    if (lastTouchTarget) {
      const parent = lastTouchTarget.parentNode;
      const toIndex = Array.from(parent.children).indexOf(lastTouchTarget);
      lastTouchTarget.classList.remove('drag-over');
      await handleDrop(e, type, toIndex);
    }
    draggedItem = null;
    lastTouchTarget = null;
  }, { passive: true });
}
