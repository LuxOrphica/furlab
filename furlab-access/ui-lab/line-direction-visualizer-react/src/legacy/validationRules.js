export function buildValidationState(snapshot) {
  const {
    qualityValue,
    noteValue,
    materialValue,
    inventoryTagCandidate,
    inventoryTagEffective,
    inventoryTagValid,
    hasImage,
    hasMask,
    hasNap,
    apiReady,
    dictsLoaded
  } = snapshot;

  const q = String(qualityValue || "").trim();
  const qualityFilled = !!q;
  const noteRequired = q === "Limited";
  const noteFilled = !!String(noteValue || "").trim();
  const materialFilled = !!String(materialValue || "").trim();
  const invCandidate = String(inventoryTagCandidate || "").trim();
  const invReady = !!String(inventoryTagEffective || "").trim();
  const invFormatInvalid = !!invCandidate && !inventoryTagValid;
  const noteMissing = noteRequired && !noteFilled;
  const invMissing = !!hasImage && (!invReady || invFormatInvalid);
  const materialMissing = !materialFilled;
  const qualityMissing = !qualityFilled;
  const napMissing = !!hasImage && !hasNap;
  const canSave =
    !!hasImage &&
    !!hasMask &&
    !!apiReady &&
    !!dictsLoaded &&
    !!hasNap &&
    invReady &&
    materialFilled &&
    qualityFilled &&
    !noteMissing;

  return {
    invMissing,
    materialMissing,
    qualityMissing,
    noteMissing,
    napMissing,
    canSave
  };
}
