import { describe, expect, test } from "vitest";

import {
  excelColumn,
  fileRefusalMessage,
  fileRefusalText,
  undecodedMessage,
  undecodedText,
} from "./fileMessages.ts";
import type { ExportRefusal, ImportRefusal } from "./fileRefusal.ts";

const count = (value: number): string => new Intl.NumberFormat("en").format(value);

describe("the words of a refused import", () => {
  test("name the file, the line and the separator of a row of another length", () => {
    expect(
      fileRefusalText(
        {
          kind: "importRefused",
          fileName: "accessions.csv",
          refusal: {
            kind: "raggedRow",
            line: 1203,
            expected: 12,
            found: 14,
            separator: "semicolon",
          },
        },
        count,
      ),
    ).toEqual({
      heading: "“accessions.csv” was not imported",
      text: "Line 1,203, counting the header as line 1, has 14 cells where the header has 12, reading the file with “;” as the separator. Most often a cell holds “;” and is not in quotes, or a cell is missing. Correct that line and import the file again.",
    });
  });

  test("give the header of the first column found, and the name it must have", () => {
    expect(
      fileRefusalText(
        {
          kind: "importRefused",
          fileName: "accessions.csv",
          refusal: { kind: "notIndividualId", header: "accession" },
        },
        count,
      ).text,
    ).toBe(
      "Its first column, which must hold the ID of each individual, is named “accession”. Name it IndividualID and import the file again.",
    );
  });

  test("name a place of a text file by its line and one of a sheet by Excel's row and letters", () => {
    const text = (format: "text" | "xlsx"): string =>
      fileRefusalText(
        {
          kind: "importRefused",
          fileName: "a",
          refusal: { kind: "duplicateIndividual", format, name: "p2", firstRow: 3, secondRow: 40 },
        },
        count,
      ).text;
    expect(text("text")).toContain("two rows, line 3 and line 40.");
    expect(text("xlsx")).toContain("two rows, row 3 of the sheet and row 40 of the sheet.");
    expect(
      fileRefusalText(
        {
          kind: "importRefused",
          fileName: "a",
          refusal: { kind: "unnamedColumn", format: "xlsx", column: 28 },
        },
        count,
      ).text,
    ).toBe("Column AB has values but no name in the header. Name it and import the file again.");
  });
});

describe("the words of a refused export", () => {
  test("name the column and the individual, or the column's name", () => {
    expect(
      fileRefusalText(
        {
          kind: "exportRefused",
          refusal: {
            kind: "cannotCarry",
            columnName: "IndividualID",
            individual: "Ősz",
            character: "Ő",
          },
        },
        count,
      ),
    ).toEqual({
      heading: "The table was not exported",
      text: "The value of Ősz in “IndividualID” has the character “Ő”, which the file cannot hold. Export as CSV with the encoding UTF-8 or UTF-8 for Excel.",
    });
    expect(
      fileRefusalText(
        {
          kind: "exportRefused",
          refusal: { kind: "spacesAtEnds", columnName: "height ", individual: null },
        },
        count,
      ).text,
    ).toMatch(/^The name of the column “height ” has spaces/);
  });
});

describe("the words of a limit, a count and a file system's refusal", () => {
  const imported = (refusal: ImportRefusal): string =>
    fileRefusalText({ kind: "importRefused", fileName: "a.csv", refusal }, count).text;
  const exported = (refusal: ExportRefusal): string =>
    fileRefusalText({ kind: "exportRefused", refusal }, count).text;

  test("take the limit of a file's size from the refusal, in whole megabytes", () => {
    expect(imported({ kind: "tooLarge", size: 31_400_000, maxBytes: 25_000_000 })).toBe(
      "It is 32 MB, and Vavilov Explorer imports files of up to 25 MB. If it is the table you meant, remove the columns you do not need and import it again.",
    );
  });

  test("take the limit of a sheet's cells from the refusal", () => {
    expect(
      imported({
        kind: "sheetTooLarge",
        sheet: "Hoja1",
        firstRow: 2,
        firstColumn: 3,
        numRows: 3000,
        numColumns: 1000,
        maxCells: 1_500_000,
      }),
    ).toBe(
      "Its first sheet, “Hoja1”, has values in more than 1,500,000 cells, counted from C2 to the last value. Delete the values far from your table, or save the sheet as CSV, and import it again.",
    );
  });

  test("count the individuals below the header of a sheet, and a lone column in the singular", () => {
    expect(exported({ kind: "tooLargeForSheet", rows: 1_048_576, columns: 1 })).toBe(
      "The table has 1,048,576 individuals and 1 column, more than a sheet of Excel holds below its header, 1,048,575 individuals and 16,384 columns. Export as CSV instead.",
    );
    expect(exported({ kind: "tooLargeForSheet", rows: 1, columns: 16_385 })).toBe(
      "The table has 1 individual and 16,385 columns, more than a sheet of Excel holds below its header, 1,048,575 individuals and 16,384 columns. Export as CSV instead.",
    );
  });

  test("write a row of one cell in the singular", () => {
    expect(
      imported({ kind: "raggedRow", line: 4, expected: 1, found: 1, separator: "comma" }),
    ).toBe(
      "Line 4, counting the header as line 1, has 1 cell where the header has 1, reading the file with “,” as the separator. Most often a cell holds “,” and is not in quotes, or a cell is missing. Correct that line and import the file again.",
    );
    expect(
      imported({ kind: "raggedRow", line: 4, expected: 2, found: 3, separator: "tab" }),
    ).toContain("has 3 cells where the header has 2,");
  });

  test("say that a text's length counts some characters as two", () => {
    expect(
      exported({ kind: "textTooLong", columnName: "note", individual: "p1", length: 40_000 }),
    ).toBe(
      "The value of p1 in “note” has 40,000 characters, counting some, such as emoji, as two, more than the 32,767 a cell of Excel holds. Export as CSV instead.",
    );
  });

  test("give the bound of a whole number Excel holds exactly, on both sides of zero", () => {
    expect(exported({ kind: "integerTooLarge", columnName: "seeds", individual: "B" })).toBe(
      "The value of B in “seeds” is a whole number beyond ±9,007,199,254,740,992, which a number of Excel does not hold exactly. Export as CSV instead.",
    );
  });

  test("say that a file with no header is empty too", () => {
    expect(imported({ kind: "empty" })).toBe(
      "It has no header, or no row below its header. Add the individuals, one per row, and import it again.",
    );
  });

  test("say that a file refused for writing may be open in Excel", () => {
    expect(
      fileRefusalText(
        {
          kind: "fileNotWritten",
          fileName: "table.xlsx",
          io: "permissionDenied",
          message: "Access is denied. (os error 5)",
        },
        count,
      ),
    ).toEqual({
      heading: "“table.xlsx” was not written",
      text: "Vavilov Explorer is not allowed to write there. Export again and choose a folder of your own, such as Documents, or, if the file is open in another program such as Excel, close it there and export again.",
    });
  });
});

describe("the notice of a character not decoded", () => {
  test("names the file and the line", () => {
    expect(undecodedText("plants.csv", 1203, count)).toBe(
      "“plants.csv” was imported, but line 1,203 has a character that could not be read, shown as �. Save the file as UTF-8 and import it again if the text matters.",
    );
  });
});

describe("Excel's letters of a column", () => {
  test("go from A to Z, then AA", () => {
    expect([1, 2, 26, 27, 28, 52, 53, 702, 703, 16_384].map(excelColumn)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
      "XFD",
    ]);
  });
});

describe("the messages of the information bar", () => {
  test("of a refusal is an error, what happened and then how to put it right", () => {
    expect(
      fileRefusalMessage(
        { kind: "importUnreadable", fileName: "plants.xlsx", message: "zip: bad header" },
        count,
      ),
    ).toEqual({
      kind: "error",
      text: "“plants.xlsx” was not imported. It could not be read as an Excel workbook, and may be damaged. Open it in Excel and save it again, or save it as CSV, and import that.",
    });
  });

  test("of a character not decoded is a warning that names the line", () => {
    expect(undecodedMessage("damaged.csv", 1203, count)).toEqual({
      kind: "warning",
      text: "“damaged.csv” was imported, but line 1,203 has a character that could not be read, shown as �. Save the file as UTF-8 and import it again if the text matters.",
    });
  });
});
