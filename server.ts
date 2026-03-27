import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Proxy endpoint to bypass CORS for PDFs
  app.get("/api/proxy-pdf", async (req, res) => {
    const pdfUrl = req.query.url as string;
    if (!pdfUrl) {
      return res.status(400).send("URL is required");
    }

    try {
      console.log(`[Proxy] Requesting PDF: ${pdfUrl}`);
      
      const fetchOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow' as const,
        timeout: 30000,
      };

      let response = await fetch(pdfUrl, fetchOptions);

      // Handle Google Drive large file confirmation
      const initialContentType = response.headers.get("content-type") || '';
      if (pdfUrl.includes('drive.google.com') && initialContentType.includes('text/html') && response.status === 200) {
        const text = await response.text();
        if (text.includes('confirm=') && text.includes('id=')) {
          const confirmMatch = text.match(/confirm=([a-zA-Z0-9_]+)/);
          const idMatch = text.match(/id=([a-zA-Z0-9_-]+)/) || pdfUrl.match(/id=([a-zA-Z0-9_-]+)/);
          if (confirmMatch && idMatch) {
            const confirmUrl = `https://drive.google.com/uc?export=download&id=${idMatch[1]}&confirm=${confirmMatch[1]}`;
            console.log(`[Proxy] Large Google Drive file detected, retrying with confirmation: ${confirmUrl}`);
            response = await fetch(confirmUrl, fetchOptions);
          }
        } else {
          // If it's HTML but not a confirmation page, it might be a login page or an error
          if (text.includes('login') || text.includes('signin')) {
            return res.status(403).send("O arquivo parece estar protegido por senha ou requer login. Certifique-se de que o PDF está compartilhado publicamente.");
          }
          return res.status(415).send("O link fornecido não aponta para um arquivo PDF direto.");
        }
      }

      if (!response.ok) {
        console.error(`[Proxy] Failed to fetch: ${response.status} ${response.statusText}`);
        return res.status(response.status).send(`Failed to fetch PDF: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || 'application/pdf';
      const contentLength = response.headers.get("content-length");
      
      console.log(`[Proxy] Success: ${contentType} (${contentLength || 'unknown size'})`);

      // Final check if it's actually a PDF (or at least not HTML)
      if (contentType.includes('text/html')) {
        return res.status(415).send("O link fornecido não aponta para um arquivo PDF direto.");
      }

      // Forward headers
      res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Content-Disposition", "inline");
      
      // Stream the response
      response.body.pipe(res);
    } catch (error) {
      console.error("[Proxy] Error:", error);
      res.status(500).send("Erro ao processar o arquivo PDF através do servidor.");
    }
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
