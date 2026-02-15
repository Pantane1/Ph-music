
import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Play, Pause, SkipForward, SkipBack, 
  Settings, Music, Sliders, Zap, Layers, Cpu, Radio,
  WifiOff, Wifi, Trash2
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { Track, DeckId, DeckState } from './types';
import { audioService } from './services/audioService';
import * as storage from './services/storage';

const AI_MODEL = 'gemini-3-flash-preview';

export default function App() {
  const [library, setLibrary] = useState<Track[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deck1, setDeck1] = useState<DeckState>({
    id: DeckId.ONE,
    track: null,
    isPlaying: false,
    currentTime: 0,
    volume: 1,
    pitch: 1,
    queue: []
  });
  const [deck2, setDeck2] = useState<DeckState>({
    id: DeckId.TWO,
    track: null,
    isPlaying: false,
    currentTime: 0,
    volume: 1,
    pitch: 1,
    queue: []
  });
  const [crossfade, setCrossfade] = useState(0); 
  const [isAutoMix, setIsAutoMix] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Sync with Online Status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load Library from IndexedDB on startup
  useEffect(() => {
    const loadLibrary = async () => {
      try {
        const savedTracks = await storage.getAllTracks();
        if (savedTracks) {
          // Regenerate Object URLs because they expire after a session ends
          const tracksWithFreshUrls = savedTracks.map(track => ({
            ...track,
            url: track.file ? URL.createObjectURL(track.file) : track.url
          }));
          setLibrary(tracksWithFreshUrls);
        }
      } catch (err) {
        console.warn("Local library load failed (likely private mode):", err);
      }
    };
    loadLibrary();
  }, []);

  useEffect(() => {
    audioService.setCrossfade(crossfade);
  }, [crossfade]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsAnalyzing(true);
    const newTracks: Track[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const bpm = await audioService.analyzeBPM(file);
        const track: Track = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name.replace(/\.[^/.]+$/, ""),
          artist: "Local Artist",
          duration: 0,
          bpm,
          file,
          url: URL.createObjectURL(file),
          analyzed: true,
          energyLevel: Math.floor(Math.random() * 10) + 1
        };
        newTracks.push(track);
        // Try to save to IndexedDB, but don't crash if it fails
        await storage.saveTrack(track).catch(e => console.warn('Could not save track locally', e));
      } catch (err) {
        console.error("Error processing file:", file.name, err);
      }
    }

    setLibrary(prev => [...prev, ...newTracks]);
    setIsAnalyzing(false);
    
    // Clear input so same files can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeTrack = async (id: string) => {
    await storage.deleteTrack(id).catch(() => {});
    setLibrary(prev => prev.filter(t => t.id !== id));
  };

  const loadToDeck = async (deckId: DeckId, track: Track) => {
    try {
      await audioService.loadTrack(deckId, track.file);
      const updateState = (prev: DeckState) => ({ ...prev, track, currentTime: 0, isPlaying: false });
      if (deckId === DeckId.ONE) setDeck1(updateState);
      else setDeck2(updateState);
    } catch (err) {
      console.error("Failed to load track to audio engine:", err);
    }
  };

  const togglePlay = (deckId: DeckId) => {
    audioService.resume();
    const deck = deckId === DeckId.ONE ? deck1 : deck2;
    const setDeck = deckId === DeckId.ONE ? setDeck1 : setDeck2;

    if (deck.isPlaying) {
      audioService.pause(deckId);
      if (timerRef.current[deckId]) {
        clearInterval(timerRef.current[deckId]);
      }
      setDeck(prev => ({ ...prev, isPlaying: false }));
    } else {
      if (!deck.track) return;
      audioService.play(deckId, deck.currentTime, () => {
        if (timerRef.current[deckId]) clearInterval(timerRef.current[deckId]);
        setDeck(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
      });
      
      timerRef.current[deckId] = setInterval(() => {
        setDeck(prev => ({ ...prev, currentTime: prev.currentTime + 1 }));
      }, 1000);
      
      setDeck(prev => ({ ...prev, isPlaying: true }));
    }
  };

  const triggerGo = () => {
    const activeDeck = crossfade <= 0 ? DeckId.ONE : DeckId.TWO;
    const targetDeck = activeDeck === DeckId.ONE ? DeckId.TWO : DeckId.ONE;
    
    // Check if we have a track in the target deck
    const targetTrack = targetDeck === DeckId.ONE ? deck1.track : deck2.track;
    if (!targetTrack) return;

    if (targetDeck === DeckId.ONE && !deck1.isPlaying) togglePlay(DeckId.ONE);
    if (targetDeck === DeckId.TWO && !deck2.isPlaying) togglePlay(DeckId.TWO);

    const duration = 3000;
    const steps = 60;
    const startValue = crossfade;
    const endValue = activeDeck === DeckId.ONE ? 1 : -1;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const newValue = startValue + (endValue - startValue) * progress;
      setCrossfade(newValue);
      
      if (currentStep >= steps) {
        clearInterval(interval);
        if (activeDeck === DeckId.ONE && deck1.isPlaying) togglePlay(DeckId.ONE);
        if (activeDeck === DeckId.TWO && deck2.isPlaying) togglePlay(DeckId.TWO);
      }
    }, duration / steps);
  };

  const analyzeWithAI = async () => {
    if (library.length < 2) return;
    setIsAnalyzing(true);

    if (isOnline) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const trackData = library.map(t => `${t.name} (BPM: ${t.bpm})`).join(', ');
        const response = await ai.models.generateContent({
          model: AI_MODEL,
          contents: `Analyze these tracks for a DJ set: ${trackData}. 
          Identify the two most mixable tracks based on BPM. 
          Provide a short DJ commentary (1 sentence) on why they work together.`,
        });
        setAiAnalysis(`🤖 ${response.text}`);
      } catch (error) {
        console.warn("AI Analysis failed, falling back to local engine:", error);
        runLocalAnalysis();
      }
    } else {
      runLocalAnalysis();
    }
    setIsAnalyzing(false);
  };

  const runLocalAnalysis = () => {
    if (library.length < 2) return;
    
    // Find two tracks with closest BPM
    let bestPair = [library[0], library[1]];
    let minDiff = Math.abs(library[0].bpm - library[1].bpm);

    for (let i = 0; i < library.length; i++) {
      for (let j = i + 1; j < library.length; j++) {
        const diff = Math.abs(library[i].bpm - library[j].bpm);
        if (diff < minDiff) {
          minDiff = diff;
          bestPair = [library[i], library[j]];
        }
      }
    }
    setAiAnalysis(`🏠 Local Match: "${bestPair[0].name}" & "${bestPair[1].name}" are a BPM match.`);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0a0a0c] text-slate-200">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center animate-pulse">
            <Radio size={20} className="text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tighter bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
            GEMINI DJ PRO
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase border ${isOnline ? 'text-green-400 border-green-500/20 bg-green-500/5' : 'text-amber-400 border-amber-500/20 bg-amber-500/5'}`}>
            {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
            {isOnline ? 'Online' : 'Offline Mode'}
          </div>
          <button 
            onClick={analyzeWithAI}
            disabled={isAnalyzing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/20 transition-all text-xs font-medium"
          >
            <Cpu size={14} className={isAnalyzing ? "animate-spin" : ""} />
            {isOnline ? 'AI ANALYZE' : 'LOCAL ANALYZE'}
          </button>
        </div>
      </header>

      {/* Main DJ Surface */}
      <main className="flex-1 flex flex-col md:flex-row gap-0.5 bg-black p-0.5 overflow-hidden">
        {/* Deck 1 */}
        <div className={`flex-1 flex flex-col p-4 transition-all duration-500 ${crossfade > 0.5 ? 'opacity-40 grayscale-[0.5]' : 'bg-gradient-to-br from-blue-900/20 to-zinc-900'}`}>
          <DeckHeader deckId={DeckId.ONE} track={deck1.track} />
          <Waveform isPlaying={deck1.isPlaying} color="#60a5fa" />
          <div className="mt-auto space-y-4">
            <div className="flex items-center justify-between">
              <div className="mono text-2xl font-bold text-blue-400">
                {formatTime(deck1.currentTime)}
              </div>
              <div className="text-xs font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                DECK 1
              </div>
            </div>
            <div className="flex items-center justify-center gap-6">
              <button className="p-3 text-zinc-500 hover:text-white"><SkipBack size={24} /></button>
              <button 
                onClick={() => togglePlay(DeckId.ONE)}
                className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center hover:bg-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all"
              >
                {deck1.isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-1" />}
              </button>
              <button className="p-3 text-zinc-500 hover:text-white"><SkipForward size={24} /></button>
            </div>
          </div>
        </div>

        {/* Mixer Center Section */}
        <div className="w-full md:w-32 bg-zinc-900 border-x border-zinc-800 flex flex-col items-center py-6 gap-8">
          <div className="flex-1 flex flex-col items-center gap-12 w-full px-2">
            <div className="w-full space-y-1">
              <div className="text-[10px] text-zinc-500 text-center uppercase tracking-widest font-bold">Gain 1</div>
              <VerticalSlider value={deck1.volume * 100} color="blue" />
            </div>
            
            <button 
              onClick={triggerGo}
              className="w-20 h-20 rounded-2xl bg-indigo-600 border-4 border-indigo-400/50 flex flex-center items-center justify-center shadow-[0_0_30px_rgba(79,70,229,0.5)] hover:scale-105 active:scale-95 transition-all group"
            >
              <span className="text-2xl font-black text-white italic tracking-tighter group-hover:scale-110 transition-transform">GO</span>
            </button>

            <div className="w-full space-y-1">
              <div className="text-[10px] text-zinc-500 text-center uppercase tracking-widest font-bold">Gain 2</div>
              <VerticalSlider value={deck2.volume * 100} color="pink" />
            </div>
          </div>
          
          <div className="w-full px-4 pb-4">
            <div className="relative h-12 flex items-center">
              <input 
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={crossfade}
                onChange={(e) => setCrossfade(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Deck 2 */}
        <div className={`flex-1 flex flex-col p-4 transition-all duration-500 ${crossfade < -0.5 ? 'opacity-40 grayscale-[0.5]' : 'bg-gradient-to-br from-pink-900/20 to-zinc-900'}`}>
          <DeckHeader deckId={DeckId.TWO} track={deck2.track} colorClass="text-pink-400" />
          <Waveform isPlaying={deck2.isPlaying} color="#f472b6" />
          <div className="mt-auto space-y-4">
             <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-pink-500 bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20">
                DECK 2
              </div>
              <div className="mono text-2xl font-bold text-pink-400">
                {formatTime(deck2.currentTime)}
              </div>
            </div>
            <div className="flex items-center justify-center gap-6">
              <button className="p-3 text-zinc-500 hover:text-white"><SkipBack size={24} /></button>
              <button 
                onClick={() => togglePlay(DeckId.TWO)}
                className="w-16 h-16 rounded-full bg-pink-600 flex items-center justify-center hover:bg-pink-500 shadow-[0_0_20px_rgba(219,39,119,0.4)] transition-all"
              >
                {deck2.isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-1" />}
              </button>
              <button className="p-3 text-zinc-500 hover:text-white"><SkipForward size={24} /></button>
            </div>
          </div>
        </div>
      </main>

      {/* Library Bottom Sheet */}
      <section className="h-1/3 bg-zinc-900 border-t border-zinc-800 flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/50">
          <div className="flex items-center gap-4 overflow-hidden">
            <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2 flex-shrink-0">
              <Layers size={16} /> Library
            </h2>
            {aiAnalysis && (
              <div className="text-[11px] bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full border border-indigo-500/30 flex items-center gap-2 animate-in fade-in slide-in-from-left-2 truncate">
                <Zap size={10} className="fill-indigo-400 flex-shrink-0" />
                <span className="truncate">{aiAnalysis}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg flex items-center gap-2 text-sm font-semibold transition-all shadow-lg"
            >
              <Plus size={16} /> IMPORT
            </button>
            <input type="file" ref={fileInputRef} multiple className="hidden" accept="audio/*" onChange={handleFileUpload} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {library.map((track) => (
              <div key={track.id} className="group bg-zinc-800/40 hover:bg-zinc-800 p-3 rounded-xl border border-zinc-700/30 transition-all flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-10 h-10 rounded bg-zinc-700 flex items-center justify-center text-zinc-400">
                    <Music size={20} />
                  </div>
                  <div className="overflow-hidden">
                    <h3 className="text-sm font-semibold truncate group-hover:text-white">{track.name}</h3>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 mono">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-blue-400 border border-blue-500/20">{track.bpm} BPM</span>
                      <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-amber-400 font-bold uppercase tracking-tighter">Energy {track.energyLevel}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => loadToDeck(DeckId.ONE, track)} className="p-2 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg transition-colors">1</button>
                  <button onClick={() => loadToDeck(DeckId.TWO, track)} className="p-2 bg-pink-600/20 hover:bg-pink-600 text-pink-400 hover:text-white rounded-lg transition-colors">2</button>
                  <button onClick={() => removeTrack(track.id)} className="p-2 hover:bg-red-500 text-zinc-500 hover:text-white rounded-lg transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Floating Status Bar */}
      <div className="absolute bottom-4 right-4 z-50">
        <div className="bg-black/80 backdrop-blur-xl border border-zinc-700/50 rounded-full px-4 py-2 flex items-center gap-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-amber-500'} animate-pulse`} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{isOnline ? 'Cloud Engine' : 'Local Storage'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Helper Components */

function DeckHeader({ deckId, track, colorClass = "text-blue-400" }: { deckId: DeckId, track: Track | null, colorClass?: string }) {
  return (
    <div className="mb-6">
      {track ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black truncate max-w-[80%] uppercase italic tracking-tighter text-white">
              {track.name}
            </h2>
            <div className={`mono text-sm font-bold ${colorClass}`}>
              {track.bpm} BPM
            </div>
          </div>
          <p className="text-xs text-zinc-400 font-medium uppercase tracking-widest">
            {track.artist}
          </p>
        </div>
      ) : (
        <div className="h-12 flex items-center justify-center border-2 border-dashed border-zinc-800 rounded-xl text-zinc-600 text-xs font-bold uppercase tracking-widest">
          Load Track
        </div>
      )}
    </div>
  );
}

function Waveform({ isPlaying, color }: { isPlaying: boolean, color: string }) {
  return (
    <div className="relative h-24 w-full bg-zinc-900/50 rounded-xl overflow-hidden flex items-center justify-center gap-[2px] px-2 border border-zinc-800/50">
      {Array.from({ length: 40 }).map((_, i) => (
        <div 
          key={i} 
          className="w-1.5 rounded-full bg-zinc-700 transition-all duration-300"
          style={{ 
            height: isPlaying ? `${Math.random() * 80 + 10}%` : '20%',
            backgroundColor: isPlaying ? color : undefined,
            boxShadow: isPlaying ? `0 0 10px ${color}44` : undefined,
            opacity: 0.3 + (Math.random() * 0.7)
          }}
        />
      ))}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/30 z-10" />
    </div>
  );
}

function VerticalSlider({ value, color }: { value: number, color: 'blue' | 'pink' }) {
  const accentColor = color === 'blue' ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.5)]';
  return (
    <div className="h-32 w-4 bg-zinc-800 rounded-full relative overflow-hidden flex items-end mx-auto">
      <div 
        className={`w-full transition-all duration-200 ${accentColor}`}
        style={{ height: `${value}%` }}
      />
    </div>
  );
}

function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
