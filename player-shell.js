(() => {
  'use strict';

  const companion = window.fujiaCompanion || {};
  const mini = document.getElementById('mini-player');
  const drawer = document.getElementById('utility-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const shell = document.getElementById('app-shell');
  const drawerContent = document.getElementById('drawer-content');
  const drawerTitle = document.getElementById('drawer-title');
  const drawerCopy = document.getElementById('drawer-copy');
  const snapshots = new Map();
  let activeKind = '';
  let drawerMode = '';
  let drawerTrigger = null;
  let toastTimer;
  let sleepDeadline = 0;
  let sleepTimer;

  const byId = (id) => document.getElementById(id);
  const formatTime = (seconds) => {
    const value = Math.max(0, Math.round(seconds || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };

  function toast(message) {
    const element = byId('toast');
    clearTimeout(toastTimer);
    element.textContent = message;
    element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
  }
  window.fujiaToast = toast;

  function activeSnapshot() {
    return snapshots.get(activeKind) || null;
  }

  function activePlayer() {
    return activeKind === 'theater' ? companion.theater : companion.radio;
  }

  function updateMediaSession(snapshot) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: snapshot.title || '副驾搭子',
        artist: snapshot.meta || '副驾搭子',
        album: activeKind === 'theater' ? '副驾剧场' : '解闷电台',
        artwork: [{ src: new URL('./icon.svg', location.href).href, sizes: 'any', type: 'image/svg+xml' }],
      });
      navigator.mediaSession.setActionHandler('play', () => togglePlayback());
      navigator.mediaSession.setActionHandler('pause', () => activePlayer()?.stop());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
      navigator.mediaSession.setActionHandler('previoustrack', () => companion.radio?.previousTrack());
      if (Number.isFinite(snapshot.duration) && snapshot.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: snapshot.duration,
          playbackRate: 1,
          position: Math.min(snapshot.duration, snapshot.duration * snapshot.progress),
        });
      }
    } catch {}
  }

  function renderMini(snapshot) {
    if (!snapshot?.loaded) {
      mini.hidden = true;
      document.body.classList.remove('mini-open');
      return;
    }
    mini.hidden = false;
    document.body.classList.add('mini-open');
    byId('mini-title').textContent = snapshot.title;
    byId('mini-meta').textContent = snapshot.meta;
    byId('mini-progress-bar').style.width = `${snapshot.progress * 100}%`;
    byId('mini-seek').value = String(Math.round(snapshot.progress * 1000));
    byId('mini-seek').disabled = !snapshot.canSeek;
    byId('mini-time').textContent = formatTime(snapshot.progress * snapshot.duration);
    byId('mini-art-icon').setAttribute('href', activeKind === 'theater' ? '#i-spark' : '#i-wave');
    byId('mini-prev').disabled = !snapshot.canPrevious;
    byId('mini-next').disabled = !snapshot.canNext;
    byId('mini-next').setAttribute('aria-label', activeKind === 'theater' ? '下一盒' : '下一段');
    byId('mini-transcript').disabled = activeKind === 'theater';
    const wantsPlayback = Boolean(activePlayer()?.wantsPlayback);
    byId('mini-play-icon').setAttribute('href', wantsPlayback ? '#i-pause' : '#i-play');
    byId('mini-play').setAttribute('aria-label', wantsPlayback ? '暂停' : '播放');
    updateMediaSession(snapshot);
    if (!drawer.hidden && drawerMode === 'queue') renderQueue(snapshot);
  }

  function togglePlayback() {
    const player = activePlayer();
    if (!player) return;
    if (player.wantsPlayback) player.stop();
    else if (activeKind === 'theater' && player.finished) player.openBox();
    else player.start();
  }

  function nextTrack() {
    if (activeKind === 'theater') {
      const player = companion.theater;
      if (!player) return;
      if (player.finished) player.playAlternative();
      else player.openBox();
      return;
    }
    companion.radio?.advance();
  }

  function renderQueue(snapshot) {
    drawerContent.replaceChildren();
    if (!snapshot?.tracks?.length) {
      const note = document.createElement('p');
      note.className = 'drawer-note';
      note.textContent = '选择一组节目后，播放队列会出现在这里。';
      drawerContent.append(note);
      return;
    }
    const list = document.createElement('ol');
    snapshot.tracks.forEach((track) => {
      const row = document.createElement(snapshot.kind === 'radio' ? 'button' : 'div');
      row.className = 'queue-item';
      if (snapshot.kind === 'radio') row.type = 'button';
      row.setAttribute('aria-current', String(track.index === snapshot.currentIndex));
      const number = document.createElement('span');
      number.className = 'queue-number';
      number.textContent = String(track.index + 1).padStart(2, '0');
      const meta = document.createElement('span');
      meta.className = 'queue-meta';
      const title = document.createElement('strong');
      title.textContent = track.title;
      const subtitle = document.createElement('small');
      subtitle.textContent = track.meta;
      meta.append(title, subtitle);
      const duration = document.createElement('span');
      duration.className = 'queue-duration';
      duration.textContent = formatTime(track.duration);
      row.append(number, meta, duration);
      if (snapshot.kind === 'radio') row.addEventListener('click', () => {
        companion.radio.playTrackAt(track.index);
        closeDrawer();
      });
      list.append(row);
    });
    drawerContent.append(list);
  }

  function renderTranscript(snapshot) {
    drawerContent.replaceChildren();
    if (!snapshot?.transcript) {
      const note = document.createElement('p');
      note.className = 'drawer-note';
      note.textContent = '这一段是纯音乐，没有文字文稿。闭上眼，听听路上的风景。';
      drawerContent.append(note);
      drawerCopy.hidden = true;
      return;
    }
    const text = document.createElement('p');
    text.className = 'transcript-text';
    text.textContent = snapshot.transcript;
    drawerContent.append(text);
    drawerCopy.hidden = false;
  }

  function openDrawer(mode, trigger) {
    const snapshot = activeSnapshot();
    if (!snapshot?.loaded) return;
    drawerMode = mode;
    drawerTrigger = trigger || document.activeElement;
    drawerTitle.textContent = mode === 'queue' ? '播放队列' : '节目文稿';
    drawerCopy.hidden = mode !== 'queue' || !snapshot.transcript;
    if (mode === 'queue') renderQueue(snapshot);
    else renderTranscript(snapshot);
    drawer.hidden = false;
    overlay.hidden = false;
    shell.inert = true;
    document.body.style.overflow = 'hidden';
    byId('drawer-close').focus();
  }

  function closeDrawer() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    overlay.hidden = true;
    shell.inert = false;
    document.body.style.overflow = '';
    drawerMode = '';
    if (drawerTrigger?.isConnected) drawerTrigger.focus();
  }

  function setSleep(minutes) {
    clearInterval(sleepTimer);
    sleepDeadline = minutes ? Date.now() + minutes * 60_000 : 0;
    const button = byId('sleep-button');
    button.dataset.active = String(Boolean(minutes));
    byId('sleep-label').textContent = minutes ? `${minutes}分钟` : '定时';
    if (!minutes) return;
    toast(`${minutes} 分钟后自动停止播放`);
    const update = () => {
      const remaining = Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 1000));
      byId('sleep-label').textContent = formatTime(remaining);
      if (remaining <= 0) {
        clearInterval(sleepTimer);
        companion.radio?.stop();
        companion.theater?.stop();
        window.speechSynthesis?.cancel();
        byId('sleep-button').dataset.active = 'false';
        byId('sleep-label').textContent = '定时';
        toast('定时结束，已停止播放');
      }
    };
    update();
    sleepTimer = setInterval(update, 1000);
  }

  function setupTheme() {
    const button = byId('theme-toggle');
    const icon = byId('theme-icon');
    const render = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      icon.setAttribute('href', dark ? '#i-sun' : '#i-moon');
      button.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
      button.title = dark ? '切换浅色模式' : '切换深色模式';
      document.querySelector('meta[name="theme-color"]').content = dark ? '#0e1712' : '#17281f';
    };
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('fujia-theme', next); } catch {}
      render();
    });
    render();
  }

  function setupNavigationState() {
    const links = [...document.querySelectorAll('.topnav a, .mobile-dock a')];
    const sections = [...new Set(links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean))];
    const update = () => {
      const marker = window.scrollY + Math.min(220, window.innerHeight * .3);
      let current = sections[0];
      for (const section of sections) if (section.offsetTop <= marker) current = section;
      for (const link of links) {
        const active = link.getAttribute('href') === `#${current?.id}`;
        if (active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function setupPlayer() {
    byId('mini-play').addEventListener('click', togglePlayback);
    byId('mini-next').addEventListener('click', nextTrack);
    byId('mini-prev').addEventListener('click', () => companion.radio?.previousTrack());
    byId('mini-close').addEventListener('click', () => {
      companion.radio?.stop();
      companion.theater?.stop();
      mini.hidden = true;
      document.body.classList.remove('mini-open');
    });
    byId('mini-seek').addEventListener('input', (event) => {
      const snapshot = activeSnapshot();
      if (snapshot?.canSeek) companion.radio?.seek(Number(event.target.value) / 1000);
    });
    byId('mini-art').addEventListener('click', (event) => openDrawer('queue', event.currentTarget));
    byId('mini-transcript').addEventListener('click', (event) => openDrawer('transcript', event.currentTarget));
    let savedVolume = '72';
    try { savedVolume = localStorage.getItem('fujia-volume') || '72'; } catch {}
    byId('mini-volume').value = savedVolume;
    byId('mini-volume').addEventListener('input', (event) => {
      const volume = Number(event.target.value) / 100;
      companion.setVolume?.(volume);
      try { localStorage.setItem('fujia-volume', String(Math.round(volume * 100))); } catch {}
    });
    companion.setVolume?.(Number(byId('mini-volume').value) / 100);
    let sleepStep = 0;
    byId('sleep-button').addEventListener('click', () => {
      const choices = [15, 30, 45, 0];
      setSleep(choices[sleepStep % choices.length]);
      sleepStep += 1;
    });
    byId('drawer-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    drawerCopy.addEventListener('click', async () => {
      const text = activeSnapshot()?.transcript;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast('文稿已复制');
      } catch { toast('请长按选中文稿后手动复制'); }
    });
    document.addEventListener('keydown', (event) => {
      if (drawer.hidden) return;
      if (event.key === 'Escape') closeDrawer();
      if (event.key === 'Tab') {
        const focusable = [...drawer.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')].filter((item) => !item.hidden);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    window.addEventListener('fujia:activate', (event) => {
      activeKind = event.detail.kind;
      renderMini(activeSnapshot());
    });
    window.addEventListener('fujia:state', (event) => {
      const snapshot = event.detail;
      snapshots.set(snapshot.kind, snapshot);
      if (snapshot.kind === activeKind || (snapshot.state === 'playing' && !activeSnapshot()?.loaded)) {
        if (snapshot.state === 'playing') activeKind = snapshot.kind;
        renderMini(snapshot);
      }
    });
    for (const kind of ['radio', 'theater']) {
      const snapshot = kind === 'radio' ? companion.radio?.getSnapshot() : companion.theater?.getSnapshot();
      if (snapshot) snapshots.set(kind, snapshot);
    }
    setInterval(() => {
      const player = activePlayer();
      if (!player || mini.hidden) return;
      const snapshot = activeSnapshot();
      if (!snapshot) return;
      renderMini({ ...snapshot, progress: Number(player.progress.value) || 0 });
    }, 250);
  }

  setupTheme();
  setupNavigationState();
  setupPlayer();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=7').catch(() => {}));
  }
})();
