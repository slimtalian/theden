// Browsing is temporary. Only an ordinary click/tap may open the book room.
export function bindShelfBrowse(surface, {
  hitTest, onLift, onPreview, onReturn, canStart = () => true,
  eventRoot = window, delay = 650,
  schedule = setTimeout, unschedule = clearTimeout,
} = {}) {
  let active = null, preview = false, timer, anchor, press = null;
  let suppressUntil = 0, touchUntil = 0;
  const pointers = new Set();
  function clearTimer() { unschedule(timer); timer = undefined; }
  function returnBook() {
    clearTimer();
    if (active) { onReturn(active); onLift(active, false); }
    active = null; preview = false; anchor = null;
  }
  function release() {
    const ended = press;
    press = null;
    if (ended?.node.hasPointerCapture?.(ended.id)) ended.node.releasePointerCapture(ended.id);
  }
  function cancel() { returnBook(); release(); }
  function arm(event) {
    clearTimer();
    anchor = {x:event.clientX, y:event.clientY};
    timer = schedule(() => {
      if (!active || !canStart()) return;
      preview = true;
      if (press) press.long = true;
      onPreview(active);
    }, delay);
  }
  function track(event) {
    const next = canStart() ? hitTest(event.clientX, event.clientY) : null;
    if (next !== active) {
      returnBook();
      active = next;
      if (active) { onLift(active, true); arm(event); }
    } else if (active && !preview && anchor && Math.hypot(event.clientX-anchor.x, event.clientY-anchor.y) > 9) arm(event);
  }
  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !canStart() || pointers.size > 1) return;
    const node = hitTest(event.clientX, event.clientY);
    if (!node) return;
    // A fresh press is a fresh chance to tap, even after a drag or preview.
    suppressUntil = 0;
    press = {id:event.pointerId, type:event.pointerType, node, x:event.clientX, y:event.clientY, dragged:false, long:false};
    if (event.pointerType !== 'mouse') touchUntil = event.timeStamp + 900;
    track(event);
    // Mouse hover may already have shown a preview; a quick click still opens.
    arm(event);
  });
  eventRoot.addEventListener('pointerdown', event => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) { suppressUntil = event.timeStamp + 700; cancel(); }
  });
  surface.addEventListener('pointermove', event => {
    if (press && event.pointerId === press.id) {
      const dx = event.clientX - press.x, dy = event.clientY - press.y;
      if (!press.dragged && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
        if (Math.abs(dy) > Math.abs(dx) * 1.15) {
          suppressUntil = event.timeStamp + 700; cancel(); return;
        }
        press.dragged = true;
        press.node.setPointerCapture?.(press.id);
      }
      track(event);
    } else if (!press && event.pointerType === 'mouse' && !event.buttons && event.timeStamp > touchUntil && !pointers.size) track(event);
  });
  eventRoot.addEventListener('pointerup', event => {
    pointers.delete(event.pointerId);
    if (!press || event.pointerId !== press.id) return;
    const held = press.long || press.dragged;
    if (held) suppressUntil = event.timeStamp + 700;
    const touch = press.type !== 'mouse';
    release();
    if (touch) { touchUntil = event.timeStamp + 900; returnBook(); }
    else if (!held) returnBook();
  });
  const abort = event => {
    pointers.delete(event.pointerId);
    if (press?.id === event.pointerId) { suppressUntil = event.timeStamp + 700; cancel(); }
  };
  eventRoot.addEventListener('pointercancel', abort);
  surface.addEventListener('lostpointercapture', abort);
  surface.addEventListener('pointerleave', event => {
    if (press?.type === 'mouse') { suppressUntil = event.timeStamp + 700; cancel(); }
    else if (!press) returnBook();
  });
  surface.addEventListener('contextmenu', event => {
    if (press || preview) event.preventDefault();
  });
  surface.addEventListener('click', event => {
    if (event.detail && event.timeStamp < suppressUntil) {
      event.preventDefault(); event.stopPropagation();
    } else cancel();
  }, true);
  surface.addEventListener('focusin', event => {
    if (!event.target.matches('.volume:focus-visible')) return;
    returnBook(); active = event.target; onLift(active, true);
    timer = schedule(() => { if (active && canStart()) { preview = true; onPreview(active); } }, delay);
  });
  surface.addEventListener('focusout', cancel);
  eventRoot.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
  eventRoot.addEventListener('blur', () => { pointers.clear(); cancel(); });
  return cancel;
}

export function setupShelfPreview(surface, {getBook, canStart, motion}) {
  let current, rectangles;
  const returning = new Set();
  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  const reduce = () => !motion() || matchMedia('(prefers-reduced-motion: reduce)').matches;
  function finish(item) {
    if (!current || current === item || current.source !== item.source) {
      item.source.classList.remove('preview-source');
      item.source.removeAttribute('aria-describedby');
    }
    returning.delete(item);
    item.layer.remove();
    if (current === item) current = null;
  }
  function dismiss(source, immediate = false) {
    const item = current;
    if (!item || (source && item.source !== source)) return;
    current = null;
    item.source.removeAttribute('aria-describedby');
    item.note.removeAttribute('id');
    if (immediate || reduce() || !item.source.isConnected) { finish(item); return; }
    item.note.classList.remove('visible');
    returning.add(item);
    // Start from the currently painted pose when a hold is interrupted.
    const pose = getComputedStyle(item.object).transform;
    item.animation?.cancel();
    item.animation = item.object.animate([{transform:pose}, {transform:'rotateY(87deg)'}],
      {duration:320,easing:'cubic-bezier(.22,.68,0,1)',fill:'forwards'});
    item.animation.finished.then(() => finish(item), () => finish(item));
  }
  function show(source) {
    if (current?.source === source) return;
    dismiss(null, true);
    const book = getBook(Number(source.dataset.book));
    if (!book) return;
    const rect = source.getBoundingClientRect(), original = source.querySelector('.book-object');
    const width = original.offsetWidth, height = original.offsetHeight;
    const compact = innerWidth < 600, scale = compact ? .78 : 1.08;
    const bookWidth = width * scale, bookHeight = height * scale;
    const noteWidth = Math.min(compact ? 205 : 255, innerWidth - bookWidth - 52);
    const groupWidth = bookWidth + noteWidth + 22;
    const left = clamp(rect.left + rect.width/2 - groupWidth/2, 16, innerWidth-groupWidth-16);
    const top = clamp(rect.top - (compact ? 36 : 30), 18, innerHeight-Math.max(bookHeight, 260)-22);
    const layer = document.createElement('div'); layer.className = 'shelf-peek';
    const ghost = document.createElement('div'); ghost.className = 'volume shelf-peek-book';
    ghost.setAttribute('aria-hidden','true');
    Object.assign(ghost.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
    const object = original.cloneNode(true); ghost.append(object);
    const note = document.createElement('div'); note.className = 'shelf-peek-note';
    note.id = 'shelf-preview-blurb'; note.setAttribute('role','tooltip');
    Object.assign(note.style,{left:`${left+bookWidth+22}px`,top:`${top+8}px`,width:`${noteWidth}px`,maxHeight:`${innerHeight-top-26}px`});
    const title = document.createElement('h2'); title.textContent = book.title;
    const author = document.createElement('p'); author.className='peek-author'; author.textContent=book.authors;
    note.append(title,author);
    if (book.description?.trim()) {
      const blurb = document.createElement('p'); blurb.className='peek-blurb';
      blurb.textContent=book.description.trim(); note.append(blurb);
    }
    layer.append(ghost,note); document.body.append(layer);
    // Fixed ghost keeps the real button's hit area still; no layout changes.
    const x = left + bookWidth/2 - (rect.left+rect.width/2);
    const y = top + bookHeight - (rect.top+height);
    const target = `translate(${x}px,${y}px) rotateX(-6deg) rotateY(-24deg) scale(${scale})`;
    object.style.transform = target;
    source.classList.add('preview-source'); source.setAttribute('aria-describedby',note.id);
    const item = {source,layer,object,note,animation:null}; current=item;
    if (!reduce()) item.animation=object.animate([{transform:getComputedStyle(original).transform},{transform:target}],
      {duration:520,easing:'cubic-bezier(.2,.74,.18,1)',fill:'forwards'});
    requestAnimationFrame(() => { if (current === item) note.classList.add('visible'); });
  }
  const cancel = bindShelfBrowse(surface, {
    canStart,
    hitTest:(x,y) => {
      rectangles ||= [...surface.querySelectorAll('.volume')].map(node=>({node,rect:node.getBoundingClientRect()}));
      return rectangles.find(({rect}) => x >= rect.left-1 && x <= rect.right+1 && y >= rect.top && y <= rect.bottom)?.node || null;
    },
    onLift:(node,lift) => node.classList.toggle('shelf-lifted',lift),
    onPreview:show, onReturn:source=>dismiss(source),
  });
  function reset() {
    cancel(); rectangles=null; dismiss(null,true);
    for (const item of returning) { item.animation?.cancel(); finish(item); }
  }
  window.addEventListener('resize',reset);
  window.addEventListener('scroll',reset,{capture:true,passive:true});
  document.addEventListener('visibilitychange',() => { if (document.hidden) reset(); });
  document.addEventListener('den-motion-change',reset);
  return reset;
}
