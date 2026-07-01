import { initI18n, applyTranslations } from "../i18n.js";
    import { setupDashboard } from "../portal-ui.js";
    import { watchProperties } from "../db.js";

    initI18n();

    // Typewriter animation for the welcome name
    function typewrite(el, text, speed) {
      el.textContent = "";
      var i = 0;
      var tick = function () {
        if (i <= text.length) {
          el.textContent = text.slice(0, i);
          i++;
          setTimeout(tick, speed || 55);
        }
      };
      tick();
    }

    // Auth + profile — runs silently in background
    (async () => {
      let ctx;
      try {
        ctx = await setupDashboard("index.html");
      } catch (err) {
        var silent = ["not signed in", "no access", "permission denied"];
        if (!silent.some(function (s) { return err.message && err.message.indexOf(s) !== -1; })) {
          console.error("[dashboard]", err);
        }
        return;
      }

      var profile = ctx.profile;
      var firstName = (profile && profile.name && profile.name.split(" ")[0]) || (profile && profile.username) || "";
      if (firstName) {
        setTimeout(function () {
          typewrite(document.getElementById("welcomeName"), firstName, 60);
        }, 320);
      }

      watchProperties(
        function (props) {
          var activeProps = props.filter(function (p) { return p.archived !== true; });
          document.getElementById("qcTotal").textContent = activeProps.length;
          document.getElementById("qcAvailable").textContent = activeProps.filter(function (p) { return p.status === "available"; }).length;
          var withCoords = activeProps.filter(function (p) { return p.coordinates && p.coordinates.lat && p.coordinates.lng; }).length;
          document.getElementById("qcMap").textContent = withCoords;
        },
        function (err) { console.error("[watchProperties]", err); }
      );

      applyTranslations();
    })();