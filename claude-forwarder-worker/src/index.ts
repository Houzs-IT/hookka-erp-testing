// Passes the ERP's Claude request to Anthropic unchanged and streams the
// answer back. See ../wrangler.toml for why this exists.
export default {
  async fetch(req: Request): Promise<Response> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    console.log(`placement=${req.headers.get("cf-placement")} status=${res.status}`);
    return res;
  },
};
