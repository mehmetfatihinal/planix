import { useCallback, useEffect, useRef, useState } from "react";
import Constants from "expo-constants";

type SpeechRecognitionEventName = "start" | "end" | "result" | "error";

type SpeechRecognitionModuleLike = {
  addListener?: (eventName: string, listener: (event: any) => void) => { remove: () => void };
  isRecognitionAvailable?: () => boolean;
  requestPermissionsAsync?: () => Promise<{ granted?: boolean }>;
  start?: (options: Record<string, unknown>) => void;
  stop?: () => Promise<void> | void;
};

function isExpoGo() {
  return Constants.appOwnership === "expo";
}

function getSpeechRecognitionModule(): SpeechRecognitionModuleLike | null {
  if (isExpoGo()) {
    return null;
  }

  try {
    const speech = require("expo-speech-recognition") as {
      ExpoSpeechRecognitionModule?: SpeechRecognitionModuleLike;
    };

    return speech.ExpoSpeechRecognitionModule ?? null;
  } catch {
    return null;
  }
}

export function useSpeechRecognitionEventCompat(eventName: SpeechRecognitionEventName, listener: (event: any) => void) {
  useEffect(() => {
    const module = getSpeechRecognitionModule();
    if (!module?.addListener) {
      return;
    }

    const subscription = module.addListener(eventName, listener);
    return () => subscription?.remove();
  }, [eventName, listener]);
}

export async function isSpeechRecognitionAvailable() {
  const module = getSpeechRecognitionModule();
  return Boolean(module?.isRecognitionAvailable?.());
}

export async function requestSpeechRecognitionPermissions() {
  const module = getSpeechRecognitionModule();
  if (!module?.requestPermissionsAsync) {
    return { granted: false, unavailable: true as const };
  }

  const permission = await module.requestPermissionsAsync();
  return { granted: Boolean(permission?.granted), unavailable: false as const };
}

export async function startSpeechRecognition(options: Record<string, unknown>) {
  const module = getSpeechRecognitionModule();
  if (!module?.start) {
    throw new Error("Ses tanima Expo Go icinde kullanilamiyor. Development build gerekli.");
  }

  module.start(options);
}

export async function stopSpeechRecognition() {
  const module = getSpeechRecognitionModule();
  if (!module?.stop) {
    return;
  }

  await module.stop();
}

export function isSpeechRecognitionUnsupportedInExpoGo() {
  return isExpoGo();
}

// Small reusable dictation hook for inputs outside the capture screen (snooze reason,
// assistant question). Only reacts to events while THIS instance started the session, so
// several mounted consumers never cross-talk. Final transcripts are pushed to onTranscript.
export function useDictation(language: string, onTranscript: (text: string) => void) {
  const [available, setAvailable] = useState(false);
  const [dictating, setDictating] = useState(false);
  const activeRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    isSpeechRecognitionAvailable()
      .then((result) => setAvailable(result && !isExpoGo()))
      .catch(() => setAvailable(false));
  }, []);

  const handleResult = useCallback((event: any) => {
    if (!activeRef.current) return;
    const fragment = event?.results?.[0]?.transcript?.trim();
    if (fragment && event?.isFinal) {
      onTranscriptRef.current(fragment);
    }
  }, []);
  const handleEnd = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setDictating(false);
  }, []);

  useSpeechRecognitionEventCompat("result", handleResult);
  useSpeechRecognitionEventCompat("end", handleEnd);
  useSpeechRecognitionEventCompat("error", handleEnd);

  const toggle = useCallback(async () => {
    if (activeRef.current) {
      await stopSpeechRecognition();
      activeRef.current = false;
      setDictating(false);
      return;
    }

    const permission = await requestSpeechRecognitionPermissions();
    if (!permission.granted) return;

    activeRef.current = true;
    setDictating(true);
    try {
      await startSpeechRecognition({
        lang: language,
        interimResults: false,
        continuous: false,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false
      });
    } catch {
      activeRef.current = false;
      setDictating(false);
    }
  }, [language]);

  return { available, dictating, toggle };
}
