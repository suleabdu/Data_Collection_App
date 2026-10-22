(function(){
  'use strict';
  const header = document.getElementById('siteHeader');
  const toggle = document.getElementById('mobileMenuToggle');
  const nav = document.getElementById('primaryNav');
  const updateHeader = () => { if (header) header.classList.toggle('is-scrolled', window.scrollY > 8); };
  updateHeader();
  window.addEventListener('scroll', updateHeader, {passive:true});
  if (toggle && nav) {
    toggle.addEventListener('click', function(){
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    nav.querySelectorAll('a').forEach(function(link){
      link.addEventListener('click', function(){
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded','false');
        toggle.setAttribute('aria-label','Open navigation');
      });
    });
    document.addEventListener('keydown', function(event){
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded','false');
        toggle.focus();
      }
    });
  }
  document.querySelectorAll('img[data-person-image]').forEach(function(img){
    const showFallback = function(){
      const fallback = img.parentElement && img.parentElement.querySelector('.portrait-fallback');
      img.hidden = true;
      if (fallback) fallback.hidden = false;
    };
    img.addEventListener('error', showFallback, {once:true});
    if (img.complete && img.naturalWidth === 0) showFallback();
  });
  const map = document.querySelector('[data-map-image]');
  const mapFallback = document.querySelector('[data-map-fallback]');
  if (map && mapFallback) {
    const showMapFallback = function(){ map.hidden = true; mapFallback.hidden = false; };
    map.addEventListener('error', showMapFallback, {once:true});
    if (map.complete && map.naturalWidth === 0) showMapFallback();
  }
})();
