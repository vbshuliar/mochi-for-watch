// Pointer attention for the website's SVG face (separate from the Watch emulator).
(() => {
  const face = document.querySelector('.idle-face');
  const eyes = face?.querySelector('.idle-eyes');
  if (!eyes) return;
  const brows = [...face.querySelectorAll('.confused-expression path')].slice(0, 2);
  // Leave room above the glossy eyes even at their highest gaze position.
  brows[0]?.setAttribute('d', 'M300 432 Q332 408 365 421');
  brows[1]?.setAttribute('d', 'M638 435 Q666 445 692 432');
  const caption = document.querySelector('#watch-caption');
  let reactionTimer;
  face.addEventListener('click', () => {
    clearTimeout(reactionTimer);
    face.setAttribute('aria-pressed', 'true');
    if (caption) caption.textContent = 'Download to use';
    reactionTimer = setTimeout(() => {
      face.setAttribute('aria-pressed', 'false');
      if (caption) caption.textContent = 'tap to talk';
      start();
    }, 1500);
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let target = null, x = 0, y = 0, frame = 0, last = 0;
  function render(now) {
    const dt = Math.min((now - last) / 1000, .05);
    last = now;
    const rest = face.getAttribute('aria-pressed') === 'true' ? { x: 10, y: -12 } : { x: 0, y: 0 };
    const goal = target || rest;
    const ease = 1 - Math.exp(-dt * 9);
    x += (goal.x - x) * ease;
    y += (goal.y - y) * ease;
    eyes.style.animation = 'none';
    eyes.style.transform = `translate(${x}px, ${y}px)`;
    for (const brow of brows) brow.setAttribute('transform', `translate(${x} ${y})`);
    if (Math.abs(x - goal.x) + Math.abs(y - goal.y) > .05) {
      frame = requestAnimationFrame(render);
    } else {
      frame = 0;
      if (!target) {
        eyes.style.removeProperty('animation');
        eyes.style.removeProperty('transform');
        for (const brow of brows) brow.removeAttribute('transform');
      }
    }
  }
  function start() {
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(render); }
  }
  function release() { target = null; start(); }
  window.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || reduced.matches) return;
    const rect = face.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    target = {
      x: Math.max(-28, Math.min(28, (event.clientX - rect.left - rect.width / 2) / rect.width * 40)),
      y: Math.max(-18, Math.min(18, (event.clientY - rect.top - rect.height * .52) / rect.height * 30)),
    };
    start();
  });
  document.addEventListener('pointerleave', release);
  window.addEventListener('blur', release);
  reduced.addEventListener('change', release);
})();
