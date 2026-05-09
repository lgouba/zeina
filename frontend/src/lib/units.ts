// units.ts — mapping nom sémantique d'unité (`percent`, `celsius`, …) → symbole
// standard à afficher (`%`, `°C`, …). La metadata DB stocke des noms ; l'UI
// veut des symboles courts.
//
// Tout ce qui ressemble déjà à un symbole est laissé tel quel.

const UNIT_SYMBOLS: Record<string, string> = {
  percent:    "%",
  pct:        "%",
  rh:         "%",
  "%rh":      "%",
  celsius:    "°C",
  fahrenheit: "°F",
  kelvin:     "K",
  bool:       "",
  boolean:    "",
  level:      "lx",
  lux:        "lx",
  ppm:        "ppm",
  ppb:        "ppb",
  ppi:        "ppi",
  hpa:        "hPa",
  pa:         "Pa",
  bar:        "bar",
  "ug/m3":    "µg/m³",
  "µg/m3":    "µg/m³",
  "ug/m^3":   "µg/m³",
  db:         "dB",
  decibel:    "dB",
  watt:       "W",
  watts:      "W",
  kw:         "kW",
  kwh:        "kWh",
  wh:         "Wh",
  va:         "VA",
  ampere:     "A",
  amp:        "A",
  amps:       "A",
  volt:       "V",
  volts:      "V",
  meter:      "m",
  meters:     "m",
  cm:         "cm",
  mm:         "mm",
  km:         "km",
  "l/min":    "L/min",
  "m3/h":     "m³/h",
  "km/h":     "km/h",
  "mm/h":     "mm/h",
  degree:     "°",
  degrees:    "°",
};

export function unitSymbol(raw: string | null | undefined): string {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  if (key in UNIT_SYMBOLS) return UNIT_SYMBOLS[key];
  return raw; // déjà un symbole (ex: %, °C, ppm) ou inconnu : on garde tel quel
}
