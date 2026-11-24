(() => {
  'use strict';

  const card = document.querySelector('.rest-card');
  const start = document.getElementById('rest-start');
  const reset = document.getElementById('rest-reset');
  const time = document.getElementById('rest-time');
  const status = document.getElementById('rest-status');
  const resultText = document.getElementById('pit-result-text');
  const save = document.getElementById('pit-save');
  const saveLabel = document.getElementById('pit-save-label');
  const speak = document.getElementById('pit-speak');
  const copyStatus = document.getElementById('pit-copy-status');
  const storageKey = 'fujia-saved-lines';
  const totalMs = 60_000;
  let remaining = totalMs;
  let deadline = 0;
  let timer;

  function readSaved() {
    try {
      const lines = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(lines) ? lines.filter((line) => typeof line === 'string') : [];
    } catch { return []; }
  }

  function updateSavedState() {
    const line = resultText.textContent.trim();
    const saved = Boolean(line && readSaved().includes(line));
    save.setAttribute('aria-pressed', String(saved));
    saveLabel.textContent = saved ? '已收藏' : '收藏这句';
  }

  function formatTime(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function tick() {
    remaining = Math.max(0, deadline - Date.now());
    time.textContent = formatTime(remaining);
    const phase = Math.floor((totalMs - remaining) / 4000) % 2 === 0 ? 'inhale' : 'exhale';
    card.dataset.phase = phase;
    status.textContent = phase === 'inhale' ? '慢慢吸气，感受身体松下来。' : '慢慢呼气，把今天的疲惫放一放。';
    if (remaining <= 0) {
      clearInterval(timer);
      card.dataset.running = 'false';
      card.dataset.phase = '';
      start.textContent = '再来一次';
      status.textContent = '一分钟结束。准备好了，再慢慢出发。';
      window.fujiaToast?.('这一分钟，留给了你自己');
    }
  }

  start.addEventListener('click', () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
      card.dataset.running = 'false';
      start.textContent = '继续呼吸';
      status.textContent = '先停在这里，等你准备好再继续。';
      return;
    }
    if (remaining <= 0) remaining = totalMs;
    window.speechSynthesis?.cancel();
    speak.lastChild.textContent = ' 读给我听';
    window.fujiaCompanion?.radio?.stop();
    window.fujiaCompanion?.theater?.stop();
    card.dataset.running = 'true';
    reset.hidden = false;
    start.textContent = '暂停一下';
    deadline = Date.now() + remaining;
    tick();
    timer = setInterval(tick, 250);
  });

  reset.addEventListener('click', () => {
    clearInterval(timer);
    timer = undefined;
    remaining = totalMs;
    time.textContent = '01:00';
    card.dataset.running = 'false';
    card.dataset.phase = '';
    reset.hidden = true;
    start.textContent = '开始呼吸';
    status.textContent = '跟着圆点，慢慢吸气，再慢慢呼气。';
  });

  save.addEventListener('click', () => {
    const line = resultText.textContent.trim();
    if (!line) return;
    const lines = readSaved();
    const index = lines.indexOf(line);
    if (index >= 0) lines.splice(index, 1);
    else lines.unshift(line);
    try { localStorage.setItem(storageKey, JSON.stringify(lines.slice(0, 20))); } catch {}
    updateSavedState();
    copyStatus.textContent = index >= 0 ? '已从收藏中移除。' : '已收藏到本机。';
  });

  speak.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
      window.fujiaToast?.('当前浏览器不支持朗读，可以复制这句话后阅读。');
      return;
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      speak.lastChild.textContent = ' 读给我听';
      return;
    }
    const line = resultText.textContent.trim();
    if (!line) return;
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = 'zh-CN';
    utterance.rate = .92;
    utterance.pitch = 1;
    utterance.onend = () => { speak.lastChild.textContent = ' 读给我听'; };
    utterance.onerror = () => { speak.lastChild.textContent = ' 读给我听'; };
    speak.lastChild.textContent = ' 停止朗读';
    window.speechSynthesis.speak(utterance);
  });

  new MutationObserver(updateSavedState).observe(resultText, { childList: true, characterData: true, subtree: true });
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    window.speechSynthesis?.cancel();
  });
  updateSavedState();
})();
