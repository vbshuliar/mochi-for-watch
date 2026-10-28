// Use the visitor's local timezone and regional clock format.
(() => {
  const clock = document.querySelector('.watch-clock');
  if (!clock) return;
  let timer;
  function updateClock() {
    clearTimeout(timer);
    clock.textContent = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (!document.hidden) timer = setTimeout(updateClock, 60000 - Date.now() % 60000 + 20);
  }
  document.addEventListener('visibilitychange', updateClock);
  updateClock();
})();

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
  const expression = face.querySelector('.confused-expression');
  const smile = face.querySelector('.idle-smile');
  if (expression) { expression.style.transition = 'none'; expression.style.opacity = '1'; }
  if (smile) { smile.style.transition = 'none'; smile.style.opacity = '1'; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let reactionTimer, target = null, x = 0, y = 0, tilt = 0, lift = 0;
  let frame = 0, last = 0, time = 0, confusion = 0, nextBlink = 2.4, blinkStart = -Infinity;
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
    confusion += ((confused ? 1 : 0) - confusion) * (1 - Math.exp(-dt * 6));
    // Morph a single persistent mouth; no overlapping or fading expressions.
    const mix = (from, to) => from + (to - from) * confusion;
    if (smile) smile.setAttribute('d', `M${mix(451,465)} ${mix(592,608)} C${mix(470.6,488.3)} ${mix(616,596)}, ${mix(529.4,513.3)} ${mix(616,593.7)}, ${mix(549,540)} ${mix(592,601)}`);
    // Brows grow from a point and bend, rather than appearing through opacity.
    for (const [index, brow] of brows.entries()) {
      const center = index === 0 ? 332 : 666;
      const spread = 32 * confusion;
      const base = index === 0 ? 432 : 435;
      brow.setAttribute('d', `M${center-spread} ${base} Q${center} ${base+(index===0?-24:10)*confusion} ${center+spread} ${base+(index===0?-11:-3)*confusion}`);
      brow.setAttribute('stroke-width', String(6 * confusion));
    }
    const idleX = Math.sin(time * .8) * 13 + Math.sin(time * 1.7) * 4;
    const idleY = Math.sin(time * 1.1) * 5;
    const rest = {
      x: idleX + (Math.sin(time * 3.1) * 13 - idleX) * confusion,
      y: idleY + (-10 + Math.sin(time * 2) * 3 - idleY) * confusion,
    };
    const goal = active ? (target
      ? { x: target.x + rest.x * .16, y: target.y + rest.y * .16 }
      : rest) : { x: 0, y: 0 };
    const ease = 1 - Math.exp(-dt * 8);
    x += (goal.x - x) * ease;
    y += (goal.y - y) * ease;
    const idleTilt = Math.sin(time * .7) * 1.5;
    const desiredTilt = active ? idleTilt + (-4 + Math.sin(time * 2.7) * 2 - idleTilt) * confusion : 0;
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
    lids.setAttribute('transform', `translate(0 520) scale(1 ${openness * (1 - confusion * .12)}) translate(0 -520)`);
    if (active || Math.abs(x) + Math.abs(y) + Math.abs(tilt) + Math.abs(lift) + Math.abs(confusion - (confused ? 1 : 0)) > .01) {
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
