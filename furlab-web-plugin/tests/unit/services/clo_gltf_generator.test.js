"use strict";

const {
  buildCloGltfMaterial,
  generateGltfString,
  generateJfabString,
} = require("../../../src/services/clo_gltf_generator");

describe("CLO GLTF/JFAB generator", () => {
  it("generates a minimal GLTF material with clamped visual properties", () => {
    const gltf = buildCloGltfMaterial({
      name: "Long White Fur",
      colorHex: "#ffffff",
      gloss: 4,
      softness: 0.2,
      stretch: 0.3,
    });

    expect(gltf.asset.generator).toBe("FURLAB clo_gltf_generator");
    expect(gltf.materials[0].name).toBe("Long_White_Fur");
    expect(gltf.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
    expect(gltf.materials[0].pbrMetallicRoughness.roughnessFactor).toBe(0);
    expect(gltf.materials[0].extensions.KHR_materials_specular.specularFactor).toBe(0.3);
    expect(JSON.parse(generateGltfString({ colorHex: "#000000" })).materials[0]
      .pbrMetallicRoughness.baseColorFactor).toEqual([0, 0, 0, 1]);
  });

  it("generates a parseable Fur_Strand JFAB material", () => {
    const jfab = JSON.parse(generateJfabString({
      name: "Test Fur",
      colorHex: "#336699",
      pileLengthMm: 12,
      hairThicknessMm: 0.2,
      pileDensityPerIn2: 1200,
      gloss: 0.5,
    }));
    const face = jfab.mapMaterial2D.listFaceMaterial[0];

    expect(jfab.qsName).toBe("Test Fur");
    // iFurType 9 = Fur_Strand in CLO 2025.2 (verified from real CLO export)
    expect(face.iFurType).toBe(9);
    expect(face.fFurLength).toBe(12);
    expect(face.fFurThickness).toBe(0.2);
    expect(face.fFurDensity).toBe(1.2);
  });
});
