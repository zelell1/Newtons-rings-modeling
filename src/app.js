(function () {
  "use strict";

  var physics = window.NewtonPhysics;
  var patternCanvas = document.getElementById("patternCanvas");
  var profileCanvas = document.getElementById("profileCanvas");
  var patternCtx = patternCanvas.getContext("2d", { alpha: false });
  var profileCtx = profileCanvas.getContext("2d", { alpha: false });
  var form = document.getElementById("controlsForm");

  var inputs = {
    curvatureCm: document.getElementById("curvatureCm"),
    apertureMm: document.getElementById("apertureMm"),
    wavelengthNm: document.getElementById("wavelengthNm"),
    bandwidthNm: document.getElementById("bandwidthNm"),
    gapNm: document.getElementById("gapNm"),
    refractiveIndex: document.getElementById("refractiveIndex"),
    visibility: document.getElementById("visibility")
  };

  var outputs = {
    curvatureValue: document.getElementById("curvatureValue"),
    apertureValue: document.getElementById("apertureValue"),
    wavelengthValue: document.getElementById("wavelengthValue"),
    bandwidthValue: document.getElementById("bandwidthValue"),
    gapValue: document.getElementById("gapValue"),
    refractiveValue: document.getElementById("refractiveValue"),
    visibilityValue: document.getElementById("visibilityValue"),
    lightKind: document.getElementById("lightKind"),
    centerIntensity: document.getElementById("centerIntensity"),
    darkRing: document.getElementById("darkRing"),
    coherenceLength: document.getElementById("coherenceLength"),
    scaleLabel: document.getElementById("scaleLabel"),
    plotCaption: document.getElementById("plotCaption")
  };

  var renderRequest = 0;
  var lastRenderMs = 0;
  var PATTERN_MAX_BITMAP_SIZE = 760;
  var radiusIndexCache = {
    size: 0,
    maxIndex: 0,
    outsideIndex: 0,
    indexes: null
  };

  function readParameters() {
    var mode = form.querySelector("input[name='mode']:checked").value;
    return {
      mode: mode,
      curvatureRadiusM: Number.parseFloat(inputs.curvatureCm.value) / 100,
      apertureRadiusM: Number.parseFloat(inputs.apertureMm.value) / 1000,
      wavelengthNm: Number.parseFloat(inputs.wavelengthNm.value),
      bandwidthNm: Number.parseFloat(inputs.bandwidthNm.value),
      gapNm: Number.parseFloat(inputs.gapNm.value),
      refractiveIndex: Number.parseFloat(inputs.refractiveIndex.value),
      visibility: Number.parseFloat(inputs.visibility.value)
    };
  }

  function formatMm(valueM) {
    if (!Number.isFinite(valueM)) {
      return "нет в области";
    }
    return (valueM * 1000).toFixed(valueM < 0.001 ? 3 : 2) + " мм";
  }

  function formatCoherence(valueM) {
    if (!Number.isFinite(valueM)) {
      return "∞";
    }
    if (valueM >= 0.001) {
      return (valueM * 1000).toFixed(2) + " мм";
    }
    return (valueM * 1e6).toFixed(1) + " мкм";
  }

  function updateLabels(params, spectrum) {
    outputs.curvatureValue.value = params.curvatureRadiusM.toFixed(2) + " м";
    outputs.apertureValue.value = (params.apertureRadiusM * 1000).toFixed(1) + " мм";
    outputs.wavelengthValue.value = Math.round(params.wavelengthNm) + " нм";
    outputs.bandwidthValue.value = Math.round(params.bandwidthNm) + " нм";
    outputs.gapValue.value = Math.round(params.gapNm) + " нм";
    outputs.refractiveValue.value = params.refractiveIndex.toFixed(3);
    outputs.visibilityValue.value = params.visibility.toFixed(2);

    outputs.lightKind.textContent = params.bandwidthNm === 0 ?
      "монохроматический" :
      "квазимонохроматический, " + spectrum.length + " отсчет";

    var centerIntensity = physics.spectralIntensityAtRadius(0, spectrum, params);
    outputs.centerIntensity.textContent = "I(0) = " + centerIntensity.toFixed(3);

    var darkOrder = params.gapNm === 0 ? 1 : 0;
    var firstDark = physics.ringRadiusM(darkOrder, {
      kind: "dark",
      curvatureRadiusM: params.curvatureRadiusM,
      wavelengthNm: params.wavelengthNm,
      refractiveIndex: params.refractiveIndex,
      gapNm: params.gapNm
    });
    outputs.darkRing.textContent = formatMm(firstDark);
    outputs.coherenceLength.textContent = formatCoherence(physics.coherenceLengthM(params.wavelengthNm, params.bandwidthNm));
    outputs.scaleLabel.textContent = chooseScaleLabel(params.apertureRadiusM);
    outputs.plotCaption.textContent = params.mode === "reflected" ?
      "Отраженный свет, нормированная интенсивность" :
      "Проходящий свет, нормированная интенсивность";
  }

  function chooseScaleLabel(apertureRadiusM) {
    var radiusMm = apertureRadiusM * 1000;
    if (radiusMm <= 1.5) {
      return "0.25 мм";
    }
    if (radiusMm <= 4) {
      return "1 мм";
    }
    return "2 мм";
  }

  function chooseScaleFraction(apertureRadiusM) {
    var label = chooseScaleLabel(apertureRadiusM);
    var valueMm = Number.parseFloat(label);
    return (valueMm / 1000) / (2 * apertureRadiusM);
  }

  function makeExposure(spectrum) {
    var sourceRgb = physics.linearRgbFromXyz(physics.spectrumSourceXyz(spectrum));
    var maxChannel = Math.max(sourceRgb.r, sourceRgb.g, sourceRgb.b, 0.001);
    return 0.96 / maxChannel;
  }

  function renderPattern(params, spectrum, exposure) {
    var holder = patternCanvas.parentElement;
    var stage = document.querySelector(".stage");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var stableWidth = stage && stage.clientWidth ? stage.clientWidth : holder.clientWidth;
    var viewportBound = Math.min(window.innerWidth, window.innerHeight) - 72;
    var cssSize = Math.floor(Math.min(680, stableWidth - 36, viewportBound));
    cssSize = Math.max(280, cssSize);
    var size = Math.min(PATTERN_MAX_BITMAP_SIZE, Math.round(cssSize * dpr));

    if (patternCanvas.width !== size || patternCanvas.height !== size) {
      patternCanvas.width = size;
      patternCanvas.height = size;
    }
    patternCanvas.style.width = cssSize + "px";
    patternCanvas.style.height = cssSize + "px";

    var image = patternCtx.createImageData(size, size);
    var data = image.data;
    var radiusLimitM = params.apertureRadiusM;
    var indexMap = radiusIndexMap(size);
    var colors = buildPatternColorTable(params, spectrum, exposure, indexMap.maxIndex);
    var indexes = indexMap.indexes;

    for (var p = 0, k = 0; p < indexes.length; p += 1, k += 4) {
      var colorIndex = indexes[p] * 4;
      data[k] = colors[colorIndex];
      data[k + 1] = colors[colorIndex + 1];
      data[k + 2] = colors[colorIndex + 2];
      data[k + 3] = 255;
    }

    patternCtx.putImageData(image, 0, 0);
    var scale = patternCanvas.parentElement.querySelector(".scale-bar span");
    scale.style.width = Math.round(cssSize * chooseScaleFraction(radiusLimitM)) + "px";
  }

  function radiusIndexMap(size) {
    if (radiusIndexCache.size === size && radiusIndexCache.indexes) {
      return radiusIndexCache;
    }

    var half = (size - 1) / 2;
    var maxIndex = Math.max(1, Math.ceil(half));
    var outsideIndex = maxIndex + 1;
    var indexes = new Uint16Array(size * size);
    var p = 0;

    for (var y = 0; y < size; y += 1) {
      var dy = (y - half) / half;
      var dy2 = dy * dy;
      for (var x = 0; x < size; x += 1) {
        var dx = (x - half) / half;
        var normalized2 = dx * dx + dy2;
        indexes[p] = normalized2 <= 1 ?
          Math.min(maxIndex, Math.round(Math.sqrt(normalized2) * maxIndex)) :
          outsideIndex;
        p += 1;
      }
    }

    radiusIndexCache = {
      size: size,
      maxIndex: maxIndex,
      outsideIndex: outsideIndex,
      indexes: indexes
    };
    return radiusIndexCache;
  }

  function buildPatternColorTable(params, spectrum, exposure, maxIndex) {
    var colors = new Uint8ClampedArray((maxIndex + 2) * 4);
    for (var i = 0; i <= maxIndex; i += 1) {
      var radiusM = (i / maxIndex) * params.apertureRadiusM;
      var color = physics.spectralColorAtRadius(radiusM, spectrum, params);
      var rgb = physics.srgb8FromLinear(physics.linearRgbFromXyz(color.xyz), exposure);
      var offset = i * 4;
      colors[offset] = rgb.r;
      colors[offset + 1] = rgb.g;
      colors[offset + 2] = rgb.b;
      colors[offset + 3] = 255;
    }

    var outside = (maxIndex + 1) * 4;
    colors[outside] = 18;
    colors[outside + 1] = 20;
    colors[outside + 2] = 22;
    colors[outside + 3] = 255;
    return colors;
  }

  function renderProfile(params, spectrum, exposure) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = profileCanvas.getBoundingClientRect();
    var cssWidth = Math.max(280, rect.width || profileCanvas.parentElement.clientWidth - 36);
    var cssHeight = 280;
    var width = Math.round(cssWidth * dpr);
    var height = Math.round(cssHeight * dpr);

    if (profileCanvas.width !== width || profileCanvas.height !== height) {
      profileCanvas.width = width;
      profileCanvas.height = height;
    }
    profileCanvas.style.height = cssHeight + "px";

    var ctx = profileCtx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#fbfcfd";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    var margin = { left: 48, right: 16, top: 18, bottom: 38 };
    var plotWidth = cssWidth - margin.left - margin.right;
    var plotHeight = cssHeight - margin.top - margin.bottom;

    drawGrid(ctx, margin, plotWidth, plotHeight, params.apertureRadiusM);

    var steps = 520;
    var previous = null;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";

    for (var i = 0; i < steps; i += 1) {
      var t = i / (steps - 1);
      var radiusM = t * params.apertureRadiusM;
      var color = physics.spectralColorAtRadius(radiusM, spectrum, params);
      var intensity = color.intensity;
      var x = margin.left + t * plotWidth;
      var y = margin.top + (1 - intensity) * plotHeight;

      if (previous) {
        var rgb = physics.srgb8FromLinear(physics.linearRgbFromXyz(color.xyz), exposure);
        ctx.strokeStyle = "rgb(" + rgb.r + " " + rgb.g + " " + rgb.b + ")";
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      previous = { x: x, y: y };
    }

    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, plotWidth, plotHeight);
    ctx.restore();
  }

  function drawGrid(ctx, margin, plotWidth, plotHeight, apertureRadiusM) {
    ctx.lineWidth = 1;
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#596271";
    ctx.strokeStyle = "#e3e7ed";

    for (var i = 0; i <= 4; i += 1) {
      var y = margin.top + (i / 4) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotWidth, y);
      ctx.stroke();
      var label = (1 - i / 4).toFixed(2);
      ctx.fillText(label, 8, y);
    }

    ctx.textAlign = "center";
    for (var j = 0; j <= 4; j += 1) {
      var x = margin.left + (j / 4) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotHeight);
      ctx.stroke();
      ctx.fillText(((apertureRadiusM * 1000 * j) / 4).toFixed(1), x, margin.top + plotHeight + 18);
    }

    ctx.fillStyle = "#2f3742";
    ctx.fillText("r, мм", margin.left + plotWidth / 2, margin.top + plotHeight + 33);
    ctx.save();
    ctx.translate(14, margin.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("I / I0", 0, 0);
    ctx.restore();
    ctx.textAlign = "start";
  }

  function render() {
    var startedAt = window.performance.now();
    renderRequest = 0;
    var params = readParameters();
    var sampleCount = params.bandwidthNm === 0 ? 1 : 81;
    var spectrum = physics.spectrumSamples(params.wavelengthNm, params.bandwidthNm, sampleCount);
    var exposure = makeExposure(spectrum);

    updateLabels(params, spectrum);
    renderPattern(params, spectrum, exposure);
    renderProfile(params, spectrum, exposure);
    lastRenderMs = window.performance.now() - startedAt;
    window.NewtonRingsStats = {
      lastRenderMs: lastRenderMs,
      patternBitmapSize: patternCanvas.width,
      spectrumSamples: spectrum.length
    };
    document.documentElement.dataset.renderMs = lastRenderMs.toFixed(1);
    document.documentElement.dataset.patternBitmapSize = String(patternCanvas.width);
    document.documentElement.dataset.spectrumSamples = String(spectrum.length);
  }

  function scheduleRender() {
    if (renderRequest) {
      return;
    }
    renderRequest = window.requestAnimationFrame(render);
  }

  form.addEventListener("input", scheduleRender);
  window.addEventListener("resize", scheduleRender);
  scheduleRender();
})();
