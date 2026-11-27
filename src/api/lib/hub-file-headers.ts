// Headers for a file streamed back from the Houzs IT Hub (meetings, IT Support).
// The hub keeps the type the uploader declared, so an HTML or SVG "attachment"
// opened inline would run as this site. Only these keep their type and open inline.
export const INLINE_TYPES = ["image/png", "image/jpeg", "application/pdf"];

export function hubFileHeaders(res: Response): Headers {
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const inline = INLINE_TYPES.includes(type);
  const headers = new Headers({ "Content-Type": inline ? type : "application/octet-stream", "X-Content-Type-Options": "nosniff" });
  const disposition = res.headers.get("Content-Disposition");
  // Not inline: always attachment, keeping the hub's filename parameters.
  if (inline && disposition) headers.set("Content-Disposition", disposition);
  else if (!inline) headers.set("Content-Disposition", `attachment${disposition?.replace(/^[^;]*/, "") ?? ""}`);
  return headers;
}
