// Global Initialization
document.addEventListener("DOMContentLoaded", () => {
  
  // 0. Cinematic Reveal (Do this FIRST so if anything else fails, the site still shows!)
  const transitionLayer = document.querySelector('.page-transition');
  if (transitionLayer) {
    try {
      if (typeof gsap !== 'undefined') {
        gsap.to(transitionLayer, {
          yPercent: -100,
          duration: 1.2,
          ease: "expo.inOut",
          delay: 0.2
        });
      } else {
        transitionLayer.style.display = 'none';
      }
    } catch (e) {
      console.error("Reveal error", e);
      transitionLayer.style.display = 'none';
    }
  }

  // 1. Initialize Lenis for Ultra Smooth Scrolling
  let lenis;
  try {
    if (typeof Lenis !== 'undefined') {
      lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smooth: true,
        direction: 'vertical',
        gestureDirection: 'vertical',
        smoothTouch: false,
        touchMultiplier: 2,
      });

      function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);

      if (typeof gsap !== 'undefined') {
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((time)=>{
          lenis.raf(time * 1000);
        });
        gsap.ticker.lagSmoothing(0, 0);
      }
    }
  } catch (e) {
    console.error("Lenis init error:", e);
  }

  // Ensure GSAP is loaded before continuing
  if (typeof gsap === 'undefined') {
    console.error("GSAP not loaded.");
    return;
  }

  // 2. Custom Luxury Cursor
  try {
    const cursor = document.querySelector('.luxury-cursor');
    if (cursor && window.matchMedia("(pointer: fine)").matches) {
      cursor.style.display = 'block';
      document.body.style.cursor = 'none';
      
      const xTo = gsap.quickTo(cursor, "x", {duration: 0.2, ease: "power3"});
      const yTo = gsap.quickTo(cursor, "y", {duration: 0.2, ease: "power3"});

      window.addEventListener('mousemove', (e) => {
        xTo(e.clientX);
        yTo(e.clientY);
      });

      const interactiveElements = document.querySelectorAll('a, button, .magnetic-wrap, .project-card, .property-card');
      interactiveElements.forEach(el => {
        el.addEventListener('mouseenter', () => {
          cursor.classList.add('active');
          document.body.style.cursor = 'none';
        });
        el.addEventListener('mouseleave', () => {
          cursor.classList.remove('active');
          document.body.style.cursor = 'none';
        });
        el.style.cursor = 'none';
      });
    }
  } catch (e) {
    console.error("Cursor init error:", e);
  }

  // 3. Cinematic Text Reveals (SplitType)
  try {
    if (typeof SplitType !== 'undefined') {
      const splitElements = document.querySelectorAll('.split-text');
      splitElements.forEach((el) => {
        const split = new SplitType(el, { types: 'lines, words, chars' });
        if (split.chars && split.chars.length > 0) {
          gsap.from(split.chars, {
            scrollTrigger: {
              trigger: el,
              start: "top 90%",
            },
            yPercent: 130,
            opacity: 0,
            stagger: 0.02,
            duration: 1,
            ease: "expo.out"
          });
        }
      });

      const splitLines = document.querySelectorAll('.split-text-lines');
      splitLines.forEach((el) => {
        const split = new SplitType(el, { types: 'lines' });
        if (split.lines && split.lines.length > 0) {
          gsap.from(split.lines, {
            scrollTrigger: {
              trigger: el,
              start: "top 85%",
            },
            y: 40,
            opacity: 0,
            stagger: 0.1,
            duration: 1.2,
            ease: "power3.out"
          });
        }
      });
    }
  } catch (e) {
    console.error("SplitType init error:", e);
  }

  // 4. Parallax Images
  try {
    const parallaxImages = document.querySelectorAll('.img-parallax-wrap img');
    parallaxImages.forEach(img => {
      gsap.to(img, {
        yPercent: 20,
        ease: "none",
        scrollTrigger: {
          trigger: img.parentElement,
          start: "top bottom",
          end: "bottom top",
          scrub: true
        }
      });
    });
  } catch (e) {
    console.error("Parallax init error:", e);
  }

  // 5. Magnetic Buttons
  try {
    const magneticElements = document.querySelectorAll('.magnetic-wrap');
    magneticElements.forEach(el => {
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const h = rect.width / 2;
        const x = e.clientX - rect.left - h;
        const y = e.clientY - rect.top - h;
        
        gsap.to(el, {
          x: x * 0.4,
          y: y * 0.4,
          duration: 0.4,
          ease: "power3.out"
        });
      });
      el.addEventListener('mouseleave', () => {
        gsap.to(el, {
          x: 0,
          y: 0,
          duration: 0.7,
          ease: "elastic.out(1, 0.3)"
        });
      });
    });
  } catch (e) {
    console.error("Magnetic buttons init error:", e);
  }

  // 6. Header Scroll Transition (Glass effect)
  try {
    const header = document.querySelector('.glass-header');
    if (header) {
      ScrollTrigger.create({
        start: "top -50",
        onUpdate: (self) => {
          if (self.direction === 1) {
            gsap.to(header, {yPercent: -100, duration: 0.4, ease: "power2.out"});
          } else {
            gsap.to(header, {yPercent: 0, duration: 0.4, ease: "power2.out"});
          }
        }
      });
    }

    const lightSections = document.querySelectorAll('.section-light');
    lightSections.forEach(section => {
      ScrollTrigger.create({
        trigger: section,
        start: "top 80px", 
        end: "bottom 80px",
        onEnter: () => header?.classList.add('light-mode', 'text-charcoal'),
        onLeave: () => header?.classList.remove('light-mode', 'text-charcoal'),
        onEnterBack: () => header?.classList.add('light-mode', 'text-charcoal'),
        onLeaveBack: () => header?.classList.remove('light-mode', 'text-charcoal')
      });
    });
  } catch (e) {
    console.error("Header scroll init error:", e);
  }

  // 7. Mobile Menu
  try {
    const menuToggle = document.querySelectorAll('.menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu-overlay');
    const menuLinks = document.querySelectorAll('.mobile-menu-overlay .menu-link');
    let isMenuOpen = false;

    if (menuToggle.length > 0 && mobileMenu) {
      menuToggle.forEach(toggle => {
        toggle.addEventListener('click', () => {
          isMenuOpen = !isMenuOpen;
          
          if (isMenuOpen) {
            mobileMenu.classList.add('open');
            if (lenis) lenis.stop();
            gsap.fromTo(menuLinks, 
              {y: 40, opacity: 0},
              {y: 0, opacity: 1, duration: 0.8, stagger: 0.1, ease: "power3.out", delay: 0.2}
            );
          } else {
            mobileMenu.classList.remove('open');
            if (lenis) lenis.start();
          }
        });
      });
    }
  } catch (e) {
    console.error("Mobile menu init error:", e);
  }

  // 8. Page Transitions Intercept
  try {
    const links = document.querySelectorAll('a[href]:not([target="_blank"]):not([href^="#"])');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        if (link.hostname === window.location.hostname && transitionLayer) {
          e.preventDefault();
          const href = link.getAttribute('href');
          gsap.to(transitionLayer, {
            yPercent: 0,
            duration: 1,
            ease: "expo.inOut",
            onComplete: () => {
              window.location.href = href;
            }
          });
        }
      });
    });
  } catch (e) {
    console.error("Page transition intercept error:", e);
  }
  
});
