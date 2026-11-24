class HornCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(Math.ceil(sampleRate * 0.975));
    this.position = 0;
    this.filled = 0;
    this.frameInterval = Math.round(sampleRate * 0.36);
    this.levelInterval = Math.round(sampleRate * 0.085);
    this.sinceFrame = 0;
    this.sinceLevel = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;

    for (const sample of channel) {
      this.samples[this.position] = sample;
      this.position = (this.position + 1) % this.samples.length;
      this.energy += sample * sample;
    }

    this.filled = Math.min(this.samples.length, this.filled + channel.length);
    this.sinceFrame += channel.length;
    this.sinceLevel += channel.length;
    if (this.sinceLevel >= this.levelInterval) {
      const rms = Math.sqrt(this.energy / this.sinceLevel);
      const level = Math.min(1, Math.pow(rms * 3, 0.6));
      this.port.postMessage({ level });
      this.energy = 0;
      this.sinceLevel = 0;
    }

    if (this.filled === this.samples.length && this.sinceFrame >= this.frameInterval) {
      const frame = new Float32Array(this.samples.length);
      frame.set(this.samples.subarray(this.position));
      frame.set(this.samples.subarray(0, this.position), this.samples.length - this.position);
      this.port.postMessage({ frame }, [frame.buffer]);
      this.sinceFrame = 0;
    }

    return true;
  }
}

registerProcessor('horn-capture', HornCapture);
