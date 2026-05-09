import { describe, expect, it } from "vitest";
import { describeCron, parse, serialize } from "./CronBuilder";

describe("CronBuilder.parse", () => {
  it("parses daily", () => {
    const s = parse("0 18 * * *");
    expect(s.mode).toBe("daily");
    expect(s.hour).toBe(18);
    expect(s.minute).toBe(0);
  });

  it("parses weekdays", () => {
    const s = parse("30 9 * * 1-5");
    expect(s.mode).toBe("weekdays");
    expect(s.hour).toBe(9);
    expect(s.minute).toBe(30);
  });

  it("parses weekend (sun+sat)", () => {
    const s = parse("0 10 * * 0,6");
    expect(s.mode).toBe("weekend");
    expect(s.hour).toBe(10);
  });

  it("parses arbitrary weekly days", () => {
    const s = parse("0 8 * * 1,3,5"); // Mo, We, Fr
    expect(s.mode).toBe("weekly");
    expect(s.daysOfWeek).toEqual([1, 3, 5]);
  });

  it("parses monthly", () => {
    const s = parse("0 9 15 * *");
    expect(s.mode).toBe("monthly");
    expect(s.dayOfMonth).toBe(15);
  });

  it("falls back to custom on unknown patterns", () => {
    const s = parse("*/15 9-18 * * 1-5");
    expect(s.mode).toBe("custom");
    expect(s.customExpr).toBe("*/15 9-18 * * 1-5");
  });

  it("falls back to custom on malformed input", () => {
    expect(parse("not cron").mode).toBe("custom");
    expect(parse("0 99 * * *").mode).toBe("custom");
    expect(parse("").mode).toBe("custom");
  });
});

describe("CronBuilder.serialize", () => {
  it("daily roundtrip", () => {
    const expr = "0 18 * * *";
    expect(serialize(parse(expr))).toBe(expr);
  });

  it("weekdays roundtrip", () => {
    const expr = "30 9 * * 1-5";
    expect(serialize(parse(expr))).toBe(expr);
  });

  it("weekly with multiple days roundtrip", () => {
    const expr = "0 8 * * 1,3,5";
    expect(serialize(parse(expr))).toBe(expr);
  });

  it("monthly roundtrip", () => {
    const expr = "0 9 15 * *";
    expect(serialize(parse(expr))).toBe(expr);
  });

  it("preserves custom expression as-is", () => {
    const expr = "*/15 9-18 * * 1-5";
    expect(serialize(parse(expr))).toBe(expr);
  });

  it("weekly without days falls back to daily safety", () => {
    const out = serialize({
      mode: "weekly",
      hour: 9, minute: 0, daysOfWeek: [],
      dayOfMonth: 1, customExpr: "",
    });
    expect(out).toBe("0 9 * * *");
  });
});

describe("CronBuilder.describeCron", () => {
  it("describes daily in French", () => {
    expect(describeCron("0 18 * * *")).toContain("tous les jours");
    expect(describeCron("0 18 * * *")).toContain("18h00");
  });

  it("describes weekdays", () => {
    expect(describeCron("0 9 * * 1-5")).toContain("lundi au vendredi");
  });

  it("describes weekend", () => {
    expect(describeCron("0 10 * * 0,6")).toContain("samedi");
    expect(describeCron("0 10 * * 0,6")).toContain("dimanche");
  });

  it("describes monthly with ordinal for the 1st", () => {
    expect(describeCron("0 9 1 * *")).toContain("1ᵉʳ");
    expect(describeCron("0 9 15 * *")).toContain("15");
  });

  it("describes weekly with selected days in French order (lundi first)", () => {
    const desc = describeCron("0 8 * * 1,3,5");
    // L'ordre attendu : lundi, mercredi, vendredi
    const idxLun = desc.indexOf("lundi");
    const idxMer = desc.indexOf("mercredi");
    const idxVen = desc.indexOf("vendredi");
    expect(idxLun).toBeGreaterThan(-1);
    expect(idxMer).toBeGreaterThan(idxLun);
    expect(idxVen).toBeGreaterThan(idxMer);
  });

  it("describes custom as raw expression", () => {
    expect(describeCron("*/15 9-18 * * 1-5")).toContain("*/15");
  });
});
