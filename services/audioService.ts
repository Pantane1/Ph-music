
import { Track } from '../types';

class AudioService {
  private context: AudioContext;
  private deckNodes: Map<string, { 
    source: AudioBufferSourceNode | null, 
    gain: GainNode, 
    panner: StereoPannerNode,
    buffer: AudioBuffer | null 
  }>;
  private masterGain: GainNode;
  private crossfaderGain1: GainNode;
  private crossfaderGain2: GainNode;

  constructor() {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);

    this.crossfaderGain1 = this.context.createGain();
    this.crossfaderGain2 = this.context.createGain();
    
    this.crossfaderGain1.connect(this.masterGain);
    this.crossfaderGain2.connect(this.masterGain);

    this.deckNodes = new Map();
    this.initDeck('deck-1', this.crossfaderGain1);
    this.initDeck('deck-2', this.crossfaderGain2);
  }

  private initDeck(id: string, destination: AudioNode) {
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    gain.connect(panner);
    panner.connect(destination);
    this.deckNodes.set(id, { source: null, gain, panner, buffer: null });
  }

  async loadTrack(deckId: string, file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    const deck = this.deckNodes.get(deckId);
    if (deck) deck.buffer = audioBuffer;
    return audioBuffer;
  }

  play(deckId: string, startTime: number = 0, onEnded?: () => void) {
    const deck = this.deckNodes.get(deckId);
    if (!deck || !deck.buffer) return;

    if (deck.source) {
      deck.source.stop();
    }

    const source = this.context.createBufferSource();
    source.buffer = deck.buffer;
    source.connect(deck.gain);
    source.onended = () => {
      if (onEnded) onEnded();
    };
    source.start(0, startTime);
    deck.source = source;
  }

  pause(deckId: string) {
    const deck = this.deckNodes.get(deckId);
    if (deck && deck.source) {
      deck.source.stop();
      deck.source = null;
    }
  }

  setVolume(deckId: string, volume: number) {
    const deck = this.deckNodes.get(deckId);
    if (deck) deck.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
  }

  setCrossfade(value: number) {
    // value -1 (Deck 1) to 1 (Deck 2)
    // Constant power crossfade
    const v1 = Math.cos((value + 1) * 0.25 * Math.PI);
    const v2 = Math.sin((value + 1) * 0.25 * Math.PI);
    this.crossfaderGain1.gain.setTargetAtTime(v1, this.context.currentTime, 0.05);
    this.crossfaderGain2.gain.setTargetAtTime(v2, this.context.currentTime, 0.05);
  }

  async analyzeBPM(file: File): Promise<number> {
    // Simplified BPM estimation using peak detection
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);
    const step = 200;
    const peaks = [];
    for (let i = 0; i < data.length; i += step) {
      if (data[i] > 0.8) peaks.push(i);
    }
    
    if (peaks.length < 2) return 120; // Fallback

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i-1]);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(60 / (avgInterval / audioBuffer.sampleRate));
    
    // Normalize to common DJ ranges
    if (bpm > 180) return bpm / 2;
    if (bpm < 60) return bpm * 2;
    return bpm;
  }

  resume() {
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
  }

  getCurrentTime(): number {
    return this.context.currentTime;
  }
}

export const audioService = new AudioService();
