// Runtime i18n hydration for static HTML labels.
(function (global) {
  function getTranslator() {
    if (global.FurLabI18nRu && typeof global.FurLabI18nRu.t === "function") {
      return global.FurLabI18nRu.t;
    }
    return function fallback(key, vars, fb) {
      return fb || key;
    };
  }

  function hydrate(root) {
    const t = getTranslator();
    const host = root || global.document;
    if (!host || typeof host.querySelectorAll !== "function") return;
    host.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = String(el.getAttribute("data-i18n") || "").trim();
      if (!key) return;
      const fb = String(el.getAttribute("data-i18n-fallback") || el.textContent || "");
      el.textContent = t(key, null, fb);
    });
    host.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = String(el.getAttribute("data-i18n-title") || "").trim();
      if (!key) return;
      const fb = String(el.getAttribute("title") || "");
      el.setAttribute("title", t(key, null, fb));
    });
  }

  global.FurLabI18nHydrate = Object.assign({}, global.FurLabI18nHydrate || {}, { hydrate });

  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", () => hydrate(global.document));
    } else {
      hydrate(global.document);
    }
  }
})(window);
