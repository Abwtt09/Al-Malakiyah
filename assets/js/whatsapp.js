"use strict";

// Replace with your Worker URL after: wrangler deploy
const ENDPOINT = "https://whatsapp-proxy.YOUR-SUBDOMAIN.workers.dev";

const form = document.getElementById("whatsappForm");
const phoneInput = document.getElementById("waPhone");
const messageInput = document.getElementById("waMessage");
const submitBtn = document.getElementById("waSubmit");
const statusEl = document.getElementById("waStatus");

function setStatus(type, text) {
  statusEl.textContent = text;
  statusEl.className = "wa-status wa-status--" + type;
  statusEl.hidden = false;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.className = "wa-status";
  statusEl.textContent = "";
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.setAttribute("aria-busy", loading);
  submitBtn.textContent = loading ? "جاري الإرسال…" : "إرسال الرسالة";
}

function validateForm(phone, message) {
  if (!phone.trim()) return "يرجى إدخال رقم الهاتف.";
  if (!/^\+?[0-9]{7,15}$/.test(phone.trim())) return "رقم الهاتف غير صالح. مثال: 96812345678";
  if (!message.trim()) return "يرجى كتابة الرسالة.";
  if (message.trim().length > 4096) return "الرسالة تتجاوز الحد المسموح (4096 حرف).";
  return null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const phone = phoneInput.value;
  const message = messageInput.value;

  const validationError = validateForm(phone, message);
  if (validationError) {
    setStatus("error", validationError);
    return;
  }

  setLoading(true);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim(), message: message.trim() }),
    });

    const data = await res.json();

    if (data.success) {
      setStatus("success", `تم إرسال الرسالة بنجاح. معرف الرسالة: ${data.messageId}`);
      messageInput.value = "";
    } else {
      setStatus("error", `فشل الإرسال: ${data.error || "خطأ غير معروف"}`);
    }
  } catch (err) {
    setStatus("error", "تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.");
    console.error("WhatsApp send error:", err);
  } finally {
    setLoading(false);
  }
});

// Clear status when user starts editing
[phoneInput, messageInput].forEach((el) =>
  el.addEventListener("input", clearStatus)
);
