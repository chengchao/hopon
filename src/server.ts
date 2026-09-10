import handler from '@tanstack/react-start/server-entry'
import api from './worker.js'
export default {
  fetch(request: Request, env: Parameters<typeof api.fetch>[1]) {
    return new URL(request.url).pathname.startsWith('/api/') ? api.fetch(request, env) : handler.fetch(request)
  },
}
