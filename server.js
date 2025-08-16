// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

(async () => {
  const PDFMerger = (await import('pdf-merger-js')).default;

  const app = express();
  const upload = multer({ dest: 'uploads/' });
  app.use(express.static('public'));

  // In-memory map of SSE connections: jobId -> res
  const sseConnections = new Map();

  // SSE endpoint: client opens and listens for events for a jobId
  app.get('/events', (req, res) => {
    const jobId = req.query.jobId;
    if (!jobId) {
      res.status(400).send('jobId required');
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('\n');

    // store connection
    sseConnections.set(jobId, res);
    console.log(`SSE connected for job ${jobId}`);

    // clean up on close
    req.on('close', () => {
      sseConnections.delete(jobId);
      console.log(`SSE disconnected for job ${jobId}`);
    });
  });

  // helper to send SSE events (object -> JSON string)
  function sendSSE(jobId, payload) {
    const conn = sseConnections.get(jobId);
    if (!conn) return;
    try {
      conn.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      console.error('SSE write failed', err);
    }
  }

  // Merge endpoint — client must include a jobId form field (string)
  app.post('/merge', upload.array('pdfs', 50), async (req, res) => {
    const jobId = req.body.jobId || null;
    if (!req.files || req.files.length < 1) {
      if (jobId) sendSSE(jobId, { type: 'error', message: 'Upload at least one PDF' });
      return res.status(400).send('Upload at least one PDF file.');
    }

    try {
      // Notify start
      if (jobId) sendSSE(jobId, { type: 'started', total: req.files.length });

      const merger = new PDFMerger();

      // Add files in the order they were received
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        // notify per-file add
        if (jobId) sendSSE(jobId, { type: 'adding', index: i + 1, name: file.originalname });

        await merger.add(file.path);
      }

      if (jobId) sendSSE(jobId, { type: 'processing' });

      const outputPath = path.join(__dirname, 'uploads', `merged-${Date.now()}.pdf`);
      await merger.save(outputPath);

      if (jobId) sendSSE(jobId, { type: 'done', url: '/download/' + path.basename(outputPath) });

      // send merged file as response download
      res.download(outputPath, 'merged.pdf', (err) => {
        // cleanup
        req.files.forEach(f => {
          try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
        });
        try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }

        if (err) {
          console.error('Download error', err);
          if (jobId) sendSSE(jobId, { type: 'error', message: 'Download failed' });
        }
      });
    } catch (err) {
      console.error(err);
      if (jobId) sendSSE(jobId, { type: 'error', message: 'Merge failed' });
      res.status(500).send('Error merging PDFs');
    }
  });

  // Optional static download path (if client prefers to follow URL)
  app.get('/download/:name', (req, res) => {
    const file = path.join(__dirname, 'uploads', req.params.name);
    if (fs.existsSync(file)) {
      res.download(file, 'merged.pdf', (err) => {
        try { fs.unlinkSync(file); } catch (e) {}
      });
    } else {
      res.status(404).send('Not found');
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
})();
