const http = require('http')

const body = JSON.stringify({ message: '打开东芝电视', direct_llm: true })

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/chat/stream',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, (res) => {
  let data = ''
  res.on('data', (chunk) => { data += chunk })
  res.on('end', () => {
    const lines = data.split('\n')
    const events = lines.filter(l => l.startsWith('event:'))
    console.log('Total event lines:', events.length)
    events.forEach(e => console.log(e))

    // Check for tool_calls
    const hasToolCalls = lines.some(l => l.includes('tool_calls'))
    console.log('\nHas tool_calls:', hasToolCalls)

    // Check last assistant message
    const assistantLines = lines.filter(l => l.startsWith('event: assistant.'))
    if (assistantLines.length > 0) {
      console.log('Last assistant event:', assistantLines[assistantLines.length - 1])
      // Find corresponding data line
      const idx = lines.indexOf(assistantLines[assistantLines.length - 1])
      if (idx >= 0 && lines[idx + 1]) {
        const content = lines[idx + 1].slice(6)
        try {
          const parsed = JSON.parse(content)
          console.log('Last content:', parsed.content?.slice(0, 100))
          if (parsed.tool_calls) console.log('tool_calls:', JSON.stringify(parsed.tool_calls))
        } catch {}
      }
    }
  })
})

req.write(body)
req.end()