function isEditableTarget(target) {
  if (!target) return false;
  const el = target;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = String(el.type || "").toLowerCase();
    // Space should keep typing behavior inside text-like fields.
    const textLike = new Set([
      "text", "search", "email", "url", "tel", "password",
      "number", "date", "datetime-local", "month", "time", "week"
    ]);
    return textLike.has(type);
  }
  return !!el.isContentEditable;
}

export function attachKeyboardPanHandlers({ updateStageCursor, setSpacePanActive }) {
  // Hold Space to switch into pan mode outside editable controls.
  const onKeyDown = (e) => {
    if (e.code !== "Space") return;
    if (isEditableTarget(e.target)) return;
    setSpacePanActive(true);
    updateStageCursor();
    e.preventDefault();
  };

  // Release Space to leave pan mode.
  const onKeyUp = (e) => {
    if (e.code !== "Space") return;
    setSpacePanActive(false);
    updateStageCursor();
  };

  // Safety: reset pan mode when the window loses focus.
  const onBlur = () => {
    setSpacePanActive(false);
    updateStageCursor();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}

