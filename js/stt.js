const MAX_RECORDING_MS = 20_000;
const MAX_WAV_BYTES = 5 * 1024 * 1024;
let activeRecorder = null;

function floatToWav(audioBuffer, targetRate = 16_000) {
  const channelCount = audioBuffer.numberOfChannels;
  const sourceLength = audioBuffer.length;
  const sourceRate = audioBuffer.sampleRate;
  const targetLength = Math.floor(sourceLength * targetRate / sourceRate);
  const samples = new Int16Array(targetLength);
  for (let index = 0; index < targetLength; index += 1) {
    const sourceIndex = Math.min(sourceLength - 1, Math.floor(index * sourceRate / targetRate));
    let sample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) sample += audioBuffer.getChannelData(channel)[sourceIndex];
    sample /= channelCount;
    samples[index] = Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff);
  }

  const bytes = new ArrayBuffer(44 + samples.byteLength);
  const view = new DataView(bytes);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.byteLength, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return new Blob([bytes], { type: "audio/wav" });
}

export function stopRecording() {
  if (activeRecorder?.state === "recording") activeRecorder.stop();
}

export async function recordWav(onStatus = () => {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error("Audio recording is not supported. Allow microphone access or use the browser speech button.");
  }
  if (activeRecorder) throw new Error("A recording is already in progress.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const supportedMime = ["audio/webm;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
  activeRecorder = recorder;
  const chunks = [];

  return new Promise((resolve, reject) => {
    let intervalId;
    const timeoutId = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
    const started = Date.now();
    const cleanup = () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      stream.getTracks().forEach(track => track.stop());
      activeRecorder = null;
    };
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("The microphone recording failed. Please try again."));
    };
    recorder.onstop = async () => {
      cleanup();
      try {
        const source = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const context = new AudioContext();
        const decoded = await context.decodeAudioData(await source.arrayBuffer());
        const wav = floatToWav(decoded);
        await context.close();
        if (wav.size > MAX_WAV_BYTES) throw new Error("Recording exceeds the 5 MB WAV limit.");
        resolve(wav);
      } catch (error) {
        reject(new Error(`Could not convert the recording to WAV: ${error.message}`));
      }
    };
    recorder.start(250);
    onStatus("Recording… 00:00 / 00:20. Tap Stop recording when you’re done.");
    intervalId = setInterval(() => {
      const seconds = Math.min(20, Math.floor((Date.now() - started) / 1000));
      onStatus(`Recording… 00:${String(seconds).padStart(2, "0")} / 00:20`);
    }, 500);
  });
}
