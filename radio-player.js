(() => {
  'use strict';

  const catalogs = {
    spoken: { url: './radio/playlist.json?v=5', categories: ['jokes', 'stories', 'riddles'] },
    music: { url: './radio/music.json', categories: ['music'] },
  };
  const catalogCategories = Object.values(catalogs).flatMap(({ categories }) => categories);
  const favoritesKey = 'fujia-radio-favorites';
  const musicPrefix = 'music:';

  function trackKey(track) {
    return track.category === 'music' ? musicPrefix + track.id : track.id;
  }

  function readFavorites() {
    try {
      const ids = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
      if (Array.isArray(ids)) return new Set(ids.filter((id) => typeof id === 'string' && id.length > 0));
    } catch { /* Playback is available without saved preferences. */ }
    return new Set();
  }

  function shuffledTracks(tracks) {
    const order = [...tracks];
    for (let index = order.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    if (order.length > 1 && order.every((track, index) => track === tracks[index])) {
      [order[0], order[1]] = [order[1], order[0]];
    }
    return order;
  }

  function formatDuration(seconds) {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
  }

  class RadioPlayer {
    constructor({ section, getAudioContext, onPlaybackStart }) {
      this.section = section;
      this.getAudioContext = getAudioContext;
      this.onPlaybackStart = onPlaybackStart;
      this.categoryButtons = [...section.querySelectorAll('[data-radio-category]')];
      this.trackTitle = section.querySelector('#radio-track');
      this.trackMeta = section.querySelector('#radio-meta');
      this.progress = section.querySelector('#radio-progress');
      this.play = section.querySelector('#radio-play');
      this.playLabel = section.querySelector('#radio-play-label');
      this.playIcon = section.querySelector('#radio-play-icon');
      this.next = section.querySelector('#radio-next');
      this.counter = section.querySelector('#radio-counter');
      this.shuffle = section.querySelector('#radio-shuffle');
      this.shuffleLabel = section.querySelector('#radio-shuffle-label');
      this.favorite = section.querySelector('#radio-favorite');
      this.favoriteLabel = section.querySelector('#radio-favorite-label');
      this.favoriteIds = readFavorites();
      this.shuffleEnabled = false;
      this.categoryTracks = null;
      this.tracks = [];
      this.buffers = new Map();
      this.catalogRequests = new Map();
      this.index = 0;
      this.offset = 0;
      this.request = 0;
      this.wantsPlayback = false;
      this.interrupted = false;
      this.loading = false;
      this.finished = false;
      this.failed = false;

      for (const button of this.categoryButtons) {
        button.addEventListener('click', () => this.selectCategory(button.dataset.radioCategory));
      }
      this.play.addEventListener('click', () => this.togglePlayback());
      this.next.addEventListener('click', () => this.advance());
      this.shuffle?.addEventListener('click', () => this.toggleShuffle());
      this.favorite?.addEventListener('click', () => this.toggleFavorite());
      document.getElementById('radio-quick-start')?.addEventListener('click', () => {
        this.selectCategory('jokes');
        section.scrollIntoView({ block: 'start' });
      });
      this.render();
    }

    get currentTrack() {
      return this.tracks[this.index];
    }

    get isPlaying() {
      return Boolean(this.playback);
    }

    loadPlaylist(catalog) {
      if (this.catalogRequests.has(catalog)) return this.catalogRequests.get(catalog);
      const { url, categories } = catalogs[catalog];
      const pending = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error('Radio playlist unavailable');
        const { tracks } = await response.json();
        if (!Array.isArray(tracks)) throw new Error('Invalid radio playlist');
        const valid = tracks.filter((track) => typeof track?.id === 'string'
          && track.id.length > 0 && categories.includes(track.category) && typeof track.title === 'string'
          && typeof track.voice === 'string' && typeof track.duration === 'number'
          && track.duration > 0 && typeof track.audio === 'string' && track.audio.length > 0);
        if (!valid.length) throw new Error('Radio playlist is empty');
        return valid;
      }).catch((error) => {
        this.catalogRequests.delete(catalog);
        throw error;
      });
      this.catalogRequests.set(catalog, pending);
      return pending;
    }

    async loadSelectedTracks() {
      if (this.category !== 'favorites') {
        return this.loadPlaylist(this.category === 'music' ? 'music' : 'spoken');
      }
      const sources = new Set([...this.favoriteIds].map((id) => id.startsWith(musicPrefix) ? 'music' : 'spoken'));
      return (await Promise.all([...sources].map((catalog) => this.loadPlaylist(catalog)))).flat();
    }

    decodeTrack(track, context) {
      const key = trackKey(track);
      if (!this.buffers.has(key)) {
        const pending = Promise.resolve().then(() => {
          const bytes = Uint8Array.from(atob(track.audio), (character) => character.charCodeAt(0));
          return context.decodeAudioData(bytes.buffer);
        }).catch((error) => {
          this.buffers.delete(key);
          throw error;
        });
        this.buffers.set(key, pending);
      }
      return this.buffers.get(key);
    }

    selectCategory(category) {
      if (category !== 'favorites' && !catalogCategories.includes(category)) return;
      if (this.category !== category) {
        this.category = category;
        this.resetQueue();
      }
      this.start();
    }

    resetQueue() {
      this.cancelRequest();
      this.categoryTracks = null;
      this.tracks = [];
      this.index = 0;
      this.offset = 0;
      this.finished = false;
    }

    loadQueue(playlist) {
      if (this.category === 'favorites') {
        const byId = new Map(playlist.map((track) => [trackKey(track), track]));
        this.categoryTracks = [...this.favoriteIds].map((id) => byId.get(id)).filter(Boolean);
      } else {
        this.categoryTracks = playlist.filter((track) => track.category === this.category);
      }
      this.tracks = this.shuffleEnabled ? shuffledTracks(this.categoryTracks) : this.categoryTracks;
    }

    toggleShuffle() {
      this.shuffleEnabled = !this.shuffleEnabled;
      if (this.currentTrack) {
        const heard = this.tracks.slice(0, this.index + 1);
        const upcoming = this.shuffleEnabled
          ? shuffledTracks(this.tracks.slice(this.index + 1))
          : this.categoryTracks.filter((track) => !heard.includes(track));
        this.tracks = [...heard, ...upcoming];
      }
      this.render();
    }

    toggleFavorite() {
      const track = this.currentTrack;
      if (!track) return;
      const key = trackKey(track);
      if (!this.favoriteIds.delete(key)) this.favoriteIds.add(key);
      try {
        localStorage.setItem(favoritesKey, JSON.stringify([...this.favoriteIds]));
      } catch { /* Favorites still apply for this visit. */ }
      this.render();
    }

    togglePlayback() {
      if (this.wantsPlayback) {
        this.stop();
      } else {
        this.selectCategory(this.category || 'jokes');
      }
    }

    start() {
      if (this.finished) this.resetQueue();
      this.failed = false;
      if (this.category === 'favorites' && !this.favoriteIds.size && !this.currentTrack) {
        this.categoryTracks = [];
        this.wantsPlayback = false;
        this.render();
        return;
      }
      this.onPlaybackStart?.();
      this.wantsPlayback = true;
      if (!this.isPlaying && !this.loading) void this.prepareTrack();
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

    advance() {
      if (this.index + 1 >= this.tracks.length) return;
      this.cancelRequest();
      this.index += 1;
      this.offset = 0;
      this.failed = false;
      if (this.wantsPlayback) void this.prepareTrack();
      else this.render();
    }

    setInterruption(interrupted) {
      if (this.interrupted === interrupted) return;
      this.interrupted = interrupted;
      if (interrupted) this.stopSource();
      if (!interrupted && this.wantsPlayback && !this.loading) {
        void this.prepareTrack();
      } else {
        this.render();
      }
    }

    async prepareTrack() {
      const request = ++this.request;
      this.loading = true;
      this.render();
      try {
        const [context, playlist] = await Promise.all([
          this.getAudioContext(), this.categoryTracks ? null : this.loadSelectedTracks(),
        ]);
        if (request !== this.request) return;
        if (!this.categoryTracks) this.loadQueue(playlist);
        const track = this.currentTrack;
        if (!track && this.category === 'favorites') {
          this.wantsPlayback = false;
          return;
        }
        if (!track) throw new Error('Selected radio category is empty');
        const clip = await this.decodeTrack(track, context);
        if (request !== this.request) return;
        if (!this.interrupted && this.wantsPlayback) this.playSource(clip, context);
      } catch {
        if (request !== this.request) return;
        this.failed = true;
        this.wantsPlayback = false;
      } finally {
        if (request === this.request) {
          this.loading = false;
          this.render();
        }
      }
    }

    playSource(clip, context) {
      if (context.state !== 'running') throw new Error('Radio audio context suspended');
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = clip;
      gain.gain.value = .72;
      source.connect(gain).connect(context.destination);
      const offset = Math.min(this.offset, clip.duration);
      try {
        source.start(0, offset);
      } catch (error) {
        source.disconnect();
        gain.disconnect();
        throw error;
      }
      this.playback = { source, gain, context, startedAt: context.currentTime - offset, duration: clip.duration };
      source.onended = () => {
        if (this.playback?.source !== source) return;
        this.stopSource(false);
        if (this.index + 1 < this.tracks.length) {
          this.advance();
        } else {
          this.offset = clip.duration;
          this.finished = true;
          this.wantsPlayback = false;
          this.render();
        }
      };
      this.animateProgress();
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

    paintProgress() {
      const playback = this.playback;
      const duration = playback?.duration || this.currentTrack?.duration || 1;
      const position = playback ? playback.context.currentTime - playback.startedAt : this.offset;
      this.progress.value = this.finished ? 1 : Math.max(0, Math.min(1, position / duration));
    }

    animateProgress() {
      if (!this.playback) return;
      this.paintProgress();
      this.animation = requestAnimationFrame(() => this.animateProgress());
    }

    render() {
      const track = this.currentTrack;
      const waitingForVoice = this.interrupted && this.wantsPlayback;
      const favoritesEmpty = this.category === 'favorites' && this.categoryTracks?.length === 0;
      const state = this.failed ? 'error' : this.loading ? 'loading'
        : waitingForVoice ? 'interrupted' : this.isPlaying ? 'playing'
        : this.finished ? 'ended' : favoritesEmpty ? 'empty' : track ? 'paused' : 'idle';
      this.section.dataset.radioState = state;
      const title = track?.title || { loading: '正在加载节目…', empty: '还没有收藏' }[state] || '想听点什么？';
      if (this.trackTitle.textContent !== title) this.trackTitle.textContent = title;
      this.trackMeta.textContent = {
        error: '节目暂时打不开。点「重试」再试一次。',
        interrupted: '副驾陪你说一句，节目随后继续。',
        loading: '正在准备这一段。',
        ended: '这一组播完了。',
        empty: '播放节目时点「收藏」，就能在这里找到它。',
      }[state] || (track ? `${track.voice} · ${formatDuration(track.duration)}` : '听电台无需开启麦克风。');
      this.playLabel.textContent = {
        error: '重试', loading: '取消加载', playing: '暂停', interrupted: '暂停', ended: '重播', paused: '继续播放',
      }[state] || '播放';
      this.playIcon.setAttribute('href', this.wantsPlayback ? '#i-pause' : '#i-play');
      this.play.disabled = state === 'empty';
      this.next.disabled = this.index + 1 >= this.tracks.length;
      const position = track ? `${this.index + 1} / ${this.tracks.length}` : '';
      if (this.counter.textContent !== position) this.counter.textContent = position;
      const favorited = Boolean(track && this.favoriteIds.has(trackKey(track)));
      if (this.favorite) {
        this.favorite.disabled = !track;
        this.favorite.setAttribute('aria-pressed', String(favorited));
      }
      if (this.favoriteLabel) this.favoriteLabel.textContent = favorited ? '已收藏' : '收藏';
      this.shuffle?.setAttribute('aria-pressed', String(this.shuffleEnabled));
      if (this.shuffleLabel) this.shuffleLabel.textContent = this.shuffleEnabled ? '随机播放中' : '随机播放';
      for (const button of this.categoryButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.radioCategory === this.category));
      }
      this.paintProgress();
    }
  }

  window.RadioPlayer = RadioPlayer;
})();
