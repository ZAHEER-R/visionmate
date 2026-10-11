import { APP_CONFIG } from "./config.js";

class SpeechService {
  constructor() {
    this.enabled = true;
    this.language = APP_CONFIG.defaultLanguage;
    this.rate = 0.96;
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
      const audio = new Audio(task.url);
      this.currentAudio = audio;
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error("Provider speech audio could not be played."));
      audio.play().catch(error => finish(new Error(`Provider speech could not start: ${error.message}`)));
      return;
    }

    if (!("speechSynthesis" in window)) {
      finish(new Error("Spoken feedback is not supported in this browser."));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(task.text);
    utterance.lang = task.options.lang || APP_CONFIG.languages[this.language].voice;
    utterance.rate = task.options.rate || this.rate;
    utterance.pitch = 1;
    utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.name === this.voiceName) || null;
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
