import { describe, expect, test } from "vitest";

import { booleanText, integerText, levelText, numberText } from "./cellText.ts";

describe("the text of a number", () => {
  test("is the shortest form that gives back the value, with the decimal mark given", () => {
    expect(numberText(1.5, ".")).toBe("1.5");
    expect(numberText(1.5, ",")).toBe("1,5");
    expect(numberText(3, ",")).toBe("3");
    expect(numberText(-0.1, ",")).toBe("-0,1");
    expect(numberText(0.1 + 0.2, ".")).toBe("0.30000000000000004");
    expect(numberText(123456.789, ",")).toBe("123456,789");
  });

  test("is never rounded, however many digits it has", () => {
    expect(numberText(1 / 3, ".")).toBe("0.3333333333333333");
    expect(numberText(2 ** 53 + 2, ".")).toBe("9007199254740994");
  });

  test("of a very small or very large number keeps its exponent", () => {
    expect(numberText(1.5e-7, ",")).toBe("1,5e-7");
    expect(numberText(2e21, ",")).toBe("2e+21");
  });
});

describe("the text of a whole number and of a yes or no", () => {
  test("a whole number has every digit, beyond what a number holds exactly", () => {
    expect(integerText(9_007_199_254_740_993n)).toBe("9007199254740993");
    expect(integerText(-2n)).toBe("-2");
    expect(integerText(0n)).toBe("0");
  });

  test("a yes or no is TRUE or FALSE", () => {
    expect(booleanText(true)).toBe("TRUE");
    expect(booleanText(false)).toBe("FALSE");
  });
});

describe("the text of a level", () => {
  test("follows the storage type of its column", () => {
    expect(levelText("12", "integer", ",")).toBe("12");
    expect(levelText(0.5, "float", ",")).toBe("0,5");
    expect(levelText(true, "boolean", ",")).toBe("TRUE");
    expect(levelText("Spain", "text", ",")).toBe("Spain");
  });

  test("of another type than its storage type is a defect", () => {
    expect(() => levelText(12, "integer", ".")).toThrow(
      /defect: a level 12 of a column of integer/,
    );
  });
});
