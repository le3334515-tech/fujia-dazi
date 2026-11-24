(() => {
  'use strict';

  const city = document.getElementById('nav-city');
  const origin = document.getElementById('nav-origin');
  const destination = document.getElementById('nav-destination');
  const locate = document.getElementById('nav-locate');
  const swap = document.getElementById('nav-swap');
  const recent = document.getElementById('nav-recent');
  const status = document.getElementById('nav-status');
  if (!city || !origin || !destination || !recent) return;

  const storageKey = 'fujia-recent-routes';

  function readRoutes() {
    try {
      const routes = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(routes) ? routes.filter((route) => route && typeof route.city === 'string'
        && typeof route.origin === 'string' && typeof route.destination === 'string').slice(0, 5) : [];
    } catch { return []; }
  }

  function renderRoutes() {
    const routes = readRoutes();
    recent.replaceChildren(new Option('最近路线', ''));
    routes.forEach((route, index) => {
      const from = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(route.origin) ? '当前位置' : route.origin;
      const label = `${from} → ${route.destination}`;
      recent.add(new Option(label.length > 27 ? `${label.slice(0, 27)}…` : label, String(index)));
    });
    recent.disabled = routes.length === 0;
  }

  function setStatus(message, state = 'idle') {
    status.textContent = message;
    status.dataset.state = state;
  }

  locate.addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('当前浏览器不支持定位，请手动填写起点。', 'error');
      return;
    }
    locate.disabled = true;
    locate.lastChild.textContent = ' 定位中…';
    setStatus('正在获取当前位置，请允许浏览器定位。');
    navigator.geolocation.getCurrentPosition((position) => {
      origin.value = `${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)}`;
      origin.removeAttribute('aria-invalid');
      locate.disabled = false;
      locate.lastChild.textContent = ' 用当前位置';
      setStatus('已使用当前位置作为起点。请确认城市和目的地。', 'ready');
      (city.value.trim() ? destination : city).focus();
    }, (error) => {
      locate.disabled = false;
      locate.lastChild.textContent = ' 用当前位置';
      setStatus(error.code === 1 ? '未获得定位权限，可以手动填写起点。' : '暂时无法定位，请稍后重试或手动填写。', 'error');
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  });

  swap.addEventListener('click', () => {
    [origin.value, destination.value] = [destination.value, origin.value];
    setStatus('出发地和目的地已交换。', 'ready');
    destination.focus();
  });

  recent.addEventListener('change', () => {
    const route = readRoutes()[Number(recent.value)];
    if (!route) return;
    city.value = route.city;
    origin.value = route.origin;
    destination.value = route.destination;
    for (const field of [city, origin, destination]) field.removeAttribute('aria-invalid');
    setStatus('已填入最近路线。', 'ready');
    recent.value = '';
  });

  window.addEventListener('fujia:route', (event) => {
    const route = event.detail;
    const routes = readRoutes().filter((item) => !(item.city === route.city
      && item.origin === route.origin && item.destination === route.destination));
    routes.unshift({ city: route.city, origin: route.origin, destination: route.destination });
    try { localStorage.setItem(storageKey, JSON.stringify(routes.slice(0, 5))); } catch {}
    renderRoutes();
  });

  renderRoutes();
})();
