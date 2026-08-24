import { useCallback, useEffect, useRef } from "react";
import tileTurnUrl from "../assets/sounds/tile-turn.mp3";
import wordClaimUrl from "../assets/sounds/word-claim.mp3";
import wordRejectedUrl from "../assets/sounds/word-rejected.mp3";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const SOUND_URLS = {
  tileTurn: tileTurnUrl,
  wordClaim: wordClaimUrl,
  wordRejected: wordRejectedUrl,
} as const;

export type SoundName = keyof typeof SOUND_URLS;

/** Decodes each gameplay sound once into an AudioBuffer and plays it via a
 * fresh BufferSourceNode per call. Deliberately not HTMLAudioElement/`<audio
 * src>` — its playback-start latency (100ms+ in Chrome) is long enough to
 * clip these clips audibly, especially the shortest ones (see
 * anagrabble#36's artifact notes). No AudioContext is created at all while
 * `enabled` is false, so a player with sound off pays no cost. */
export function useGameSounds(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Partial<Record<SoundName, AudioBuffer>>>({});

  useEffect(() => {
    if (!enabled) return;
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    contextRef.current = context;

    (Object.keys(SOUND_URLS) as SoundName[]).forEach((name) => {
      fetch(SOUND_URLS[name])
        .then((res) => res.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          buffersRef.current[name] = buffer;
        })
        .catch(() => {
          // A missing/undecodable sound shouldn't break gameplay — playSound
          // below just no-ops for it.
        });
    });

    return () => {
      contextRef.current = null;
      buffersRef.current = {};
      context.close();
    };
  }, [enabled]);

  const playSound = useCallback((name: SoundName) => {
    const context = contextRef.current;
    const buffer = buffersRef.current[name];
    if (!context || !buffer) return;
    if (context.state === "suspended") context.resume();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  }, []);

  return { playSound };
}
