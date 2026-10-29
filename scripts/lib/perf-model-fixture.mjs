import { createServer } from 'node:http'

// Deterministic model boundary; IPC, approvals, file execution and container
// verification remain real production behavior.
export async function startPerformanceModel(taskRoot) {
  const calls = []
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions') || request.headers.authorization !== 'Bearer performance-fixture') {
      response.writeHead(404); response.end(); return
    }
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      try {
        const payload = JSON.parse(raw)
        const tool = payload.tools?.[0]?.function?.name
        calls.push({ at: Date.now(), tool: tool ?? 'text' })
        const values = {
          get_color: { color: '蓝色' },
          performance: { intent: '思考', relevance: 0.3, consequence: 0, coping: 0.3, norm: 0 },
          remember: { memories: [] },
          plan_task: { tool: 'filesystem', root: taskRoot, steps: [{ id: 'organize', tool: 'filesystem', title: '整理独立测试文件', detail: '按类型整理', expected: '内容不变', args: { action: 'organize' }, checks: [{ kind: 'file-content', path: '文档/example.txt', value: 'performance independent fixture' }] }], question: '' },
          create_isolated_artifact: { title: '独立性能测试', content: 'print(sum(i*i for i in range(1, 11)))', expectedOutput: '385' },
          review_isolated_artifact: { accepted: true, reason: '固定模型边界；真实产物另由容器核验' }
        }
        if (tool && !values[tool]) throw new Error(`Unsupported fixture tool: ${tool}`)
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: tool
          ? { role: 'assistant', tool_calls: [{ type: 'function', function: { name: tool, arguments: JSON.stringify(values[tool]) } }] }
          : { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
      } catch (error) {
        response.writeHead(400); response.end(JSON.stringify({ error: String(error) }))
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`, calls,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
  }
}
