
export interface Track {
  id: string;
  name: string;
  artist: string;
  duration: number;
  bpm: number;
  file: File;
  url: string;
  analyzed: boolean;
  energyLevel?: number;
}

export enum DeckId {
  ONE = 'deck-1',
  TWO = 'deck-2'
}

export interface DeckState {
  id: DeckId;
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  pitch: number;
  queue: Track[];
}

export interface MixAnalysis {
  compatibility: number;
  transitionNote: string;
}
