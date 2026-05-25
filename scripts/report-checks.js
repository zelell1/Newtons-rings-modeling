const physics = require("../src/physics");

function mm(valueM) {
  return valueM * 1000;
}

function percent(value) {
  return `${(value * 100).toExponential(3)} %`;
}

function darkDiameterM(order, params) {
  return 2 * physics.ringRadiusM(order, { ...params, kind: "dark" });
}

function wavelengthFromDiametersM(order, step, params) {
  const d1 = darkDiameterM(order, params);
  const d2 = darkDiameterM(order + step, params);
  return (d2 * d2 - d1 * d1) / (4 * step * params.curvatureRadiusM);
}

const sodiumParams = {
  mode: "reflected",
  curvatureRadiusM: 1,
  wavelengthNm: 589,
  refractiveIndex: 1,
  gapNm: 0,
  visibility: 1
};

console.log("Асимптотическая проверка r_m^2 ~= m*lambda*R/n");
console.log("R = 1.000 м, lambda = 589 нм, n = 1");
console.log("m | r_exact, мм | r_asymptotic, мм | относительная ошибка");

for (const order of [1, 2, 5, 10, 20, 40]) {
  const exact = physics.ringRadiusM(order, { ...sodiumParams, kind: "dark" });
  const asymptotic = Math.sqrt(
    order * sodiumParams.wavelengthNm * 1e-9 * sodiumParams.curvatureRadiusM / sodiumParams.refractiveIndex
  );
  const rel = Math.abs(exact - asymptotic) / asymptotic;
  console.log(`${order} | ${mm(exact).toFixed(6)} | ${mm(asymptotic).toFixed(6)} | ${percent(rel)}`);
}

console.log("");
console.log("Контроль по стандартной экспериментальной формуле");
console.log("lambda = (D_(n+m)^2 - D_n^2) / (4*m*R)");
console.log("Диаметры берутся из модели, затем lambda восстанавливается так же, как в лабораторной работе.");
console.log("n | m | D_n, мм | D_(n+m), мм | lambda_calc, нм | ошибка относительно 589 нм");

for (const [order, step] of [
  [4, 8],
  [8, 8],
  [12, 8],
  [16, 8]
]) {
  const d1 = darkDiameterM(order, sodiumParams);
  const d2 = darkDiameterM(order + step, sodiumParams);
  const lambdaM = wavelengthFromDiametersM(order, step, sodiumParams);
  const lambdaNm = lambdaM * 1e9;
  const rel = Math.abs(lambdaNm - sodiumParams.wavelengthNm) / sodiumParams.wavelengthNm;
  console.log(
    `${order} | ${step} | ${mm(d1).toFixed(4)} | ${mm(d2).toFixed(4)} | ${lambdaNm.toFixed(6)} | ${percent(rel)}`
  );
}
