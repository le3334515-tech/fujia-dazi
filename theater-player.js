(() => {
  'use strict';

  const collectionKey = 'fujia-theater-endings';

  const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 100;
  const validClip = (clip) => typeof clip?.audio === 'string' && clip.audio.length > 0
    && Number.isFinite(clip.duration) && clip.duration > 0;

  function addEnding(collection, episodeId, endingId) {
    if (!collection.has(episodeId)) collection.set(episodeId, new Set());
    collection.get(episodeId).add(endingId);
  }

  function readCollection() {
    const collection = new Map();
    try {
      const entries = JSON.parse(localStorage.getItem(collectionKey) || '[]');
      if (Array.isArray(entries)) {
        for (const pair of entries) {
          if (Array.isArray(pair) && pair.length === 2 && pair.every(validId)) addEnding(collection, ...pair);
        }
      }
    } catch { /* Collection is available without saved preferences. */ }
    return collection;
  }

  function pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  class TheaterPlayer {
    constructor({ section, getAudioContext, onPlaybackStart }) {
      this.section = section;
      this.getAudioContext = getAudioContext;
      this.onPlaybackStart = onPlaybackStart;
      this.open = section.querySelector('#theater-open');
      this.openLabel = section.querySelector('#theater-open-label');
      this.pause = section.querySelector('#theater-pause');
      this.pauseLabel = section.querySelector('#theater-pause-label');
      this.pauseIcon = section.querySelector('#theater-pause-icon');
      this.alt = section.querySelector('#theater-alt');
      this.title = section.querySelector('#theater-episode-title');
      this.status = section.querySelector('#theater-status');
      this.progress = section.querySelector('#theater-progress');
      this.count = section.querySelector('#theater-count');
      this.collectionList = section.querySelector('#theater-collection');
      this.collection = readCollection();
      this.buffers = new Map();
      this.request = 0;
      this.segment = 0;
      this.startSegment = 0;
      this.offset = 0;
      this.wantsPlayback = false;
      this.interrupted = false;
      this.loading = false;
      this.finished = false;
      this.failed = false;
      this.volume = .72;

      this.open.addEventListener('click', () => this.openBox());
      this.pause.addEventListener('click', () => {
        if (this.wantsPlayback) this.stop();
        else this.start();
      });
      this.alt.addEventListener('click', () => this.playAlternative());
      const archive = this.collectionList.closest('details');
      archive?.addEventListener('toggle', () => {
        if (!archive.open || !this.collection.size || this.episodes) return;
        void this.loadEpisodes().catch(() => {
          this.collectionList.firstElementChild.textContent = '暂时无法查看。重新打开档案或开盒可重试。';
        });
      });
      document.getElementById('theater-quick-start')?.addEventListener('click', () => {
        if (!this.wantsPlayback) {
          if (this.episode && !this.finished) this.start();
          else this.openBox();
        }
        section.scrollIntoView({ block: 'start' });
      });
      this.renderCollection();
      this.render();
    }

    get isPlaying() {
      return Boolean(this.playback);
    }

    loadEpisodes() {
      this.catalogRequest ||= fetch('./theater/episodes.json?v=5').then(async (response) => {
        if (!response.ok) throw new Error('Theater manifest unavailable');
        const { episodes } = await response.json();
        const valid = Array.isArray(episodes) ? episodes.filter((episode) => validId(episode?.id)
          && typeof episode.title === 'string' && validClip(episode.body)
          && Array.isArray(episode.endings) && episode.endings.length > 1
          && episode.endings.every((ending) => validId(ending?.id) && typeof ending.title === 'string' && validClip(ending))) : [];
        if (!valid.length) throw new Error('Theater has no playable episodes');
        this.episodes = valid;
        this.renderCollection();
        return valid;
      }).catch((error) => {
        this.catalogRequest = undefined;
        throw error;
      });
      return this.catalogRequest;
    }

    decodeClip(clip, context) {
      const cache = this.buffers;
      if (!cache.has(clip)) {
        const pending = Promise.resolve().then(() => {
          const binary = atob(clip.audio);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
          return context.decodeAudioData(bytes.buffer);
        }).catch((error) => {
          cache.delete(clip);
          throw error;
        });
        cache.set(clip, pending);
      }
      return cache.get(clip);
    }

    openBox() {
      if (this.loading) return;
      this.resetStory();
      this.episode = undefined;
      this.ending = undefined;
      this.buffers = new Map();
      this.start();
    }

    playAlternative() {
      if (!this.finished) return;
      const alternatives = this.episode.endings.filter((ending) => ending.id !== this.ending.id);
      const newEndings = this.unheardEndings(this.episode, alternatives);
      const selection = pick(newEndings.length ? newEndings : alternatives);
      if (!selection) return;
      this.resetStory();
      this.ending = selection;
      this.segment = 1;
      this.startSegment = 1;
      this.start();
    }

    unheardEndings(episode, endings = episode.endings) {
      const heard = this.collection.get(episode.id);
      return endings.filter((ending) => !heard?.has(ending.id));
    }

    pickStory(episodes) {
      const incomplete = episodes.filter((episode) => this.unheardEndings(episode).length > 0);
      const pool = incomplete.length ? incomplete : episodes;
      const candidates = pool.filter((episode) => episode.id !== this.lastEpisode);
      this.episode = pick(candidates.length ? candidates : pool);
      this.lastEpisode = this.episode.id;
      const unheard = this.unheardEndings(this.episode);
      this.ending = pick(unheard.length ? unheard : this.episode.endings);
    }

    resetStory() {
      this.cancelRequest();
      this.segments = undefined;
      this.segment = 0;
      this.startSegment = 0;
      this.offset = 0;
      this.finished = false;
    }

    start() {
      window.dispatchEvent(new CustomEvent('fujia:activate', { detail: { kind: 'theater' } }));
      this.onPlaybackStart?.();
      this.wantsPlayback = true;
      this.failed = false;
      if (!this.loading && !this.playback) void this.preparePlayback();
    }

    cancelRequest() {
      this.request += 1;
      this.loading = false;
      this.stopSource();
    }

    stop() {
      this.wantsPlayback = false;
      this.cancelRequest();
      this.render();
    }

    setVolume(volume) {
      this.volume = Math.max(0, Math.min(1, volume));
      if (this.playback) this.playback.gain.gain.setTargetAtTime(this.volume, this.playback.context.currentTime, .02);
    }

    getSnapshot() {
      const [body, ending] = this.segments || [];
      const duration = body && ending ? body.duration + ending.duration : 0;
      const tracks = this.episode ? [
        { id: `${this.episode.id}-body`, title: this.episode.title, meta: '故事正文', duration: body?.duration || 0, index: 0 },
        { id: `${this.episode.id}-${this.ending?.id}`, title: this.ending?.title || '随机结局', meta: '结局', duration: ending?.duration || 0, index: 1 },
      ] : [];
      return {
        kind: 'theater',
        loaded: Boolean(this.episode),
        state: this.section.dataset.theaterState,
        title: this.episode?.title || '副驾剧场',
        meta: this.ending ? `结局 · ${this.ending.title}` : '双结局声音盲盒',
        duration,
        progress: Number(this.progress.value) || 0,
        canSeek: false,
        canPrevious: false,
        canNext: Boolean(this.episode),
        transcript: '',
        category: 'theater',
        tracks,
        currentIndex: this.segment,
      };
    }

    emitState() {
      window.dispatchEvent(new CustomEvent('fujia:state', { detail: this.getSnapshot() }));
    }

    setInterruption(interrupted) {
      if (this.interrupted === interrupted) return;
      this.interrupted = interrupted;
      if (interrupted) this.stopSource();
      if (!interrupted && this.wantsPlayback && !this.loading) {
        void this.preparePlayback();
      } else {
        this.render();
      }
    }

    async preparePlayback() {
      const request = ++this.request;
      this.loading = true;
      this.render();
      try {
        const [context, episodes] = await Promise.all([this.getAudioContext(), this.loadEpisodes()]);
        if (this.request !== request) return;
        if (!this.episode) this.pickStory(episodes);
        if (!this.segments) {
          const segments = await Promise.all([this.episode.body, this.ending].map((clip) => this.decodeClip(clip, context)));
          if (this.request !== request) return;
          this.segments = segments;
        }
        if (this.wantsPlayback && !this.interrupted) this.playSegment(context);
      } catch {
        if (this.request === request) this.failPlayback();
      } finally {
        if (this.request === request) {
          this.loading = false;
          this.render();
        }
      }
    }

    failPlayback() {
      this.failed = true;
      this.wantsPlayback = false;
    }

    playSegment(context) {
      if (context.state !== 'running') throw new Error('Theater audio context suspended');
      const clip = this.segments[this.segment];
      const source = context.createBufferSource();
      const gain = context.createGain();
      const offset = Math.min(this.offset, clip.duration);
      source.buffer = clip;
      gain.gain.value = this.volume;
      source.connect(gain).connect(context.destination);
      try {
        source.start(0, offset);
      } catch (error) {
        source.disconnect();
        gain.disconnect();
        throw error;
      }
      this.playback = { source, gain, context, duration: clip.duration, startedAt: context.currentTime - offset };
      source.onended = () => this.finishSegment(source, context);
      this.animateProgress();
    }

    finishSegment(source, context) {
      if (this.playback?.source !== source) return;
      this.stopSource(false);
      if (this.segment === 0) {
        this.segment = 1;
        this.offset = 0;
        try { this.playSegment(context); } catch { this.failPlayback(); }
      } else {
        this.finished = true;
        this.wantsPlayback = false;
        this.collectEnding();
      }
      this.render();
    }

    stopSource(stop = true) {
      if (!this.playback) return;
      const { source, gain, context, startedAt, duration } = this.playback;
      this.playback = undefined;
      this.offset = Math.min(duration, Math.max(0, context.currentTime - startedAt));
      source.onended = null;
      if (stop) source.stop();
      source.disconnect();
      gain.disconnect();
      cancelAnimationFrame(this.animation);
    }

    collectEnding() {
      addEnding(this.collection, this.episode.id, this.ending.id);
      try {
        const entries = [...this.collection].flatMap(([episodeId, ids]) => [...ids].map((id) => [episodeId, id]));
        localStorage.setItem(collectionKey, JSON.stringify(entries));
      } catch { /* Collection still applies for this visit. */ }
      this.renderCollection();
    }

    renderCollection() {
      let collected = 0;
      const list = document.createDocumentFragment();
      if (this.episodes) {
        let total = 0;
        for (const episode of this.episodes) {
          total += episode.endings.length;
          for (const [index, ending] of episode.endings.entries()) {
            if (!this.collection.get(episode.id)?.has(ending.id)) continue;
            const entry = document.createElement('li');
            entry.textContent = `${episode.title} · 结局 ${index + 1}`;
            list.append(entry);
            collected += 1;
          }
        }
        this.count.textContent = `${collected} / ${total}`;
      } else {
        for (const ids of this.collection.values()) collected += ids.size;
        this.count.textContent = `${collected} 已收集`;
      }
      if (!list.childNodes.length) {
        const empty = document.createElement('li');
        empty.textContent = collected ? '正在读取已收集的结局。' : '听完一个结局，它就会出现在这里。';
        list.append(empty);
      }
      this.collectionList.replaceChildren(list);
    }

    paintProgress() {
      const playback = this.playback;
      const [body, ending] = this.segments || [];
      const elapsed = playback ? playback.context.currentTime - playback.startedAt : this.offset;
      const prior = this.segment > this.startSegment ? body?.duration || 0 : 0;
      const total = body ? ending.duration + (this.startSegment === 0 ? body.duration : 0) : 0;
      const progress = total ? (prior + elapsed) / total : 0;
      this.progress.value = this.finished ? 1 : Math.min(1, Math.max(0, progress));
    }

    animateProgress() {
      if (!this.playback) return;
      this.paintProgress();
      this.animation = requestAnimationFrame(() => this.animateProgress());
    }

    render() {
      const state = this.failed ? 'error' : this.loading ? 'loading'
        : this.interrupted && this.wantsPlayback ? 'interrupted' : this.playback ? 'playing'
        : this.finished ? 'ended' : this.episode ? 'paused' : 'idle';
      this.section.dataset.theaterState = state;
      const title = this.episode?.title || '盲盒里有什么？';
      const status = {
        idle: '停车时选好，故事和随机结局会接着播放。',
        loading: '正在准备这盒故事。',
        playing: this.segment === 0 ? '正在讲故事，接着会播放一个随机结局。' : '正在播放结局。',
        interrupted: '副驾先说一句，故事随后继续。',
        paused: '故事暂停了，可以从这里继续。',
        ended: this.ending ? `听到的结局「${this.ending.title}」已收集。` : '',
        error: '故事暂时打不开。检查网络后再试一次。',
      }[state];
      if (this.title.textContent !== title) this.title.textContent = title;
      if (this.status.textContent !== status) this.status.textContent = status;
      this.open.disabled = this.loading;
      this.openLabel.textContent = this.loading ? '正在开盒…' : this.failed && !this.episode ? '重试开盒' : this.episode ? '再开一盒' : '开一盒';
      this.pause.disabled = !this.wantsPlayback && (!this.episode || this.finished);
      this.pauseLabel.textContent = this.wantsPlayback ? '暂停' : this.failed ? '重试播放' : '继续播放';
      this.pauseIcon.setAttribute('href', this.wantsPlayback ? '#i-pause' : '#i-play');
      this.alt.disabled = !this.finished;
      this.paintProgress();
      this.emitState();
    }
  }

  window.TheaterPlayer = TheaterPlayer;
})();
