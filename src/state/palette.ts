// The colours a group can be given, those of the core's list
// (crates/vavilov-core/src/table/colour.rs, PALETTE), each with the name a
// user reads: Okabe and Ito's seven, then each lighter, then each darker
// (docs/design.md, section 5). A test compares the colours with the file
// the core's test compares its list with.

/** A colour of the list. */
export interface PaletteColour {
  /** As CSS writes it, `#rrggbb`, in lower case. */
  readonly colour: string;
  /** Its name, as the user reads it. */
  readonly name: string;
}

/** The list, in the core's order. */
export const PALETTE: readonly PaletteColour[] = [
  { colour: "#e69f00", name: "Orange" },
  { colour: "#56b4e9", name: "Sky blue" },
  { colour: "#009e73", name: "Bluish green" },
  { colour: "#f0e442", name: "Yellow" },
  { colour: "#0072b2", name: "Blue" },
  { colour: "#d55e00", name: "Vermillion" },
  { colour: "#cc79a7", name: "Reddish purple" },
  { colour: "#f0c566", name: "Light orange" },
  { colour: "#9ad2f2", name: "Light sky blue" },
  { colour: "#66c5ab", name: "Light bluish green" },
  { colour: "#f6ef8e", name: "Light yellow" },
  { colour: "#66aad1", name: "Light blue" },
  { colour: "#e69e66", name: "Light vermillion" },
  { colour: "#e0afca", name: "Light reddish purple" },
  { colour: "#8a5f00", name: "Dark orange" },
  { colour: "#346c8c", name: "Dark sky blue" },
  { colour: "#005f45", name: "Dark bluish green" },
  { colour: "#908928", name: "Dark yellow" },
  { colour: "#00446b", name: "Dark blue" },
  { colour: "#803800", name: "Dark vermillion" },
  { colour: "#7a4964", name: "Dark reddish purple" },
];
