import {initI18n, t} from "../i18n.js";
      import {signIn, subscribeAuth} from "../auth.js";
      import {clearCachedProfile} from "../profile-cache.js";

      initI18n();
      clearCachedProfile();
      document.querySelector(".num").textContent = new Date().getFullYear();

      // redirect away if already signed in
      subscribeAuth((user) => {
        if (user) window.location.replace("index.html");
      });

      const form = document.getElementById("loginForm");
      const error = document.getElementById("loginError");
      const btn = document.getElementById("signinBtn");
      const label = document.getElementById("signinLabel");

      const pending = sessionStorage.getItem("almalakiyah.loginError") || sessionStorage.getItem("virea.loginError");
      if (pending) {
        error.textContent = pending;
        error.style.whiteSpace = "pre-line";
        error.classList.remove("hidden");
        sessionStorage.removeItem("almalakiyah.loginError");
        sessionStorage.removeItem("virea.loginError");
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        error.classList.add("hidden");
        btn.setAttribute("disabled", "");
        label.textContent = t("login.signing") || "جاري الدخول...";
        try {
          await signIn(
            form.elements.username.value,
            form.elements.password.value,
          );
          window.location.replace("index.html");
        } catch (err) {
          error.textContent = err.code?.startsWith('auth/') ? t("login.failed") : (err.message || t("login.failed"));
          error.classList.remove("hidden");
          btn.removeAttribute("disabled");
          label.textContent = t("login.continue") || "دخول";
        }
      });