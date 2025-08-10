const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

(async () => {
    const PDFMerger = (await import('pdf-merger-js')).default;

    const app = express();
    const upload = multer({ dest: 'uploads/' });

    app.use(express.static('public'));

    app.post('/merge', upload.array('pdfs', 10), async (req, res) => {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Upload at least two PDF files.');
        }

        const merger = new PDFMerger();

        for (const file of req.files) {
            await merger.add(file.path);
        }

        const outputPath = path.join(__dirname, 'uploads', `merged-${Date.now()}.pdf`);
        await merger.save(outputPath);

        res.download(outputPath, 'merged.pdf', (err) => {
            if (err) console.error(err);
            req.files.forEach(file => fs.unlinkSync(file.path));
            fs.unlinkSync(outputPath);
        });
    });

    app.listen(3000, () => console.log('Server running on http://localhost:3000'));
})();
