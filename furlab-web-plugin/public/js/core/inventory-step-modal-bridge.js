// Bridge extracted from app.js: inventory step modal positioning/drag hooks.
(function (global) {
  function createInventoryStepModalBridge(options) {
    const opts = options && typeof options === "object" ? options : {};
    const inventoryModalDrag = opts.inventoryModalDrag && typeof opts.inventoryModalDrag === "object"
      ? opts.inventoryModalDrag
      : null;

    function ensureInventoryStep1ModalPosition() {
      if (inventoryModalDrag && typeof inventoryModalDrag.ensureStep1 === "function") {
        inventoryModalDrag.ensureStep1();
      }
    }

    function setupInventoryStep1Drag() {
      if (inventoryModalDrag && typeof inventoryModalDrag.setupStep1Drag === "function") {
        inventoryModalDrag.setupStep1Drag();
      }
    }

    function ensureInventoryStep2ModalPosition() {
      if (inventoryModalDrag && typeof inventoryModalDrag.ensureStep2 === "function") {
        inventoryModalDrag.ensureStep2();
      }
    }

    function setupInventoryStep2Drag() {
      if (inventoryModalDrag && typeof inventoryModalDrag.setupStep2Drag === "function") {
        inventoryModalDrag.setupStep2Drag();
      }
    }

    function prepareInventoryStep2Modal() {
      ensureInventoryStep2ModalPosition();
      setupInventoryStep2Drag();
    }

    return {
      ensureInventoryStep1ModalPosition,
      setupInventoryStep1Drag,
      ensureInventoryStep2ModalPosition,
      setupInventoryStep2Drag,
      prepareInventoryStep2Modal
    };
  }

  global.FurLabInventoryStepModalBridge = Object.assign({}, global.FurLabInventoryStepModalBridge || {}, {
    createInventoryStepModalBridge
  });
})(window);
