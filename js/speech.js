import { APP_CONFIG } from "./config.js";

class SpeechService {
  constructor() {
    this.enabled = true;
    this.language = APP_CONFIG.defaultLanguage;
    this.rate = 0.96;
    this.recognition = null;
    this.voiceName = localStorage.getItem("visionmate.voice") || "";
  }

  setLanguage(language) {
    this.language = APP_CONFIG.languages[language] ? language : APP_CONFIG.defaultLanguage;
  }

  speak(message, options = {}) {
    const text = String(message || "");
    const live = document.querySelector("#live-feedback");
    if (live) live.textContent = text;
    if (!this.enabled || !("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || APP_CONFIG.languages[this.language].voice;
    utterance.rate = options.rate || this.rate;
    utterance.pitch = 1;
    utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.name === this.voiceName) || null;
    window.speechSynthesis.speak(utterance);
  }

  listen({ onResult, onTranscript, onError, onEnd } = {}) {
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
