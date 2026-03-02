import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Static hosting
app.use(express.static("public"));
app.use("/src", express.static("src"));
app.use("/assets", express.static("assets"));

const GH_BASE = "http://localhost:8989";

app.post("/api/route", async (req, res) => {
  try {
    const ghResp = await fetch(`${GH_BASE}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    // forward status + content-type
    res.status(ghResp.status);
    const ct = ghResp.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);

    const buf = Buffer.from(await ghResp.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: "GraphHopper unreachable", detail: String(e) });
  }
});

app.get("/api/info", async (req, res) => {
  try {
    const ghResp = await fetch(`${GH_BASE}/info`);
    res.status(ghResp.status);

    const ct = ghResp.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);

    const buf = Buffer.from(await ghResp.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: "GraphHopper unreachable", detail: String(e) });
  }
});

app.listen(5173, "localhost", () => {
  console.log("App: http://localhost:5173");
});