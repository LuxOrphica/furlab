"use strict";

// Default nonlinear physics curves from real CLO fur export (mink)
const DEFAULT_NONLINEAR_SHEAR = [
  { lengthRatio: 1.0, stiffnessRatio: 0.04358 },
  { lengthRatio: 1.0746, stiffnessRatio: 3.417 },
  { lengthRatio: 1.1725, stiffnessRatio: 9.491 },
  { lengthRatio: 1.2485, stiffnessRatio: 15.284 }
];
const DEFAULT_NONLINEAR_STRETCH_WARP = [
  { lengthRatio: 1.0, stiffnessRatio: 0.1563 },
  { lengthRatio: 1.07, stiffnessRatio: 3.401 },
  { lengthRatio: 1.1683, stiffnessRatio: 8.112 },
  { lengthRatio: 1.2443, stiffnessRatio: 10.63 }
];
const DEFAULT_NONLINEAR_STRETCH_WEFT = [
  { lengthRatio: 1.0, stiffnessRatio: 0.0428 },
  { lengthRatio: 1.0996, stiffnessRatio: 2.761 },
  { lengthRatio: 1.1953, stiffnessRatio: 6.957 },
  { lengthRatio: 1.2663, stiffnessRatio: 9.194 }
];

function hexToRgb(hex) {
  const h = String(hex || "#888888").replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [isFinite(r) ? r : 0.5, isFinite(g) ? g : 0.5, isFinite(b) ? b : 0.5, 1.0];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

/**
 * Generate a minimal CLO-compatible GLTF material file from FURLAB fur material data.
 * No geometry, no textures — just the material definition.
 *
 * @param {object} material — object from fur_materials.json
 * @returns {object} — parsed GLTF JSON ready to JSON.stringify
 */
function buildCloGltfMaterial(material) {
  const m = material && typeof material === "object" ? material : {};

  const weightGm2   = clamp(m.weightGm2 || 230, 50, 2000);
  const thicknessMm = clamp(m.thicknessMm || 0.5, 0.1, 10);
  const softness    = clamp(m.softness || 0.5, 0, 1);
  const stretch     = clamp(m.stretch || 0.7, 0, 1);
  const gloss       = clamp(m.gloss || 0.3, 0, 1);
  const colorHex    = String(m.colorHex || "#888888");

  // Physics: higher softness → lower bending stiffness
  const bendingWarp      = (1 - softness) * 10000 + 500;
  const bendingWeft      = (1 - softness) * 9000  + 500;
  const bendingBias      = (bendingWarp + bendingWeft) / 2;
  // Higher stretch → lower stretch stiffness (easier to stretch)
  const stretchWarp      = (1 - stretch) * 3000000 + 500000;
  const stretchWeft      = (1 - stretch) * 2500000 + 400000;

  const baseColor = hexToRgb(colorHex);

  const matName = String(m.name || "FurMaterial").replace(/\s+/g, "_");

  return {
    asset: { version: "2.0", generator: "FURLAB clo_gltf_generator" },
    extensionsUsed: ["CLO_materials_fabric_property", "KHR_materials_specular"],
    extensionsRequired: ["CLO_materials_fabric_property"],
    materials: [
      {
        name: matName,
        pbrMetallicRoughness: {
          baseColorFactor: baseColor,
          metallicFactor: 0.0,
          roughnessFactor: clamp(1.0 - gloss, 0, 1)
        },
        extensions: {
          CLO_materials_fabric_property: {
            physicalProperty: {
              density:                    weightGm2,
              thickness:                  thicknessMm,
              friction:                   0.03,
              internalDamping:            1e-4,
              stretchWarp,
              stretchWeft,
              bendingWarp,
              bendingWeft,
              bendingLeftBias:            bendingBias,
              bendingRightBias:           bendingBias,
              leftShear:                  1200000.0,
              rightShear:                 1200000.0,
              bucklingRatioWarp:          0.0,
              bucklingRatioWeft:          0.0,
              bucklingRatioLeftBias:      0.0,
              bucklingRatioRightBias:     0.0,
              bucklingStiffnessWarp:      0.0,
              bucklingStiffnessWeft:      0.0,
              bucklingStiffnessLeftBias:  0.0,
              bucklingStiffnessRightBias: 0.0,
              nonlinearLeftShear:         DEFAULT_NONLINEAR_SHEAR,
              nonlinearRightShear:        DEFAULT_NONLINEAR_SHEAR,
              nonlinearStretchWarp:       DEFAULT_NONLINEAR_STRETCH_WARP,
              nonlinearStretchWeft:       DEFAULT_NONLINEAR_STRETCH_WEFT
            },
            textureMapping: { type: 0 }
          },
          KHR_materials_specular: {
            specularFactor: clamp(gloss * 0.3, 0, 1)
          }
        }
      }
    ],
    // Minimal valid GLTF: one empty scene
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: []
  };
}

/**
 * Generate GLTF JSON string for a fur material.
 */
function generateGltfString(material) {
  return JSON.stringify(buildCloGltfMaterial(material), null, 2);
}

/**
 * Generate a CLO .jfab JSON string for Fur_Strand material.
 * Structure reverse-engineered from real CLO export (Angora Fur_Strand preset).
 *
 * @param {object} material — object from fur_materials.json
 * @returns {string} — JSON string ready to write as .jfab
 */
function buildCloJfab(material) {
  const m = material && typeof material === "object" ? material : {};

  const name       = String(m.name || "FurMaterial");
  const colorHex   = String(m.colorHex || "#888888");
  const rgb        = hexToRgb(colorHex);  // [r,g,b,1]
  const r = rgb[0], g = rgb[1], b = rgb[2];

  const pileLengthMm      = clamp(m.pileLengthMm || 25, 1, 200);
  const hairThicknessMm   = clamp(m.hairThicknessMm || 0.15, 0.01, 2);
  const pileDensityPerIn2 = clamp(m.pileDensityPerIn2 || 800, 100, 5000);
  const taper             = clamp(m.taper || 1.0, 0, 1);
  const hairBend          = clamp(m.hairBend || 0.3, 0, 1);
  const bendSpread        = clamp(m.bendSpread || 0.5, 0, 1);
  const gloss             = clamp(m.gloss || 0.3, 0, 1);
  const softness          = clamp(m.softness || 0.5, 0, 1);
  const curlRadiusMm      = clamp(m.curlRadiusMm || 10, 0, 100);
  const curlEffect        = clamp(m.curlEffect || 0.5, 0, 1);
  const melanin           = clamp(m.melanin || 0, 0, 1);
  const pheomelanin       = clamp(m.pheomelanin || 0, 0, 1);

  // CLO jfab uses density in kg/m³ internally (fDensity), weight in g/m² → kg/m³ via thickness
  const thicknessMm = clamp(m.thicknessMm || 0.5, 0.1, 10);
  const fDensity = (m.weightGm2 || 230) / 1000 / (thicknessMm / 1000) / 1000;

  const colorMapEntry = (colorName) => ({
    qsName: colorHex.replace("#", "").toUpperCase(),
    v4Color: [r, g, b, 1.0],
    qsPLMIdUTF8: "", qsNameUTF8: colorHex.replace("#", "").toUpperCase(), qsPLMId: ""
  });
  const emptyColorEntry = () => ({
    qsName: "", v4Color: [1.0, 1.0, 1.0, 1.0], qsPLMIdUTF8: "", qsNameUTF8: "", qsPLMId: ""
  });

  const faceMaterial = {
    iFileType: 0,
    fDisplacementShift: 0.0,
    enMaterialFaceType: 0,
    iMaterialFileType: 0,
    fFurCurlRadiusVar: 1.0,
    fMetalness: 0.0,
    iNormalIntensityInPercentage: 0,
    fDisplacementEdgeLength: 4.0,
    bFixedAspectRatio: false,
    iVersion: 1,
    // Color
    v3BaseColor: [r, g, b],
    v4Ambient:  [r * 0.257, g * 0.257, b * 0.257, 1.0],
    v4Diffuse:  [r * 0.818, g * 0.818, b * 0.818, 1.0],
    v4Specular: [0.075, 0.075, 0.075, 1.0],
    v4Emission: [0.0, 0.0, 0.0, 1.0],
    mapAmbientColor:  colorMapEntry(),
    mapDiffuseColor:  colorMapEntry(),
    mapEmissionColor: { qsName: "", v4Color: [0.0, 0.0, 0.0, 1.0], qsPLMIdUTF8: "", qsNameUTF8: "", qsPLMId: "" },
    mapFlakesColor:   emptyColorEntry(),
    mapFurMidColor:   colorMapEntry(),
    mapFurTipColor:   colorMapEntry(),
    mapSSSColor1: emptyColorEntry(), mapSSSColor2: emptyColorEntry(), mapSSSColor3: emptyColorEntry(),
    mapIridescenceColor1: emptyColorEntry(), mapIridescenceColor2: emptyColorEntry(),
    mapIridescenceColor3: emptyColorEntry(), mapIridescenceColor4: emptyColorEntry(),
    mapIridescenceColor5: emptyColorEntry(),
    v4BlendColor: [0.0, 0.0, 0.0, 1.0],
    fBaseColorMult: 1.0, fFrontColorMult: 1.0, fSideColorMult: 1.0, fFogColorMult: 1.0,
    // Fur strand parameters
    bIsFur: true,
    iFurType: 2,                              // 2 = Fur_Strand
    fFurLength: pileLengthMm,
    fFurThickness: hairThicknessMm,
    fFurDensity: pileDensityPerIn2 / 1000.0,
    fFurTaper: taper,
    fFurBend: hairBend,
    fFurGlossiness: gloss * 0.4,
    fFurGlossinessBoost: gloss * 0.3,
    fFurSoftness: softness,
    fFurMelanin: melanin,
    fFurPheoMelanin: pheomelanin,
    fFurCurlRadius: curlRadiusMm,
    fFurKnots: curlEffect * 10,
    fFurCurlAngle: 20.0,
    fFurLengthVar: bendSpread,
    fFurThicknessVar: bendSpread * 0.4,
    fFurDirectionVar: 0.0,
    fFurGravity: 1.5,
    fFurGravityVar: 0.5,
    fFurGravityVectorX: 0.0, fFurGravityVectorY: -1.0, fFurGravityVectorZ: 0.0,
    fFurMidPos: 0.33, fFurTipPos: 0.66,
    bUseFurCompensateEnergy: true,
    bUseFurGradationColor: false,
    bUseFurInterpolationColor: true,
    // PBR / render
    fGlossiness: clamp(1 - gloss, 0, 1),
    fReflectionIntensity: gloss * 0.3,
    fRefractionIntensity: 0.0,
    fShininess: 28.76,
    fIOR: 1.5, fFresnelIOR: 1.5, fAbbe: 25.0,
    iRoughnessUIType: 0,
    enOpaqueMode: 0, enMappingType: 0, enMaterialFaceType: 0,
    iMaterialType: 0, enCLOMetalPresetType: 0, enYKKMetalPresetType: 5,
    bMetal: false, bMirrorNormalMap: false,
    bDisplacementKeepContinuity: false,
    fDisplacementAmount: 0.0, fDisplacementShift: 0.0, fDisplacementWaterLevel: 0.0,
    fDisplacementEdgeLength: 4.0,
    fAmbientIntensity: 0.0, fDiffuseIntensity: 1.0,
    fEnvironmentLightIntensity: 1.0, fCameraLightIntensity: 0.0,
    fDesaturated: 0.0, fBumpMode: 0.0,
    fSSSMix: 0.0, fSSSDensityScale: 0.0,
    fSSSWeight1: 0.0, fSSSWeight2: 0.0, fSSSWeight3: 0.0,
    fSSSRadius1: 0.0, fSSSRadius2: 0.0, fSSSRadius3: 0.0,
    fFlakesNum: 0.0, flakesSaturationVar: 0.0,
    fIridescenceHueShift: 0.0, fIridescenceRoughness: 0.0, fIridescenceWeight: 0.0,
    fZero: 0.0,
    uiBlendFuncSrc: 770, uiBlendFuncDst: 771,
    qsFurClusterInputXml: "", qsFurClusterInputXmlUTF8: "",
    listFurClusterInputTextures: [],
    listTexture: [], mapFurStrand: {}
  };

  return JSON.stringify({
    qsAPIMetaDataUTF8: "{\n}",
    uiVersion: 100,
    qsItemNo: "None",
    uiFabricVersion: 100,
    qsName: name,
    qsNameUTF8: name,
    qsTrimType: "None",
    qsTrimTypeUTF8: "None",
    qsItemNoUTF8: "None",
    listMarkerColorwayData: [[]],
    bIsFur: true,
    iFurType: 2,
    mapPhysical: {
      fDensity,
      fThickness: thicknessMm,
      fFriction: 0.03,
      fWidth: 1117.6
    },
    mapMaterial2D: {
      listFaceMaterial: [faceMaterial]
    }
  }, null, 2);
}

function generateJfabString(material) {
  return buildCloJfab(material);
}

module.exports = { buildCloGltfMaterial, generateGltfString, buildCloJfab, generateJfabString };
