'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

function init(spoolDir) {
  fs.mkdirSync(spoolDir, { recursive: true });

  return {
    spool(event) {
      const date = new Date().toISOString().slice(0, 10);
      const filePath = path.join(spoolDir, date + '.jsonl');
      fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
    },

    async drain(controlPlaneUrl, nodeSecret) {
      const files = fs.readdirSync(spoolDir).filter(f => f.endsWith('.jsonl')).sort();
      let sent = 0, failed = 0;

      for (const file of files) {
        const filePath = path.join(spoolDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        const remaining = [];

        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            const success = await sendEvent(controlPlaneUrl, event, nodeSecret);
            if (success) sent++;
            else { remaining.push(line); failed++; }
          } catch { remaining.push(line); failed++; }
        }

        if (remaining.length === 0) {
          fs.unlinkSync(filePath);
        } else {
          fs.writeFileSync(filePath, remaining.join('\n') + '\n');
        }
      }

      return { sent, failed, remaining: failed };
    },

    getSpoolSize() {
      const files = fs.readdirSync(spoolDir).filter(f => f.endsWith('.jsonl'));
      let totalBytes = 0;
      let oldestEvent = null;

      for (const file of files) {
        const stat = fs.statSync(path.join(spoolDir, file));
        totalBytes += stat.size;
        if (!oldestEvent || file < oldestEvent) oldestEvent = file.replace('.jsonl', '');
      }

      return { files: files.length, totalBytes, oldestEvent };
    },

    cleanup(maxAgeDays) {
      maxAgeDays = maxAgeDays || 7;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - maxAgeDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const files = fs.readdirSync(spoolDir).filter(f => f.endsWith('.jsonl'));
      let removed = 0;
      for (const file of files) {
        if (file.replace('.jsonl', '') < cutoffStr) {
          fs.unlinkSync(path.join(spoolDir, file));
          removed++;
        }
      }
      return { removed };
    }
  };
}

function sendEvent(baseUrl, event, nodeSecret) {
  return new Promise((resolve) => {
    const url = new URL('/api/events/ingest', baseUrl);
    const data = JSON.stringify(event);
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(16).toString('hex');
    const hmac = crypto.createHmac('sha256', nodeSecret);
    hmac.update('POST\n/api/events/ingest\n' + timestamp + '\n' + data);
    const signature = hmac.digest('hex');

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-ClawCC-Timestamp': timestamp,
        'X-ClawCC-Nonce': nonce,
        'X-ClawCC-Signature': signature
      }
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(data);
    req.end();
  });
}

module.exports = { init };
