const examples = {
  en: {
    obstacle: "The camera preview is on, but VisionMate does not yet detect obstacles. Please use your cane or other trusted mobility aid.",
    clear: "This prototype cannot confirm that the path is clear. Please use your usual mobility aid and stay aware of traffic.",
    read: "Text reading is not connected yet. A future version can use on-device text recognition with your permission.",
    route: "Turn-by-turn directions are not connected yet. Please use a trusted navigation app.",
    default: "I heard you. If Gemini is configured, I can try to answer your request. App and phone actions still need your confirmation."
  },
  hi: {
    obstacle: "कैमरा चालू है, लेकिन यह प्रोटोटाइप अभी बाधाओं का पता नहीं लगाता। कृपया अपनी छड़ी या भरोसेमंद सहायक का उपयोग करें।",
    clear: "यह प्रोटोटाइप रास्ता साफ़ होने की पुष्टि नहीं कर सकता। कृपया अपने सामान्य सहायक उपकरण का उपयोग करें।",
    read: "पाठ पढ़ने की सुविधा अभी जुड़ी नहीं है।",
    route: "दिशा-निर्देश अभी जुड़े नहीं हैं। कृपया भरोसेमंद नेविगेशन ऐप का उपयोग करें।",
    default: "मैंने आपकी बात सुनी। फोन के काम अभी केवल डेमो हैं और किए नहीं जाते।"
  }
};

export function answerFor(command, language = "en") {
  const responses = examples[language] || examples.en;
  const text = command.toLowerCase();
  if (/obstacle|pothole|danger|vehicle|रास्त|गड्ढ/.test(text)) return { text: responses.obstacle, confidence: 97 };
  if (/clear|path|walk|walking|चल|रास्ता/.test(text)) return { text: responses.clear, confidence: 98 };
  if (/read|menu|sign|document|पढ़/.test(text)) return { text: responses.read, confidence: 99 };
  if (/direction|where|route|station|navigate|दिशा/.test(text)) return { text: responses.route, confidence: 98 };
  return { text: responses.default, confidence: 91 };
}
