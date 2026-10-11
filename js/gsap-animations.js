export function animateView(element) {
  if (!window.gsap || !element) return;
  window.gsap.fromTo(element, { y: 12 }, { y: 0, duration: 0.38, ease: "power2.out" });
  const animatedElements = [...element.querySelectorAll("[data-animate]")];
  if (!animatedElements.length) return;
  window.gsap.fromTo(animatedElements, { autoAlpha: 0, y: 10 }, {
    autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.055, delay: 0.08, ease: "power2.out"
  });
}

export function pressFeedback(element) {
  if (!window.gsap || !element) return;
  window.gsap.fromTo(element, { scale: 0.97 }, { scale: 1, duration: 0.24, ease: "back.out(2)" });
}

export function setVisionActive(active) {
  if (!window.gsap) return;
  const eye = document.querySelector(".camera-eye");
  if (!eye) return;
  window.gsap.to(eye, { scale: active ? 1.08 : 1, duration: 0.7, repeat: active ? -1 : 0, yoyo: true, ease: "sine.inOut" });
}
