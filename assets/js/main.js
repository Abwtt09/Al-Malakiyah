import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Initialize Lenis for smooth scrolling
const lenis = new Lenis({
  duration: 1.5,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  direction: 'vertical',
  gestureDirection: 'vertical',
  smooth: true,
  mouseMultiplier: 1,
  smoothTouch: false,
  touchMultiplier: 2,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);

document.addEventListener("DOMContentLoaded", () => {
  // 1. Hero Animation (Video Cinematic Sped-up Intro)
  const heroVideo = document.querySelector('.hero-video-el');
  if (heroVideo) {
    // Wait for video metadata to be loaded to set currentTime safely
    const initVideo = () => {
      heroVideo.currentTime = 8;
      heroVideo.playbackRate = 3.75; // Initial high speed
      
      const playPromise = heroVideo.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          // Tween playback rate to 0 over 4 seconds.
          // This area (3.75 * 4 / 3 = 5 seconds) will advance the video from 8s to exactly 13s smoothly.
          gsap.to(heroVideo, {
            playbackRate: 0,
            duration: 4,
            ease: "power2.out",
            onComplete: () => {
              heroVideo.pause();
            }
          });
        }).catch(err => console.log("Video autoplay prevented:", err));
      }
      
      gsap.fromTo(heroVideo, 
        { scale: 1.3 },
        { scale: 1, duration: 4, ease: "power2.out" }
      );
    };

    if (heroVideo.readyState >= 1) {
      initVideo();
    } else {
      heroVideo.addEventListener('loadedmetadata', initVideo);
    }
  }

  const heroLines = document.querySelectorAll('.hero-reveal');
  if (heroLines.length > 0) {
    gsap.to(heroLines, {
      y: 0,
      opacity: 1,
      duration: 1.5,
      stagger: 0.2,
      ease: "power4.out",
      delay: 0.5
    });
  }

  // 2. Parallax Images
  const parallaxImages = document.querySelectorAll('.parallax-image');
  parallaxImages.forEach(image => {
    gsap.to(image, {
      yPercent: 15,
      ease: "none",
      scrollTrigger: {
        trigger: image.parentElement,
        start: "top bottom",
        end: "bottom top",
        scrub: true
      }
    });
  });

  // 3. Mask Reveals for Headings
  const maskLines = document.querySelectorAll('.mask-reveal-el');
  maskLines.forEach(line => {
    gsap.to(line, {
      y: 0,
      opacity: 1,
      duration: 1.5,
      ease: "power4.out",
      scrollTrigger: {
        trigger: line.closest('.text-mask') || line,
        start: "top 85%",
      }
    });
  });

  // 4. Staggered List Items (Services)
  const serviceItems = document.querySelectorAll('.service-item');
  if(serviceItems.length > 0) {
    gsap.fromTo(serviceItems, 
      { y: 40, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 1,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: '.services-container',
          start: "top 80%"
        }
      }
    );
  }
  
  // 5. Stat counters
  const stats = document.querySelectorAll('.stat-number');
  stats.forEach(stat => {
    const target = parseInt(stat.getAttribute('data-target'));
    gsap.to(stat, {
      innerText: target,
      duration: 2,
      snap: { innerText: 1 },
      ease: "power2.out",
      scrollTrigger: {
        trigger: stat,
        start: "top 90%"
      }
    });
  });
});
