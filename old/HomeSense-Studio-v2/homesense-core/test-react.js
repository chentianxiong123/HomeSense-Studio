const r = await fetch('http://localhost:3000/api/chat', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({text: '打开B站'})
});
const d = await r.json();
console.log('=== TRACE ===');
d.data.trace.forEach((t, i) => {
  console.log(`\n[${i}] ${t.stage}:`);
  console.log(`    message: ${t.message}`);
  console.log(`    data: ${JSON.stringify(t.data)}`);
});
console.log('\n=== FINAL ===');
console.log('outcome:', d.data.outcomeType);
console.log('reply:', d.data.reply);
