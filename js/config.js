export const APP_CONFIG = {
  appName: "VisionMate",
  defaultLanguage: "en",
  languages: {
    en: { name: "English", voice: "en-IN", greeting: "Hello, I’m VisionMate. I’m here beside you." },
    hi: { name: "हिन्दी", voice: "hi-IN", greeting: "नमस्ते, मैं विज़नमेट हूँ। मैं आपके साथ हूँ।" },
    ta: { name: "தமிழ்", voice: "ta-IN", greeting: "வணக்கம், நான் விஷன்மேட். உங்களுடன் இருக்கிறேன்." },
    te: { name: "తెలుగు", voice: "te-IN", greeting: "నమస్కారం, నేను విజన్‌మేట్. మీకు తోడుగా ఉంటాను." },
    kn: { name: "ಕನ್ನಡ", voice: "kn-IN", greeting: "ನಮಸ್ಕಾರ, ನಾನು ವಿಷನ್‌ಮೇಟ್. ನಿಮ್ಮ ಜೊತೆಯಲ್ಲಿದ್ದೇನೆ." },
    ml: { name: "മലയാളം", voice: "ml-IN", greeting: "നമസ്കാരം, ഞാൻ വിഷൻമേറ്റ്. ഞാൻ നിങ്ങളോടൊപ്പം ഉണ്ട്." },
    pa: { name: "ਪੰਜਾਬੀ", voice: "pa-IN", greeting: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਵਿਜ਼ਨਮੇਟ ਹਾਂ। ਮੈਂ ਤੁਹਾਡੇ ਨਾਲ ਹਾਂ।" }
  },
  batteryWarningPercent: 20,
  firebase: {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "visionmate-f164a.firebaseapp.com",
    projectId: "visionmate-f164a",
    databaseURL: "https://visionmate-f164a-default-rtdb.firebaseio.com",
    appId: "YOUR_FIREBASE_APP_ID"
  },
  supabase: {
    url: "https://bwxvnkutnjagqsivuqbz.supabase.co",
    anonKey: "sb_publishable_01yP4XQ5FTgRUfCqzFMIOA_7_uesXZb"
  }
};
