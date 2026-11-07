// The signed turn from heading b to heading a in degrees, -180 to 180: headings run 0 to 360, so 359 and 1 are 2 apart, not 358
export const headingDelta = (a: number, b: number): number => {
  const d = (((a - b) % 360) + 360) % 360;
  return d >= 180 ? d - 360 : d;
};
