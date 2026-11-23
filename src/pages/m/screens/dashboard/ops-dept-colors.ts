// Department colours of the Home Operations v3 design (pure, so node tests import it).
/** Department colours of the Home Operations v3 design (DV_DEPTS): Department Revenue dots, bars and its drill chart. */
const DV: Record<string, string> = {
  FAB_CUT: "#2B5797", FAB_SEW: "#D19A32", WOOD_CUT: "#1F9E89", FOAM_CUT: "#8E5DB5", FOAM_CUTTING: "#8E5DB5", FOAM: "#4FA3D9",
  FIBRE: "#B5651D", FRAMING: "#8A8F98", WEBBING: "#A8ADB4", UPHOLSTERY: "#C4C8CD", PACKING: "#D6D9DD",
};
export const dvColor = (code: string): string => DV[code] ?? "#A8A196";
