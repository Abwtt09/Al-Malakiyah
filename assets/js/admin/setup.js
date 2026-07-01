import { requireAuth, signOut } from "../auth.js";
    import { getUserProfile, setUserProfile } from "../db.js";
    import { writeCachedProfile } from "../profile-cache.js";
    import { supabase, AUTH_DOMAIN_SUFFIX } from "../supabase-config.js";

    document.getElementById('year').textContent = new Date().getFullYear();

    const form = document.getElementById("setupForm");
    const errorEl = document.getElementById("setupError");
    const btn = document.getElementById("setupBtn");
    const label = document.getElementById("setupLabel");

    let currentUser = null;
    let currentProfile = null;

    // Force authenticate and check if setup is already complete
    (async () => {
      try {
        currentUser = await requireAuth();
        currentProfile = await getUserProfile(currentUser.uid);

        if (!currentProfile) {
          throw new Error("لم يتم العثور على ملف تعريف المستخدم.");
        }

        if (currentProfile.isSetupComplete) {
          window.location.replace("index.html");
          return;
        }

        // Prefill username, email, and name if available in stub profile
        if (currentProfile.username) {
          form.elements.username.value = currentProfile.username;
        }
        if (currentProfile.name) {
          form.elements.fullName.value = currentProfile.name;
        }
        if (currentProfile.email && !currentProfile.email.endsWith(AUTH_DOMAIN_SUFFIX)) {
          form.elements.email.value = currentProfile.email;
        }
      } catch (e) {
        console.error(e);
        signOut().then(() => {
          window.location.replace("login.html");
        });
      }
    })();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");

      const fullName = form.elements.fullName.value.trim();
      const username = form.elements.username.value.trim().toLowerCase();
      const email = form.elements.email.value.trim().toLowerCase();
      const password = form.elements.password.value;
      const confirmPassword = form.elements.confirmPassword.value;

      // Validation
      if (fullName.length < 3) {
        errorEl.textContent = "الاسم الكامل يجب أن يتكون من 3 أحرف على الأقل.";
        errorEl.classList.remove("hidden");
        return;
      }

      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        errorEl.textContent = "اسم المستخدم يجب أن يتكون من 3 إلى 20 حرفاً إنجليزياً أو أرقام أو شرطة سفلية فقط.";
        errorEl.classList.remove("hidden");
        return;
      }

      if (password !== confirmPassword) {
        errorEl.textContent = "كلمتا المرور غير متطابقتين.";
        errorEl.classList.remove("hidden");
        return;
      }

      btn.setAttribute("disabled", "");
      label.textContent = "جاري الحفظ والتهيئة...";

      try {
        // 1. Update Auth Email and Password via Edge Function (to bypass GoTrue confirmation & format validations on the old email)
        const { data: resData, error: authError } = await supabase.functions.invoke('create-user', {
          body: {
            action: 'complete-setup',
            uid: currentUser.uid,
            email: email,
            password: password
          }
        });

        if (authError) {
          let errMsg = authError.message || String(authError);
          try {
            if (authError.context) {
              const body = await authError.context.json();
              if (body.error) errMsg = body.error;
            }
          } catch {}
          throw new Error(errMsg);
        }

        // 2. Update DB profile with real email, username, name, and set is_setup_complete to true
        await setUserProfile(currentUser.uid, {
          ...currentProfile,
          username: username,
          name: fullName,
          email: email, // save the real email in profiles
          isSetupComplete: true
        });

        // 3. Update local cache
        writeCachedProfile({
          uid: currentUser.uid,
          email: email,
          ...currentProfile,
          username: username,
          name: fullName,
          email: email,
          role: currentProfile.role,
          isSetupComplete: true
        });

        // Redirect to main index
        window.location.replace("index.html");

      } catch (err) {
        errorEl.textContent = err.message || "حدث خطأ أثناء حفظ الإعدادات.";
        errorEl.classList.remove("hidden");
        btn.removeAttribute("disabled");
        label.textContent = "حفظ وإكمال الإعداد";
      }
    });