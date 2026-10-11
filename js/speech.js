import { APP_CONFIG } from "./config.js";
import { generateGeminiSpeech } from "./supabase.js";

function makeGeminiAudioUrl({ audioBase64, mimeType }) {
  if (typeof audioBase64 !== "string" || !audioBase64) throw new Error("Gemini returned no speech audio.");
  const bytes = Uint8Array.from(atob(audioBase64), character => character.charCodeAt(0));
  if (mimeType?.toLowerCase().includes("wav")) {
    return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  }

  const sampleRate = Number(mimeType?.match(/rate=(\d+)/i)?.[1]) || 24000;
  const wav = new ArrayBuffer(44 + bytes.length);
  const header = new DataView(wav);
  const writeText = (offset, value) => [...value].forEach((character, index) => header.setUint8(offset + index, character.charCodeAt(0)));
  writeText(0, "RIFF");
  header.setUint32(4, 36 + bytes.length, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeText(36, "data");
  header.setUint32(40, bytes.length, true);
  new Uint8Array(wav, 44).set(bytes);
  return URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
}

class SpeechService {
  constructor() {
    this.enabled = true;
    this.language = APP_CONFIG.defaultLanguage;
    this.rate = 0.96;
    this.engine = localStorage.getItem("visionmate.speechEngine") === "gemini" ? "gemini" : "device";
    this.recognition = null;
    this.voiceName = localStorage.getItem("visionmate.voice") || "";
    this.queue = [];
    this.currentTask = null;
    this.currentAudio = null;
    this.currentUtterance = null;
  }

  setLanguage(language) {
    this.language = APP_CONFIG.languages[language] ? language : APP_CONFIG.defaultLanguage;
  }

  setEngine(engine) {
    this.engine = engine === "gemini" ? "gemini" : "device";
  }

  getLanguageCode(locale = APP_CONFIG.languages[this.language].voice) {
    return Object.entries(APP_CONFIG.languages).find(([, item]) =>
      item.voice.toLowerCase() === String(locale).toLowerCase())?.[0] || this.language;
  }

  speak(message, options = {}) {
    const text = String(message || "").trim();
    const live = document.querySelector("#live-feedback");
    if (live && text) live.textContent = text;
    if (!this.enabled || !text) return;
    this.queue.push({ type: "speech", text, options });
    this.processQueue();
  }

  playAudio(url) {
    if (!this.enabled) return Promise.reject(new Error("Spoken feedback is turned off."));
    if (typeof url !== "string" || !url.startsWith("https://")) {
      return Promise.reject(new Error("Speech audio URL must use HTTPS."));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ type: "audio", url, resolve, reject });
      this.processQueue();
    });
  }

  processQueue() {
    if (this.currentTask || !this.enabled) return;
    const task = this.queue.shift();
    if (!task) return;
    this.currentTask = task;
    const finish = (error = null, cancelled = false) => {
      if (this.currentTask !== task) return;
      this.currentTask = null;
      this.currentAudio = null;
      this.currentUtterance = null;
      this.currentAudioCleanup?.();
      this.currentAudioCleanup = null;
      if (task.type === "audio") {
        if (cancelled) task.resolve();
        else if (error) task.reject(error);
        else task.resolve();
      } else if (error && !cancelled) {
        task.options.onError?.(error);
      }
      this.processQueue();
    };

    if (task.type === "audio") {
      this.startAudio(task.url, finish);
      return;
    }

    if (this.engine === "gemini") {
      generateGeminiSpeech({ text: task.text, language: this.getLanguageCode(task.options.lang) }).then(audio => {
        if (this.currentTask !== task) return;
        const url = makeGeminiAudioUrl(audio);
        this.startAudio(url, finish, () => URL.revokeObjectURL(url));
      }).catch(error => {
        if (this.currentTask !== task) return;
        console.error("Gemini speech generation failed:", error);
        const utteranceLanguage = task.options.lang || APP_CONFIG.languages[this.language].voice;
        const languagePrefix = utteranceLanguage.toLowerCase().split("-")[0];
        const hasMatchingDeviceVoice = window.speechSynthesis?.getVoices()
          .some(voice => voice.lang.toLowerCase().startsWith(languagePrefix));
        window.dispatchEvent(new CustomEvent("visionmate:speech-error", {
          detail: {
            message: hasMatchingDeviceVoice || languagePrefix === "en"
              ? `Gemini voice unavailable; trying the device voice. ${error.message}`
              : `Gemini voice unavailable, and no matching ${utteranceLanguage} device voice is installed. ${error.message}`
          }
        }));
        if (hasMatchingDeviceVoice || languagePrefix === "en") this.speakOnDevice(task, finish);
        else finish(error);
      });
      return;
    }

    this.speakOnDevice(task, finish);
  }

  startAudio(url, finish, cleanup = null) {
    const audio = new Audio(url);
    this.currentAudio = audio;
    this.currentAudioCleanup = cleanup;
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("Speech audio could not be played."));
    audio.play().catch(error => finish(new Error(`Speech audio could not start: ${error.message}`)));
  }

  speakOnDevice(task, finish) {
    if (!("speechSynthesis" in window)) {
      finish(new Error("Spoken feedback is not supported in this browser."));
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    const utteranceLanguage = task.options.lang || APP_CONFIG.languages[this.language].voice;
    const languagePrefix = utteranceLanguage.toLowerCase().split("-")[0];
    const matchingVoice = voices.find(voice => voice.name === this.voiceName &&
      voice.lang.toLowerCase().startsWith(languagePrefix)) ||
      voices.find(voice => voice.lang.toLowerCase().startsWith(languagePrefix));
    if (languagePrefix !== "en" && voices.length && !matchingVoice) {
      window.dispatchEvent(new CustomEvent("visionmate:speech-error", {
        detail: { message: `No installed voice for ${utteranceLanguage} was found. Select Gemini voice in Me settings.` }
      }));
      finish(new Error(`No installed voice for ${utteranceLanguage} is available.`));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(task.text);
    utterance.lang = utteranceLanguage;
    utterance.rate = task.options.rate || this.rate;
    utterance.pitch = 1;
    utterance.voice = matchingVoice || null;
    utterance.onstart = task.options.onStart || null;
    utterance.onend = () => finish();
    utterance.onerror = event => finish(new Error(`Spoken feedback failed: ${event.error || "speech error"}`));
    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  cancel() {
    this.queue.splice(0).forEach(task => {
      if (task.type === "audio") task.resolve();
    });
    const task = this.currentTask;
    this.currentTask = null;
    this.currentAudio?.pause();
    if (this.currentAudio) this.currentAudio.src = "";
    this.currentAudio = null;
    this.currentAudioCleanup?.();
    this.currentAudioCleanup = null;
    this.currentUtterance = null;
    window.speechSynthesis?.cancel();
    if (task?.type === "audio") task.resolve();
  }

  listen({ onResult, onTranscript, onError, onEnd } = {}) {
    this.cancel();
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      onError?.("Voice recognition is not supported in this browser. Please type your request.");
      return null;
    }
    this.stopListening();
    const recognition = new Recognition();
    recognition.lang = APP_CONFIG.languages[this.language].voice;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (interimText) onTranscript?.(interimText);
      if (finalText.trim()) onResult?.(finalText.trim());
    };
    recognition.onerror = event => onError?.(event.error === "not-allowed"
      ? "Microphone permission was denied. You can type instead."
      : "I couldn’t hear that clearly. Please try again or type your request.");
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      onEnd?.();
    };
    this.recognition = recognition;
    recognition.start();
    return recognition;
  }

  stopListening() {
    if (!this.recognition) return;
    this.recognition.onend = null;
    this.recognition.stop();
    this.recognition = null;
  }
}

export const speech = new SpeechService();
