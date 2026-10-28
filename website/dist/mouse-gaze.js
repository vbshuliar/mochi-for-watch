// Continuous website character motion, independent of the native Watch renderer.
(() => {
  const face = document.querySelector('.idle-face');
  const eyes = face?.querySelector('.idle-eyes');
  if (!eyes) return;
  const brows = [...face.querySelectorAll('.confused-expression path')].slice(0, 2);
  brows[0]?.setAttribute('d', 'M300 432 Q332 408 365 421');
  brows[1]?.setAttribute('d', 'M638 435 Q666 445 692 432');
  // Blink the eyes and highlights together, without scaling gaze or eyebrows.
  const lids = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  while (eyes.firstChild) lids.appendChild(eyes.firstChild);
  eyes.appendChild(lids);
  eyes.style.animation = 'none';
  face.style.transition = 'none';
  const caption = document.querySelector('#watch-caption');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let reactionTimer, target = null, x = 0, y = 0, tilt = 0, lift = 0;
  let frame = 0, last = 0, time = 0, nextBlink = 2.4, blinkStart = -Infinity;
  face.addEventListener('click', () => {
    clearTimeout(reactionTimer);
    face.setAttribute('aria-pressed', 'true');
    if (caption) caption.textContent = 'Download to use';
    nextBlink = time + .3;
    reactionTimer = setTimeout(() => {
      face.setAttribute('aria-pressed', 'false');
      if (caption) caption.textContent = 'tap to talk';
      start();
    }, 1500);
    start();
  });
  function render(now) {
    frame = 0;
    if (document.hidden) return;
    const dt = Math.max(0, Math.min((now - last) / 1000, .05));
    last = now;
    time += dt;
    const active = !reduced.matches;
    const confused = face.getAttribute('aria-pressed') === 'true';
    const rest = confused
      ? { x: Math.sin(time * 3.1) * 13, y: -10 + Math.sin(time * 2) * 3 }
      : { x: Math.sin(time * .8) * 13 + Math.sin(time * 1.7) * 4, y: Math.sin(time * 1.1) * 5 };
    const goal = active ? (target
      ? { x: target.x + rest.x * .16, y: target.y + rest.y * .16 }
      : rest) : { x: 0, y: 0 };
    const ease = 1 - Math.exp(-dt * 8);
    x += (goal.x - x) * ease;
    y += (goal.y - y) * ease;
    const desiredTilt = active ? (confused ? -4 + Math.sin(time * 2.7) * 2 : Math.sin(time * .7) * 1.5) : 0;
    tilt += (desiredTilt - tilt) * (1 - Math.exp(-dt * 5));
    lift += ((active ? Math.sin(time * 1.6) * .7 : 0) - lift) * ease;
    face.style.transform = `translateY(${lift}px) rotate(${tilt}deg)`;
    eyes.style.transform = `translate(${x}px, ${y}px)`;
    for (const brow of brows) brow.setAttribute('transform', `translate(${x} ${y})`);
    if (active && time >= nextBlink) {
      blinkStart = time;
      nextBlink = time + 2.8 + Math.random() * 2.4;
    }
    const age = time - blinkStart;
    const openness = active && age >= 0 && age < .2 ? 1 - .94 * Math.sin(age / .2 * Math.PI) : 1;
    lids.setAttribute('transform', `translate(0 520) scale(1 ${openness}) translate(0 -520)`);
    if (active || Math.abs(x) + Math.abs(y) + Math.abs(tilt) + Math.abs(lift) > .01) {
      frame = requestAnimationFrame(render);
    }
  }
  function start() {
    if (!frame && !document.hidden) { last = performance.now(); frame = requestAnimationFrame(render); }
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; target = null; }
    else start();
  });
  start();
})();
