(function (global) {
  function createLayoutTypePicker(options) {
    const opts = options && typeof options === "object" ? options : {};
    const byId = typeof opts.byId === "function"
      ? opts.byId
      : (id) => global.document && global.document.getElementById(id);
    const getCatalog = typeof opts.getCatalog === "function" ? opts.getCatalog : (() => []);
    const getCardHtml = typeof opts.getCardHtml === "function" ? opts.getCardHtml : ((mode, item) => String(item && item.title || item && item.name || ""));
    const getPreferredKey = typeof opts.getPreferredKey === "function" ? opts.getPreferredKey : (() => "");
    const getLibraryMode = typeof opts.getLibraryMode === "function" ? opts.getLibraryMode : (() => "layouts");
    const setLibraryMode = typeof opts.setLibraryMode === "function" ? opts.setLibraryMode : (() => {});
    const getItemKey = typeof opts.getItemKey === "function" ? opts.getItemKey : ((_mode, item) => String(item && item.mode || item && item.id || ""));
    const getAddButtonLabel = typeof opts.getAddButtonLabel === "function" ? opts.getAddButtonLabel : (() => "Выбрать");

    let selectedKey = null;
    let searchTerm = "";
    let selectedCategory = "";

    function getFilteredCatalog(catalog, libraryMode) {
      const q = String(searchTerm || "").trim().toLowerCase();
      return catalog.filter((item) => {
        if (libraryMode === "materials" && selectedCategory && String(item && item.category || "") !== selectedCategory) {
          return false;
        }
        if (!q) return true;
        const mode = String(getItemKey(libraryMode, item) || "").toLowerCase();
        const title = String(item && item.title || item && item.name || "").toLowerCase();
        const category = String(item && item.category || "").toLowerCase();
        const species = String(item && item.species || "").toLowerCase();
        return mode.includes(q) || title.includes(q) || category.includes(q) || species.includes(q);
      });
    }

    function render() {
      const grid = byId("layoutTypeGrid");
      if (!grid) return;
      const libraryMode = String(getLibraryMode() || "layouts");
      const catalog = Array.isArray(getCatalog(libraryMode)) ? getCatalog(libraryMode) : [];
      const filtered = getFilteredCatalog(catalog, libraryMode);
      const meta = byId("layoutTypeMeta");
      const content = byId("layoutTypeContent");
      const categoriesRoot = byId("layoutTypeCategories");
      if (meta) {
        meta.textContent = libraryMode === "materials"
          ? "Библиотека меховых материалов"
          : (libraryMode === "processing" ? "Обработки скоро появятся" : "Типы выкладки");
      }
      if (content) {
        content.classList.toggle("materials-mode", libraryMode === "materials");
      }
      const sideButtons = global.document.querySelectorAll("[data-library-mode]");
      sideButtons.forEach((btn) => {
        const btnMode = String(btn.getAttribute("data-library-mode") || "");
        btn.classList.toggle("active", btnMode === libraryMode);
      });
      if (categoriesRoot) {
        categoriesRoot.innerHTML = "";
        categoriesRoot.hidden = libraryMode !== "materials";
        if (libraryMode === "materials") {
          const categories = Array.from(new Set(catalog.map((item) => String(item && item.category || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
          const allCategories = ["Все категории"].concat(categories);
          if (selectedCategory && !categories.includes(selectedCategory)) {
            selectedCategory = "";
          }
          for (const categoryName of allCategories) {
            const rawValue = categoryName === "Все категории" ? "" : categoryName;
            const btn = global.document.createElement("button");
            btn.type = "button";
            btn.className = "layout-library-category-btn" + (selectedCategory === rawValue ? " active" : "");
            btn.textContent = categoryName;
            btn.addEventListener("click", () => {
              selectedCategory = rawValue;
              render();
            });
            categoriesRoot.appendChild(btn);
          }
        }
      }
      grid.innerHTML = "";

      for (const item of filtered) {
        const key = String(getItemKey(libraryMode, item) || "");
        const isPlaceholder = !!(item && item.placeholder);
        const card = global.document.createElement("div");
        card.className = "layout-type-card" + (selectedKey === key ? " active" : "") + (isPlaceholder ? " placeholder" : "");
        card.setAttribute("data-key", key);
        if (isPlaceholder) card.setAttribute("data-placeholder", "1");
        card.innerHTML = getCardHtml(libraryMode, item);
        card.addEventListener("click", () => {
          if (isPlaceholder) return;
          selectedKey = key;
          render();
        });
        grid.appendChild(card);
      }

      const addBtn = byId("layoutTypeAddBtn");
      if (addBtn) {
        const selectedVisible = filtered.some((x) => String(getItemKey(libraryMode, x) || "") === String(selectedKey || ""));
        addBtn.disabled = !selectedKey || !selectedVisible;
        addBtn.textContent = getAddButtonLabel(libraryMode);
      }
    }

    function open() {
      const libraryMode = String(getLibraryMode() || "layouts");
      selectedKey = String(getPreferredKey(libraryMode) || "");
      selectedCategory = "";

      const searchEl = byId("layoutTypeSearch");
      if (searchEl) {
        searchEl.value = "";
        searchTerm = "";
      }

      render();
      const backdrop = byId("layoutTypeBackdrop");
      if (backdrop) backdrop.style.display = "flex";
    }

    function close() {
      const backdrop = byId("layoutTypeBackdrop");
      if (backdrop) backdrop.style.display = "none";
      selectedKey = null;
      searchTerm = "";
      selectedCategory = "";
    }

    function getSelectedKey() {
      return String(selectedKey || "");
    }

    function wire() {
      const searchEl = byId("layoutTypeSearch");
      if (searchEl) {
        searchEl.addEventListener("input", () => {
          searchTerm = String(searchEl.value || "");
          render();
        });
      }
      global.document.querySelectorAll("[data-library-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const libraryMode = String(btn.getAttribute("data-library-mode") || "layouts");
          setLibraryMode(libraryMode);
          selectedKey = String(getPreferredKey(libraryMode) || "");
          selectedCategory = "";
          render();
        });
      });
    }

    wire();

    return {
      render,
      open,
      close,
      getSelectedMode: getSelectedKey,
      getSelectedKey
    };
  }

  global.FurLabLayoutTypePicker = Object.assign({}, global.FurLabLayoutTypePicker || {}, {
    createLayoutTypePicker
  });
})(window);
