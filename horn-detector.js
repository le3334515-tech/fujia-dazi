(() => {
  const assets = new URL('./detector/', document.currentScript.src);
  const cooldownMs = 15000;

  // Inference runs sequentially off the UI thread, including sample tests.
  let worker;
  let sequence = 0;
  const pending = new Map();

  function failWorker(failure) {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(failure);
    }
    pending.clear();
  }

  function requestWorker(type, payload = {}, transfer = []) {
    if (!worker) {
      worker = new Worker(new URL('classifier.js', assets));
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        clearTimeout(request.timer);
        if (data.error) {
          request.reject(new Error(data.error));
        } else {
          request.resolve(data.result);
        }
      };
      worker.onerror = () => failWorker(new Error('声音识别组件加载失败，请重试。'));
    }

    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        failWorker(new Error('声音识别组件响应超时，请重试。'));
      }, 45000);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  class HornDetector {
    constructor({ onHorn = () => {}, onLevel = () => {}, onError = () => {} } = {}) {
      this.onHorn = onHorn;
      this.onLevel = onLevel;
      this.onError = onError;
      this.sensitivity = 'normal';
      this.session = null;
    }

    setSensitivity(level) {
      if (['low', 'normal', 'high'].includes(level)) this.sensitivity = level;
    }

    async start() {
      if (this.session) return this.session.ready;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('请在支持麦克风的 HTTPS 浏览器页面打开。');
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('此浏览器暂不支持声音识别。');

      const session = {
        context: new AudioContextClass(),
        busy: false,
        latched: false,
        lastHorn: -Infinity,
      };
      this.session = session;
      session.ready = this.connect(session);
      return session.ready;
    }

    async connect(session) {
      const { context } = session;
      try {
        if (!context.audioWorklet) throw new Error('此浏览器暂不支持声音识别。');

        // Resume in the button's user gesture. Permission can resolve after stop().
        const resume = context.resume();
        const microphone = navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
          video: false,
        }).then((stream) => {
          if (this.session === session) {
            session.stream = stream;
            for (const track of stream.getAudioTracks()) {
              track.addEventListener('ended', () => {
                this.interrupt(session, new Error('麦克风已断开，请重新开启。'));
              }, { once: true });
            }
          } else {
            stream.getTracks().forEach((track) => track.stop());
          }
        });

        await Promise.all([resume, microphone, context.audioWorklet.addModule(new URL('capture.js', assets))]);
        if (this.session !== session) return false;

        await requestWorker('prepare');
        if (this.session !== session) return false;

        session.source = context.createMediaStreamSource(session.stream);
        session.capture = new AudioWorkletNode(context, 'horn-capture', {
          channelCount: 1,
          channelCountMode: 'explicit',
          outputChannelCount: [1],
        });
        session.sink = context.createGain();
        session.sink.gain.value = 0;
        session.capture.port.onmessage = ({ data }) => {
          if (this.session !== session) return;
          if (data.level !== undefined) this.onLevel(data.level);
          if (data.frame) this.inspectFrame(session, data.frame);
        };
        session.capture.onprocessorerror = () => {
          this.interrupt(session, new Error('录音处理已中断，请重新开启。'));
        };
        session.source.connect(session.capture).connect(session.sink).connect(context.destination);
        return true;
      } catch (failure) {
        if (this.session !== session) return false;
        this.stop();
        throw failure;
      }
    }

    async inspectFrame(session, frame) {
      if (session.busy) return;
      session.busy = true;
      try {
        const detections = await this.classify(frame, session.context.sampleRate);
        if (this.session !== session) return;
        if (!detections.length) {
          session.latched = false;
          return;
        }
        const now = Date.now();
        if (!session.latched && now - session.lastHorn >= cooldownMs) {
          session.lastHorn = now;
          this.onHorn({ ...detections[0], timestamp: now });
        }
        session.latched = true;
      } catch (failure) {
        this.interrupt(session, failure);
      } finally {
        session.busy = false;
      }
    }

    classify(samples, sampleRate) {
      return requestWorker('classify', { samples, sampleRate, sensitivity: this.sensitivity }, [samples.buffer]);
    }

    analyzeAudioBuffer(buffer) {
      const samples = buffer.getChannelData(0).slice();
      for (let channel = 1; channel < buffer.numberOfChannels; channel++) {
        const values = buffer.getChannelData(channel);
        for (let index = 0; index < samples.length; index++) samples[index] += values[index];
      }
      if (buffer.numberOfChannels > 1) {
        for (let index = 0; index < samples.length; index++) samples[index] /= buffer.numberOfChannels;
      }
      return this.classify(samples, buffer.sampleRate);
    }

    interrupt(session, failure) {
      if (this.session !== session) return;
      this.stop();
      this.onError(failure);
    }

    stop() {
      const session = this.session;
      if (!session) return;
      this.session = null;
      session.stream?.getTracks().forEach((track) => track.stop());
      session.capture?.port.close();
      session.capture?.disconnect();
      session.source?.disconnect();
      session.sink?.disconnect();
      if (session.context.state !== 'closed') session.context.close().catch(() => {});
      this.onLevel(0);
    }
  }

  window.HornDetector = HornDetector;
})();
