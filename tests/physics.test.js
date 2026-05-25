const test = require("node:test");
const assert = require("node:assert/strict");
const physics = require("../src/physics");

const EPS = 1e-10;

test("reflected Newton rings have a dark center at zero gap", () => {
  const intensity = physics.interferenceIntensity(0, {
    mode: "reflected",
    curvatureRadiusM: 1,
    wavelengthNm: 550,
    refractiveIndex: 1,
    gapNm: 0
  });

  assert.ok(intensity < EPS);
});

test("transmitted pattern is complementary to reflected pattern", () => {
  const base = {
    curvatureRadiusM: 1.2,
    wavelengthNm: 589,
    refractiveIndex: 1,
    gapNm: 0
  };
  const radiusM = 0.00043;
  const reflected = physics.interferenceIntensity(radiusM, { ...base, mode: "reflected" });
  const transmitted = physics.interferenceIntensity(radiusM, { ...base, mode: "transmitted" });

  assert.ok(Math.abs(reflected + transmitted - 1) < 1e-12);
});

test("first reflected bright ring is close to unit intensity", () => {
  const params = {
    mode: "reflected",
    curvatureRadiusM: 1,
    wavelengthNm: 550,
    refractiveIndex: 1,
    gapNm: 0
  };
  const radiusM = physics.ringRadiusM(0, { ...params, kind: "bright" });
  const intensity = physics.interferenceIntensity(radiusM, params);

  assert.ok(Math.abs(intensity - 1) < 1e-9);
});

test("first noncentral reflected dark ring follows the Newton formula", () => {
  const params = {
    mode: "reflected",
    curvatureRadiusM: 1,
    wavelengthNm: 550,
    refractiveIndex: 1,
    gapNm: 0
  };
  const radiusM = physics.ringRadiusM(1, { ...params, kind: "dark" });
  const paraxialRadiusM = Math.sqrt(params.curvatureRadiusM * params.wavelengthNm * 1e-9);
  const intensity = physics.interferenceIntensity(radiusM, params);

  assert.ok(Math.abs(radiusM - paraxialRadiusM) / paraxialRadiusM < 1e-7);
  assert.ok(intensity < 1e-9);
});

test("zero-width spectrum equals a monochromatic sample", () => {
  const spectrum = physics.spectrumSamples(532, 0, 21);
  const params = {
    mode: "reflected",
    curvatureRadiusM: 0.8,
    wavelengthNm: 532,
    refractiveIndex: 1,
    gapNm: 40
  };
  const radiusM = 0.0011;

  assert.equal(spectrum.length, 1);
  assert.equal(spectrum[0].weight, 1);
  assert.equal(
    physics.spectralIntensityAtRadius(radiusM, spectrum, params),
    physics.interferenceIntensity(radiusM, params)
  );
});

test("quasi-monochromatic Gaussian weights are normalized", () => {
  const spectrum = physics.spectrumSamples(550, 40, 81);
  const sum = spectrum.reduce((acc, sample) => acc + sample.weight, 0);

  assert.ok(spectrum.length === 81);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});

test("exact lens sag agrees with r^2 / 2R in the paraxial region", () => {
  const r = 0.0005;
  const radius = 1.5;
  const exact = physics.filmThicknessM(r, radius, 0);
  const paraxial = (r * r) / (2 * radius);

  assert.ok(Math.abs(exact - paraxial) / paraxial < 1e-7);
});

test("standard laboratory diameter formula recovers wavelength", () => {
  const params = {
    mode: "reflected",
    curvatureRadiusM: 1,
    wavelengthNm: 589,
    refractiveIndex: 1,
    gapNm: 0
  };
  const order = 8;
  const step = 10;
  const diameter1 = 2 * physics.ringRadiusM(order, { ...params, kind: "dark" });
  const diameter2 = 2 * physics.ringRadiusM(order + step, { ...params, kind: "dark" });
  const recoveredWavelengthM = (diameter2 * diameter2 - diameter1 * diameter1) /
    (4 * step * params.curvatureRadiusM);

  assert.ok(Math.abs(recoveredWavelengthM * 1e9 - params.wavelengthNm) < 0.005);
});
