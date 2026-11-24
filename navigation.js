(() => {
  'use strict';

  const form = document.getElementById('navigation-form');
  if (!form) return;

  const city = document.getElementById('nav-city');
  const origin = document.getElementById('nav-origin');
  const destination = document.getElementById('nav-destination');
  const status = document.getElementById('nav-status');
  const fallback = document.getElementById('nav-fallback');

  function setStatus(message, state = 'idle') {
    status.dataset.state = state;
    status.textContent = message;
  }

  function hideLink() {
    fallback.hidden = true;
    fallback.removeAttribute('href');
  }

  form.addEventListener('input', () => {
    hideLink();
    setStatus('');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    hideLink();
    const region = city.value.trim();
    const originText = origin.value.trim();
    const destinationText = destination.value.trim();
    if (!region || !destinationText) {
      setStatus('请填写城市和目的地。', 'error');
      (region ? destination : city).focus();
      return;
    }
    if (!originText || originText === '我的位置') {
      setStatus('请填写起点的地点名称或地址。', 'error');
      origin.focus();
      return;
    }

    const url = new URL('https://api.map.baidu.com/direction');
    url.search = new URLSearchParams({
      origin: originText,
      destination: destinationText,
      mode: 'driving',
      region,
      output: 'html',
      coord_type: 'wgs84',
      src: 'webapp.fujiadazi.route',
    });

    fallback.href = url.href;
    fallback.hidden = false;
    setStatus('已准备好驾车路线链接。', 'ready');
    fallback.click();
  });
})();
