(() => {
  'use strict';

  const voices = {
    warm: {
      name: '阿暖',
      preview: '我是阿暖。今天这段路，我陪着你。',
      lines: ['这一下确实让人心烦。我陪着你。', '辛苦了，这一路已经够累了。', '刚才那一瞬间挺烦的。慢慢来，我在。']
    },
    road: {
      name: '阿路',
      preview: '我是阿路。上车，咱们搭个伴。',
      lines: ['今天的路况，有点抢戏啊。', '这段路够闹腾的。我陪你一程。', '刚才这一幕，能剪进通勤花絮了。']
    }
  };
  const cooldownMs = 45_000;
  const panel = document.getElementById('detector-panel');
  const statusLabel = document.getElementById('status-label');
  const micButton = document.getElementById('mic-button');
  const micLabel = document.getElementById('mic-label');
  const micIcon = document.getElementById('mic-icon');
  const demoButton = document.getElementById('demo-button');
  const demoLabel = document.getElementById('demo-label');
  const previewButton = document.getElementById('preview-button');
  const previewLabel = document.getElementById('preview-label');
  const responseText = document.getElementById('response-text');
  const sensitivity = document.getElementById('sensitivity');
  const waveform = document.getElementById('waveform');
  const clipBuffers = new Map();
  const nextLine = { warm: 0, road: 0 };
  const bars = Array.from({ length: 43 }, (_, index) => {
    const bar = document.createElement('span');
    const pattern = Math.abs(Math.sin(index * 1.22) * Math.cos(index * .34));
    bar.style.setProperty('--height', `${8 + pattern * 61}px`);
    waveform.append(bar);
    return bar;
  });

  let audioContext;
  let clipData;
  let playingSource;
  let micState = 'idle';
  let operation = '';
  let playbackId = 0;
  let micRequest = 0;
  let lastHorn = -Infinity;
  let ignoreUntil = 0;
  let message = '停车时开启，之后可以放下手机。';
  let lastMeterUpdate = -Infinity;
  let replyAnimation;

  function readPreference(key, fallback) {
    try { return localStorage.getItem(key) || fallback; }
    catch { return fallback; }
  }

  function writePreference(key, value) {
    try { localStorage.setItem(key, value); }
    catch { /* Preferences still apply for this visit. */ }
  }

  const savedVoice = readPreference('fujia-voice', 'warm');
  let selectedVoice = Object.hasOwn(voices, savedVoice) ? savedVoice : 'warm';
  const savedSensitivity = readPreference('fujia-sensitivity', 'normal');
  if (['low', 'normal', 'high'].includes(savedSensitivity)) sensitivity.value = savedSensitivity;
  document.querySelector(`input[name="voice"][value="${selectedVoice}"]`).checked = true;

  function render() {
    const showingAudio = Boolean(operation) && operation !== 'demo-loading';
    const state = showingAudio ? 'replying' : micState;
    panel.dataset.state = state;
    statusLabel.textContent = {
      idle: '未开启', loading: '正在开启', listening: '正在感应', replying: '正在播放', error: '感应未开启'
    }[state];
    if (responseText.textContent !== message) responseText.textContent = message;
    micLabel.textContent = { idle: '开启感应', loading: '取消开启', listening: '关闭感应', error: '重新开启感应' }[micState];
    micIcon.setAttribute('href', ['loading', 'listening'].includes(micState) ? '#i-stop' : '#i-mic');
    demoButton.disabled = Boolean(operation) || micState === 'loading';
    previewButton.disabled = demoButton.disabled;
    demoLabel.textContent = operation === 'demo-loading' ? '正在识别样本…' : operation === 'demo' ? '正在模拟…' : '模拟鸣笛';
    previewLabel.textContent = operation === 'preview' ? '正在试听…' : '试听语音';
  }

  function paintLevel(level, now = performance.now()) {
    if (now - lastMeterUpdate < 90) return;
    lastMeterUpdate = now;
    const strength = Math.min(1, Math.max(0, level));
    for (const [index, bar] of bars.entries()) {
      const variation = .7 + .45 * Math.sin(now / 215 + index * .78);
      bar.style.setProperty('--scale', (1 + strength * variation).toFixed(2));
    }
  }

  function animatePlayback() {
    const frame = (now) => {
      paintLevel(.40 + .22 * Math.sin(now / 200), now);
      replyAnimation = requestAnimationFrame(frame);
    };
    replyAnimation = requestAnimationFrame(frame);
  }

  function unlockAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return Promise.reject(new Error('AudioContext unavailable'));
    try {
      audioContext ||= new Audio();
      return audioContext.state === 'running' ? Promise.resolve() : audioContext.resume();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function getPlayerAudioContext() {
    await unlockAudio();
    return audioContext;
  }

  const radioSection = document.getElementById('radio');
  const radio = radioSection && window.RadioPlayer ? new window.RadioPlayer({
    section: radioSection,
    getAudioContext: getPlayerAudioContext,
    onPlaybackStart: () => theater?.stop(),
  }) : null;
  const theaterSection = document.getElementById('theater');
  const theater = theaterSection && window.TheaterPlayer ? new window.TheaterPlayer({
    section: theaterSection,
    getAudioContext: getPlayerAudioContext,
    onPlaybackStart: () => radio?.stop(),
  }) : null;

  function setPlaybackInterruption(interrupted) {
    radio?.setInterruption(interrupted);
    theater?.setInterruption(interrupted);
  }

  function loadClip(name) {
    // Text delivery keeps native download handlers from intercepting the audio assets.
    clipData ||= fetch('./voice/clips.json').then((response) => {
      if (!response.ok) throw new Error(`Audio request returned ${response.status}`);
      return response.json();
    }).catch((error) => {
      clipData = undefined;
      throw error;
    });
    if (!clipBuffers.has(name)) {
      const pending = clipData.then((clips) => {
        if (!Object.hasOwn(clips, name)) throw new Error('Audio clip missing');
        const bytes = Uint8Array.from(atob(clips[name]), (character) => character.charCodeAt(0));
        return audioContext.decodeAudioData(bytes.buffer);
      }).catch((error) => {
        clipBuffers.delete(name);
        throw error;
      });
      clipBuffers.set(name, pending);
    }
    return clipBuffers.get(name);
  }

  async function playClip(clip, volume = .88) {
    if (audioContext.state !== 'running') throw new Error('Audio playback suspended');
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = clip;
    gain.gain.value = volume;
    source.connect(gain).connect(audioContext.destination);
    playingSource = source;
    try {
      await new Promise((resolve, reject) => {
        source.onended = resolve;
        try { source.start(); } catch (error) { reject(error); }
      });
    } finally {
      source.disconnect();
      gain.disconnect();
      if (playingSource === source) playingSource = undefined;
    }
  }

  function playbackFinished() {
    playbackId += 1;
    operation = '';
    ignoreUntil = performance.now() + 2200;
    cancelAnimationFrame(replyAnimation);
    lastMeterUpdate = -Infinity;
    paintLevel(0);
    render();
    setPlaybackInterruption(false);
  }

  function voiceLine(voice, preview = false) {
    if (preview) return { clip: `${voice}-preview`, line: voices[voice].preview };
    const index = nextLine[voice];
    nextLine[voice] = (index + 1) % voices[voice].lines.length;
    return { clip: `${voice}-${index + 1}`, line: voices[voice].lines[index] };
  }

  async function playVoice(voice, item, id, prefix = '') {
    const clip = await loadClip(item.clip);
    if (id !== playbackId) return;
    message = `${prefix}${voices[voice].name}：${item.line}`;
    render();
    await playClip(clip);
  }

  async function onHorn() {
    const now = performance.now();
    if (micState !== 'listening' || operation || now < ignoreUntil || now - lastHorn < cooldownMs) return;
    lastHorn = now;
    const voice = selectedVoice;
    const id = ++playbackId;
    operation = 'automatic';
    setPlaybackInterruption(true);
    message = '听到疑似鸣笛。';
    render();
    animatePlayback();
    try {
      await playVoice(voice, voiceLine(voice), id, '听到疑似鸣笛。');
    } catch {
      if (id === playbackId) message = '听到疑似鸣笛。语音暂未播放，可以先点「试听语音」恢复。';
    } finally {
      if (id === playbackId) playbackFinished();
    }
  }

  function captureFailed(error) {
    micRequest += 1;
    micState = 'error';
    message = ({
      NotAllowedError: '未获得麦克风权限。允许访问后，可以再开一次。',
      SecurityError: '浏览器限制了麦克风。请在独立浏览器标签页打开。',
      NotFoundError: '没有找到可用的麦克风。你也可以先模拟鸣笛。',
      NotReadableError: '麦克风暂时不可用。请检查设备后再试。'
    })[error?.name] || '感应暂停了。请检查麦克风权限和网络后重试。';
    paintLevel(0);
    render();
  }

  const detector = window.HornDetector ? new window.HornDetector({
    onHorn,
    onLevel: (level) => { if (!operation && micState === 'listening') paintLevel(level); },
    onError: (error) => { if (micState === 'listening' || micState === 'loading') captureFailed(error); }
  }) : null;
  detector?.setSensitivity(sensitivity.value);

  micButton.addEventListener('click', async () => {
    if (micState === 'listening' || micState === 'loading') {
      micRequest += 1;
      micState = 'idle';
      detector?.stop();
      message = '感应已关闭。';
      if (operation === 'automatic') {
        playingSource?.stop();
        playbackFinished();
      }
      paintLevel(0);
      render();
      return;
    }
    if (!detector) {
      captureFailed(new Error('Detector unavailable'));
      return;
    }
    const request = ++micRequest;
    micState = 'loading';
    message = '允许麦克风访问后，等到「正在感应」。';
    render();
    try {
      const audioReady = unlockAudio().then(() => { void loadClip(voiceLineForPrefetch()).catch(() => {}); });
      await Promise.all([audioReady, detector.start()]);
      if (request !== micRequest) return;
      micState = 'listening';
      message = '我在听。听到疑似鸣笛时，我会陪你说一句。';
      render();
    } catch (error) {
      if (request !== micRequest) return;
      detector.stop();
      captureFailed(error);
    }
  });

  function voiceLineForPrefetch() {
    return `${selectedVoice}-${nextLine[selectedVoice] + 1}`;
  }

  sensitivity.addEventListener('change', () => {
    writePreference('fujia-sensitivity', sensitivity.value);
    detector?.setSensitivity(sensitivity.value);
  });

  for (const radio of document.querySelectorAll('input[name="voice"]')) {
    radio.addEventListener('change', () => {
      selectedVoice = radio.value;
      writePreference('fujia-voice', selectedVoice);
      if (audioContext) void loadClip(voiceLineForPrefetch()).catch(() => {});
    });
  }

  previewButton.addEventListener('click', async () => {
    const voice = selectedVoice;
    const id = ++playbackId;
    operation = 'preview';
    setPlaybackInterruption(true);
    render();
    animatePlayback();
    try {
      await unlockAudio();
      await playVoice(voice, voiceLine(voice, true), id);
    } catch {
      if (id === playbackId) message = '试听暂时无法播放。检查设备音量后，可以重试。';
    } finally {
      if (id === playbackId) playbackFinished();
    }
  });

  demoButton.addEventListener('click', async () => {
    const voice = selectedVoice;
    const id = ++playbackId;
    operation = 'demo-loading';
    setPlaybackInterruption(true);
    message = '用内置鸣笛样本试一次，无需打开麦克风。';
    render();
    try {
      await unlockAudio();
      if (!detector) throw new Error('Detector unavailable');
      const sample = await loadClip('horn');
      const results = await detector.analyzeAudioBuffer(sample);
      if (id !== playbackId) return;
      if (results.length === 0) {
        message = '这次未识别到鸣笛。可以把灵敏度调高后再试。';
        return;
      }
      operation = 'demo';
      message = '样本识别为鸣笛。';
      render();
      animatePlayback();
      await playClip(sample, .18);
      if (id === playbackId) await playVoice(voice, voiceLine(voice), id, '模拟鸣笛。');
    } catch {
      if (id === playbackId) message = '试玩暂时无法完成。请检查网络后再试。';
    } finally {
      if (id === playbackId) playbackFinished();
    }
  });

  const shareButton = document.getElementById('share-button');
  const shareLabel = document.getElementById('share-label');
  const shareStatus = document.getElementById('share-status');
  const shareFallback = document.getElementById('share-fallback');
  const shareUrl = document.getElementById('share-url');
  let shareFeedback;

  shareButton.addEventListener('click', async () => {
    const link = document.querySelector('link[rel="canonical"]').href;
    clearTimeout(shareFeedback);
    try {
      await navigator.clipboard.writeText(link);
      shareFallback.hidden = true;
      shareLabel.textContent = '已复制';
      shareStatus.textContent = '公开链接已复制。';
      shareFeedback = setTimeout(() => {
        shareLabel.textContent = '复制链接';
        shareStatus.textContent = '';
      }, 2200);
    } catch {
      shareLabel.textContent = '复制链接';
      shareStatus.textContent = '可手动复制公开链接。';
      shareUrl.value = link;
      shareFallback.hidden = false;
      shareUrl.focus();
      shareUrl.select();
    }
  });

  shareFallback.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      shareFallback.hidden = true;
      shareButton.focus();
    }
  });

  window.addEventListener('pagehide', () => {
    micRequest += 1;
    radio?.stop();
    theater?.stop();
    detector?.stop();
    playingSource?.stop();
    micState = 'idle';
    message = '停车时开启，之后可以放下手机。';
    playbackFinished();
  });

  render();
})();
