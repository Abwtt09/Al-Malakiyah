// Fallback: if module script fails to load, show error on loading overlay
    window.__mapLoaded = false;
    setTimeout(function () {
      if (!window.__mapLoaded) {
        var el = document.getElementById("mapLoading");
        if (el)
          el.innerHTML =
            '<div style="text-align:center;padding:2rem;max-width:24rem;font-family:system-ui;">' +
            '<p style="color:#ef4444;font-size:1rem;font-weight:600;margin-bottom:.5rem;">فشل تحميل الخريطة</p>' +
            '<p style="color:rgba(255,255,255,.25);font-size:.75rem;margin-top:1rem;">Failed to load map module. Try opening via local HTTP server or check network.</p></div>';
      }
    }, 8000);