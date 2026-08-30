const r = await fetch('http://localhost:3000/api/chat', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({text: '打开B站'})
});
const d = await r.json();

// 打印完整的 trace 数据
console.log('=== FULL TRACE ===\n');
d.data.trace.forEach((t, i) => {
  console.log(`[${i}] ${t.stage}:`);
  console.log(JSON.stringify(t, null, 2));
  console.log('---');
});

console.log('\n=== FINAL STATE ===');
console.log('outcomeType:', d.data.outcomeType);
console.log('reply:', d.data.reply);
