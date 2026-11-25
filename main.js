// Roots Bir · small scripts, no libraries

// Availability form and direct booking: see booking.js

(function () {
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

// Parallax: each photo drifts slowly inside its frame as you scroll
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var els = [].slice.call(document.querySelectorAll('.photo.px'));
  if (!els.length) return;
  els.forEach(function (el) {
    var layer = document.createElement('div');
    layer.className = 'px-layer';
    layer.style.backgroundImage = el.style.backgroundImage;
    el.insertBefore(layer, el.firstChild);
    el.classList.add('px-on');
  });
  var ticking = false;
  function update() {
    var vh = window.innerHeight;
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      var p = (r.top + r.height / 2 - vh / 2) / vh;
      el.style.setProperty('--py', (-p * r.height * 0.09).toFixed(1) + 'px');
    });
    ticking = false;
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

// Map: the list and the pins highlight each other
(function () {
  var svg = document.querySelector('.map-canvas svg');
  if (!svg) return;
  var items = [].slice.call(document.querySelectorAll('.places li'));
  var pins = [].slice.call(document.querySelectorAll('.pin'));
  function pick(id) {
    items.forEach(function (li) { li.classList.toggle('on', li.dataset.place === id); });
    pins.forEach(function (p) { p.classList.toggle('on', p.dataset.place === id); });
  }
  items.forEach(function (li) {
    var b = li.querySelector('button');
    b.addEventListener('click', function () { pick(li.dataset.place); });
    b.addEventListener('mouseenter', function () { pick(li.dataset.place); });
  });
  pins.forEach(function (p) {
    p.addEventListener('click', function () { pick(p.dataset.place); });
    p.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p.dataset.place); } });
  });
  pick('1');
  var mq = window.matchMedia('(max-width: 900px)');
  function frame() {
    svg.setAttribute('viewBox', svg.getAttribute(mq.matches ? 'data-vb-narrow' : 'data-vb-wide'));
    svg.setAttribute('preserveAspectRatio', mq.matches ? 'xMidYMid meet' : 'xMidYMid slice');
  }
  mq.addEventListener ? mq.addEventListener('change', frame) : mq.addListener(frame);
  frame();
})();

// Phones: hide the floating booking button while the hero's own form is on screen
(function () {
  var hero = document.querySelector('.hero');
  if (!hero || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(function (es) { document.body.classList.toggle('at-top', es[0].isIntersecting); }, { threshold: 0.35 }).observe(hero);
})();
