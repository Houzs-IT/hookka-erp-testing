// Production departments in pipeline order (the v20 stepper's real depts).
export const PRODUCTION_DEPTS: { code: string; label: string }[] = [
  { code: "FAB_CUT", label: "Fab Cut" },
  { code: "FAB_SEW", label: "Fab Sew" },
  { code: "FOAM_CUTTING", label: "Foam Cutting" },
  { code: "FOAM", label: "Foam Bonding" },
  { code: "FIBRE", label: "Fibre" },
  { code: "WOOD_CUT", label: "Wood Cut" },
  { code: "FRAMING", label: "Framing" },
  { code: "WEBBING", label: "Webbing" },
  { code: "UPHOLSTERY", label: "Upholstery" },
  { code: "PACKING", label: "Packing" },
];
