import https from 'https';

const postData = JSON.stringify({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "你是谁" }],
  max_tokens: 50
});

const options = {
  hostname: 'daidai.rxwysystem.com',
  port: 443,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-d468157c3ae2fa0b2ecc59e1f0c37048e69af3766c85e467585bfca04cb75918',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response length:', data.length);
    console.log('Response:', data.slice(0, 300));
    try {
      const parsed = JSON.parse(data);
      console.log('Content:', parsed.choices?.[0]?.message?.content);
    } catch (e) {
      console.log('Parse error');
    }
  });
});

req.setTimeout(10000, () => {
  console.log('Timeout!');
  req.destroy();
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(postData);
req.end();
