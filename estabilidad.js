(function () {
  "use strict";

  const controls = {
    step: document.getElementById("stability-step"),
    droopA: document.getElementById("droop-a"),
    droopB: document.getElementById("droop-b"),
    inertia: document.getElementById("stability-inertia"),
    headroom: document.getElementById("unit-headroom"),
    unitB: document.getElementById("unit-b-available")
  };
  const labels = {
    step: document.getElementById("stability-step-value"),
    droopA: document.getElementById("droop-a-value"),
    droopB: document.getElementById("droop-b-value"),
    inertia: document.getElementById("stability-inertia-value"),
    headroom: document.getElementById("unit-headroom-value")
  };
  const outputs = {
    nadir: document.getElementById("stability-nadir"),
    final: document.getElementById("stability-final"),
    sharing: document.getElementById("stability-sharing"),
    status: document.getElementById("stability-status"),
    frequencyLabel: document.getElementById("frequency-result-label"),
    powerALabel: document.getElementById("power-a-label"),
    powerBLabel: document.getElementById("power-b-label")
  };
  const visual = {
    svg: document.getElementById("stability-svg"),
    frequency: document.getElementById("stability-frequency-path"),
    powerA: document.getElementById("power-a-path"),
    powerB: document.getElementById("power-b-path")
  };
  let previous = null;

  function format(value, digits) {
    return value.toLocaleString("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function syncLabels() {
    labels.step.value = `${format(Number(controls.step.value), 0)} %`;
    labels.droopA.value = `${format(Number(controls.droopA.value), 1)} %`;
    labels.droopB.value = `${format(Number(controls.droopB.value), 1)} %`;
    labels.inertia.value = `${format(Number(controls.inertia.value), 1)} s`;
    labels.headroom.value = `${format(Number(controls.headroom.value), 0)} %`;
  }

  function simulate() {
    const fnom = 50;
    const dt = 0.01;
    const duration = 8;
    const eventTime = 1;
    const step = Number(controls.step.value) / 100;
    const rA = Number(controls.droopA.value) / 100;
    const rB = Number(controls.droopB.value) / 100;
    const inertia = Number(controls.inertia.value);
    const headroom = Number(controls.headroom.value) / 100;
    const unitB = controls.unitB.checked;
    const rating = 0.5;
    const damping = 1;
    const responseTime = 0.12;
    let df = 0;
    let pA = 0;
    let pB = 0;
    let nadir = fnom;
    let saturatedA = false;
    let saturatedB = false;
    const points = [];

    for (let time = 0; time <= duration + dt / 2; time += dt) {
      const disturbance = time >= eventTime ? step : 0;
      const unconstrainedA = Math.max(0, -df / rA * rating);
      const unconstrainedB = unitB ? Math.max(0, -df / rB * rating) : 0;
      const targetA = Math.min(headroom, unconstrainedA);
      const targetB = unitB ? Math.min(headroom, unconstrainedB) : 0;
      saturatedA ||= unconstrainedA > headroom + 1e-6;
      saturatedB ||= unitB && unconstrainedB > headroom + 1e-6;
      pA += ((targetA - pA) / responseTime) * dt;
      pB += ((targetB - pB) / responseTime) * dt;
      df += ((-disturbance + pA + pB - damping * df) / (2 * inertia)) * dt;
      const frequency = fnom * (1 + df);
      nadir = Math.min(nadir, frequency);
      points.push({ time, frequency, pA, pB });
    }

    const final = points[points.length - 1];
    const totalPower = final.pA + final.pB;
    const shareA = totalPower > 1e-6 ? final.pA / totalPower * 100 : 0;
    const shareB = totalPower > 1e-6 ? final.pB / totalPower * 100 : 0;
    const reserveShortfall = Math.max(0, step - headroom * (unitB ? 2 : 1));
    return { points, fnom, step, rA, rB, inertia, headroom, unitB, nadir, finalFrequency: final.frequency, finalPA: final.pA, finalPB: final.pB, shareA, shareB, saturatedA, saturatedB, reserveShortfall };
  }

  function scale(result) {
    const minF = Math.min(...result.points.map((point) => point.frequency));
    const floorF = Math.floor((minF - 0.15) * 2) / 2;
    const ceilF = 50.15;
    const maxP = Math.max(0.1, result.headroom * 1.15);
    return result.points.map((point) => ({
      x: 74 + point.time / 8 * 776,
      fY: 48 + (ceilF - point.frequency) / (ceilF - floorF) * 174,
      aY: 466 - point.pA / maxP * 174,
      bY: 466 - point.pB / maxP * 174
    }));
  }

  function path(points, key) {
    return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point[key].toFixed(2)}`).join(" ");
  }

  function paint(result, fraction, prior) {
    const current = scale(result);
    const previousScaled = prior ? scale(prior) : current;
    const interpolated = current.map((point, index) => ({
      x: point.x,
      fY: previousScaled[index].fY + (point.fY - previousScaled[index].fY) * fraction,
      aY: previousScaled[index].aY + (point.aY - previousScaled[index].aY) * fraction,
      bY: previousScaled[index].bY + (point.bY - previousScaled[index].bY) * fraction
    }));
    visual.frequency.setAttribute("d", path(interpolated, "fY"));
    visual.powerA.setAttribute("d", path(interpolated, "aY"));
    visual.powerB.setAttribute("d", path(interpolated, "bY"));
  }

  function updateText(result) {
    outputs.nadir.textContent = `${format(result.nadir, 2)} Hz`;
    outputs.final.textContent = `${format(result.finalFrequency, 2)} Hz`;
    outputs.sharing.textContent = result.unitB ? `${format(result.shareA, 0)} / ${format(result.shareB, 0)} %` : "100 / 0 %";
    outputs.frequencyLabel.textContent = `${format(result.finalFrequency, 2)} Hz final`;
    outputs.powerALabel.textContent = `A ${format(result.finalPA, 2)} pu`;
    outputs.powerBLabel.textContent = result.unitB ? `B ${format(result.finalPB, 2)} pu` : "B fuera";

    const saturation = result.saturatedA || result.saturatedB;
    let message;
    if (result.reserveShortfall > 0.001) message = `el escalón supera el headroom agregado por ${format(result.reserveShortfall, 2)} pu; el modelo queda con déficit de reserva primaria`;
    else if (saturation) message = "al menos una unidad alcanza su headroom y el reparto deja de seguir la proporción droop ideal";
    else message = "las unidades comparten el escalón dentro de su headroom; menor droop aporta una fracción mayor";
    outputs.status.innerHTML = `<strong>Lectura:</strong> ${message}.`;
    visual.svg.setAttribute("aria-label", `Frecuencia mínima ${format(result.nadir, 2)} hertz y final ${format(result.finalFrequency, 2)} hertz. Reparto A ${format(result.shareA, 0)} por ciento y B ${format(result.shareB, 0)} por ciento.`);

    window.GFMApp.update((state) => {
      state.activeModule = "05";
      state.scenario.load.disturbancePu = result.step;
      state.scenario.control.droopUnitAPct = result.rA * 100;
      state.scenario.control.droopUnitBPct = result.rB * 100;
      state.scenario.control.inertiaSeconds = result.inertia;
      state.scenario.control.headroomUnitAPu = result.headroom;
      state.scenario.control.headroomUnitBPu = result.unitB ? result.headroom : 0;
      return state;
    });
  }

  function render(animate) {
    syncLabels();
    const result = simulate();
    updateText(result);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || !previous || reduce) {
      paint(result, 1, previous);
      previous = result;
      return;
    }
    const prior = previous;
    const start = performance.now();
    function frame(now) {
      const raw = Math.min(1, (now - start) / 420);
      const eased = 1 - Math.pow(1 - raw, 3);
      paint(result, eased, prior);
      if (raw < 1) requestAnimationFrame(frame);
      else previous = result;
    }
    requestAnimationFrame(frame);
  }

  Object.values(controls).forEach((control) => control.addEventListener("input", syncLabels));
  document.getElementById("simulate-stability").addEventListener("click", () => render(true));
  const state = window.GFMApp.getState();
  controls.step.value = Math.round(state.scenario.load.disturbancePu * 100 / 5) * 5;
  controls.droopA.value = state.scenario.control.droopUnitAPct;
  controls.droopB.value = state.scenario.control.droopUnitBPct;
  controls.inertia.value = state.scenario.control.inertiaSeconds;
  controls.headroom.value = Math.round(state.scenario.control.headroomUnitAPu * 100 / 5) * 5;
  controls.unitB.checked = state.scenario.control.headroomUnitBPu > 0;
  window.GFMApp.markComplete("05");
  render(false);
})();
