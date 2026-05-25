(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NewtonPhysics = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VISIBLE_MIN_NM = 380;
  var VISIBLE_MAX_NM = 780;
  var TWO_PI = Math.PI * 2;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteNumber(value, name) {
    var number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(name + " must be a finite number");
    }
    return number;
  }

  function filmThicknessM(radialCoordinateM, curvatureRadiusM, gapNm) {
    var r = finiteNumber(radialCoordinateM, "radialCoordinateM");
    var radius = finiteNumber(curvatureRadiusM, "curvatureRadiusM");
    var gapM = finiteNumber(gapNm || 0, "gapNm") * 1e-9;

    if (r < 0) {
      throw new RangeError("radialCoordinateM must be non-negative");
    }
    if (radius <= 0) {
      throw new RangeError("curvatureRadiusM must be positive");
    }
    if (r > radius) {
      throw new RangeError("radialCoordinateM must not exceed curvatureRadiusM");
    }

    var root = Math.sqrt(Math.max(0, radius * radius - r * r));
    var sagittaM = r === 0 ? 0 : (r * r) / (radius + root);
    return gapM + sagittaM;
  }

  function phaseRadians(thicknessM, wavelengthNm, refractiveIndex) {
    var wavelengthM = finiteNumber(wavelengthNm, "wavelengthNm") * 1e-9;
    var n = finiteNumber(refractiveIndex || 1, "refractiveIndex");
    var thickness = finiteNumber(thicknessM, "thicknessM");

    if (wavelengthM <= 0) {
      throw new RangeError("wavelengthNm must be positive");
    }
    if (n <= 0) {
      throw new RangeError("refractiveIndex must be positive");
    }

    return (TWO_PI * 2 * n * thickness) / wavelengthM;
  }

  function interferenceAtThickness(thicknessM, wavelengthNm, options) {
    var settings = options || {};
    var visibility = clamp(
      settings.visibility === undefined ? 1 : finiteNumber(settings.visibility, "visibility"),
      0,
      1
    );
    var mode = settings.mode || "reflected";
    var phase = phaseRadians(thicknessM, wavelengthNm, settings.refractiveIndex || 1);
    var cosine = Math.cos(phase);

    if (mode === "reflected") {
      return 0.5 * (1 - visibility * cosine);
    }
    if (mode === "transmitted") {
      return 0.5 * (1 + visibility * cosine);
    }
    throw new RangeError("mode must be reflected or transmitted");
  }

  function interferenceIntensity(radiusM, options) {
    var settings = options || {};
    var thickness = filmThicknessM(radiusM, settings.curvatureRadiusM, settings.gapNm || 0);
    return interferenceAtThickness(thickness, settings.wavelengthNm, settings);
  }

  function ringRadiusM(order, options) {
    var settings = options || {};
    var m = finiteNumber(order, "order");
    var radius = finiteNumber(settings.curvatureRadiusM, "curvatureRadiusM");
    var wavelengthM = finiteNumber(settings.wavelengthNm, "wavelengthNm") * 1e-9;
    var n = finiteNumber(settings.refractiveIndex || 1, "refractiveIndex");
    var gapM = finiteNumber(settings.gapNm || 0, "gapNm") * 1e-9;
    var kind = settings.kind || "dark";

    if (!Number.isInteger(m) || m < 0) {
      throw new RangeError("order must be a non-negative integer");
    }
    if (radius <= 0 || wavelengthM <= 0 || n <= 0) {
      throw new RangeError("curvatureRadiusM, wavelengthNm and refractiveIndex must be positive");
    }

    var opticalOrder;
    if (kind === "dark") {
      opticalOrder = m;
    } else if (kind === "bright") {
      opticalOrder = m + 0.5;
    } else {
      throw new RangeError("kind must be dark or bright");
    }

    var targetThicknessM = (opticalOrder * wavelengthM) / (2 * n);
    var sagittaM = targetThicknessM - gapM;
    if (sagittaM < -1e-18 || sagittaM > radius) {
      return NaN;
    }
    sagittaM = Math.max(0, sagittaM);
    return Math.sqrt(Math.max(0, 2 * radius * sagittaM - sagittaM * sagittaM));
  }

  function gaussianWeight(wavelengthNm, centerNm, sigmaNm) {
    var z = (wavelengthNm - centerNm) / sigmaNm;
    return Math.exp(-0.5 * z * z);
  }

  function spectrumSamples(centerNm, widthNm, sampleCount) {
    var center = finiteNumber(centerNm, "centerNm");
    var width = finiteNumber(widthNm || 0, "widthNm");
    var count = Math.max(3, Math.floor(sampleCount || 71));

    if (width < 0) {
      throw new RangeError("widthNm must be non-negative");
    }
    if (width === 0) {
      return [{ wavelengthNm: center, weight: 1, xyz: xyzFromWavelength(center) }];
    }

    if (count % 2 === 0) {
      count += 1;
    }

    var sigma = width / (2 * Math.sqrt(2 * Math.log(2)));
    var halfSpan = Math.max(5, 4 * sigma);
    var start = Math.max(VISIBLE_MIN_NM, center - halfSpan);
    var end = Math.min(VISIBLE_MAX_NM, center + halfSpan);
    if (end <= start) {
      return [{ wavelengthNm: clamp(center, VISIBLE_MIN_NM, VISIBLE_MAX_NM), weight: 1, xyz: xyzFromWavelength(center) }];
    }

    var samples = [];
    var total = 0;
    for (var i = 0; i < count; i += 1) {
      var wavelength = start + ((end - start) * i) / (count - 1);
      var weight = gaussianWeight(wavelength, center, sigma);
      samples.push({
        wavelengthNm: wavelength,
        weight: weight,
        xyz: xyzFromWavelength(wavelength)
      });
      total += weight;
    }

    return samples.map(function (sample) {
      return {
        wavelengthNm: sample.wavelengthNm,
        weight: sample.weight / total,
        xyz: sample.xyz
      };
    });
  }

  function spectralIntensityAtRadius(radiusM, spectrum, options) {
    var settings = options || {};
    var samples = spectrum && spectrum.length ? spectrum : spectrumSamples(settings.wavelengthNm, 0, 1);
    var thickness = filmThicknessM(radiusM, settings.curvatureRadiusM, settings.gapNm || 0);
    var intensity = 0;

    for (var i = 0; i < samples.length; i += 1) {
      intensity += samples[i].weight * interferenceAtThickness(thickness, samples[i].wavelengthNm, settings);
    }
    return intensity;
  }

  function spectralColorAtRadius(radiusM, spectrum, options) {
    var settings = options || {};
    var samples = spectrum && spectrum.length ? spectrum : spectrumSamples(settings.wavelengthNm, 0, 1);
    var thickness = filmThicknessM(radiusM, settings.curvatureRadiusM, settings.gapNm || 0);
    var xyz = { x: 0, y: 0, z: 0 };
    var intensity = 0;

    for (var i = 0; i < samples.length; i += 1) {
      var sample = samples[i];
      var localIntensity = interferenceAtThickness(thickness, sample.wavelengthNm, settings);
      var weighted = sample.weight * localIntensity;
      intensity += weighted;
      xyz.x += weighted * sample.xyz.x;
      xyz.y += weighted * sample.xyz.y;
      xyz.z += weighted * sample.xyz.z;
    }

    return { xyz: xyz, intensity: intensity };
  }

  function spectrumSourceXyz(spectrum) {
    var xyz = { x: 0, y: 0, z: 0 };
    var samples = spectrum || [];
    for (var i = 0; i < samples.length; i += 1) {
      xyz.x += samples[i].weight * samples[i].xyz.x;
      xyz.y += samples[i].weight * samples[i].xyz.y;
      xyz.z += samples[i].weight * samples[i].xyz.z;
    }
    return xyz;
  }

  // Analytic approximation of the CIE 1931 2-degree color matching functions.
  function xyzFromWavelength(wavelengthNm) {
    var wave = finiteNumber(wavelengthNm, "wavelengthNm");
    if (wave < VISIBLE_MIN_NM || wave > VISIBLE_MAX_NM) {
      return { x: 0, y: 0, z: 0 };
    }

    var t1 = (wave - 442.0) * (wave < 442.0 ? 0.0624 : 0.0374);
    var t2 = (wave - 599.8) * (wave < 599.8 ? 0.0264 : 0.0323);
    var t3 = (wave - 501.1) * (wave < 501.1 ? 0.0490 : 0.0382);
    var x = 0.362 * Math.exp(-0.5 * t1 * t1) +
      1.056 * Math.exp(-0.5 * t2 * t2) -
      0.065 * Math.exp(-0.5 * t3 * t3);

    t1 = (wave - 568.8) * (wave < 568.8 ? 0.0213 : 0.0247);
    t2 = (wave - 530.9) * (wave < 530.9 ? 0.0613 : 0.0322);
    var y = 0.821 * Math.exp(-0.5 * t1 * t1) +
      0.286 * Math.exp(-0.5 * t2 * t2);

    t1 = (wave - 437.0) * (wave < 437.0 ? 0.0845 : 0.0278);
    t2 = (wave - 459.0) * (wave < 459.0 ? 0.0385 : 0.0725);
    var z = 1.217 * Math.exp(-0.5 * t1 * t1) +
      0.681 * Math.exp(-0.5 * t2 * t2);

    return { x: Math.max(0, x), y: Math.max(0, y), z: Math.max(0, z) };
  }

  function linearRgbFromXyz(xyz) {
    var x = xyz.x;
    var y = xyz.y;
    var z = xyz.z;
    return {
      r: 3.2406 * x - 1.5372 * y - 0.4986 * z,
      g: -0.9689 * x + 1.8758 * y + 0.0415 * z,
      b: 0.0557 * x - 0.2040 * y + 1.0570 * z
    };
  }

  function linearToSrgb(value) {
    var v = clamp(value, 0, 1);
    if (v <= 0.0031308) {
      return 12.92 * v;
    }
    return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function srgb8FromLinear(rgb, exposure) {
    var gain = exposure === undefined ? 1 : exposure;
    return {
      r: Math.round(linearToSrgb(rgb.r * gain) * 255),
      g: Math.round(linearToSrgb(rgb.g * gain) * 255),
      b: Math.round(linearToSrgb(rgb.b * gain) * 255)
    };
  }

  function coherenceLengthM(centerNm, widthNm) {
    var centerM = finiteNumber(centerNm, "centerNm") * 1e-9;
    var widthM = finiteNumber(widthNm || 0, "widthNm") * 1e-9;
    if (widthM <= 0) {
      return Infinity;
    }
    return (centerM * centerM) / widthM;
  }

  return {
    VISIBLE_MIN_NM: VISIBLE_MIN_NM,
    VISIBLE_MAX_NM: VISIBLE_MAX_NM,
    clamp: clamp,
    filmThicknessM: filmThicknessM,
    phaseRadians: phaseRadians,
    interferenceAtThickness: interferenceAtThickness,
    interferenceIntensity: interferenceIntensity,
    ringRadiusM: ringRadiusM,
    spectrumSamples: spectrumSamples,
    spectralIntensityAtRadius: spectralIntensityAtRadius,
    spectralColorAtRadius: spectralColorAtRadius,
    spectrumSourceXyz: spectrumSourceXyz,
    xyzFromWavelength: xyzFromWavelength,
    linearRgbFromXyz: linearRgbFromXyz,
    srgb8FromLinear: srgb8FromLinear,
    coherenceLengthM: coherenceLengthM
  };
});
