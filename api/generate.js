// Vercel Serverless Function
// Keeps the Gemini API key on the server - never exposed to the browser.
// Set GEMINI_API_KEY in Vercel via: vercel env add GEMINI_API_KEY production

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured with a Gemini API key yet." });
  }

  const attrs = req.body || {};

  const prompt = `You are writing an Indian e-commerce (Flipkart) product listing for organic search reach.

Product attributes:
${Object.entries(attrs)
  .filter(([, v]) => v)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Write:
1. "description": a persuasive, benefit-focused product description, 90-140 words, plain sentences, no markdown.
2. "keywords": an array of AS MANY relevant search keyword phrases as you can reasonably generate (aim for 15-25). Use simple, everyday terms the way normal shoppers in India actually type into search boxes - not fancy or formal phrasing. Cover synonyms, use-cases, and related terms to maximize search coverage.
3. "features": an array of 6-8 short key-feature phrases (2-5 words each).

Respond with ONLY raw JSON, no markdown code fences, no preamble, in exactly this shape:
{"description": "...", "keywords": ["...", "..."], "features": ["...", "..."]}`;

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
        }),
      }
    );

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      return res.status(502).json({ error: "Gemini API error: " + errText.slice(0, 300) });
    }

    const data = await geminiResp.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return res.status(502).json({ error: "Could not parse AI response as JSON.", raw: clean });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
