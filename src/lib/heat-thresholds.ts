// Korean heat-wave bands are stated in apparent temperature (체감온도), not dry-bulb temperature:
// 33도 is the 폭염주의보 line and 35도 the 폭염경보 line. Values computed here are threshold
// comparisons for on-site judgement, not an official 기상청 특보 발효 상태.
export const HEAT_ADVISORY_APPARENT_TEMP_C = 33;
export const HEAT_WARNING_APPARENT_TEMP_C = 35;

export type HeatLevel = "none" | "advisory" | "warning";

export interface HeatAssessment {
  level: HeatLevel;
  temperatureC?: number;
  humidityPct?: number;
  apparentTemperatureC?: number;
  summary: string;
}

// Stull (2011) natural wet-bulb approximation from dry-bulb temperature and relative humidity.
export function wetBulbTemperatureC(temperatureC: number, humidityPct: number): number {
  return temperatureC * Math.atan(0.151977 * Math.sqrt(humidityPct + 8.313659))
    + Math.atan(temperatureC + humidityPct)
    - Math.atan(humidityPct - 1.676331)
    + 0.00391838 * humidityPct ** 1.5 * Math.atan(0.023101 * humidityPct)
    - 4.686035;
}

// 기상청 여름철 체감온도 식: 습구온도(Stull 근사)와 기온으로 산출한다.
export function apparentTemperatureC(temperatureC: number, humidityPct: number): number {
  const wetBulb = wetBulbTemperatureC(temperatureC, humidityPct);
  return -0.2442
    + 0.55399 * wetBulb
    + 0.45535 * temperatureC
    - 0.0022 * wetBulb * wetBulb
    + 0.00278 * wetBulb * temperatureC
    + 3.0;
}

function levelFor(value: number): HeatLevel {
  if (value >= HEAT_WARNING_APPARENT_TEMP_C) return "warning";
  if (value >= HEAT_ADVISORY_APPARENT_TEMP_C) return "advisory";
  return "none";
}

function levelLabel(level: HeatLevel): string {
  return level === "warning" ? "폭염경보 수준" : "폭염주의보 수준";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function assessHeatRisk(temperature?: unknown, humidity?: unknown): HeatAssessment {
  const temperatureC = Number(temperature);
  const humidityPct = Number(humidity);
  if (!Number.isFinite(temperatureC)) {
    return { level: "none", summary: "기온 결측: 폭염 판정 불가" };
  }
  // Humidity can be missing in an observation, so fall back to dry-bulb temperature only. That
  // over-warns in dry air, which is the safe direction for an outdoor-event stop decision.
  if (!Number.isFinite(humidityPct)) {
    const level = levelFor(temperatureC);
    return {
      level,
      temperatureC,
      summary: level === "none"
        ? `기온 ${round1(temperatureC)}℃(습도 결측), 폭염 임계값 미만`
        : `${levelLabel(level)} 기온 ${round1(temperatureC)}℃(습도 결측으로 체감온도 미산출)`,
    };
  }
  const apparent = apparentTemperatureC(temperatureC, humidityPct);
  const level = levelFor(apparent);
  const detail = `체감온도 ${round1(apparent)}℃(기온 ${round1(temperatureC)}℃, 습도 ${round1(humidityPct)}%)`;
  return {
    level,
    temperatureC,
    humidityPct,
    apparentTemperatureC: round1(apparent),
    summary: level === "none" ? `${detail}, 폭염 임계값 미만` : `${levelLabel(level)} ${detail}`,
  };
}
