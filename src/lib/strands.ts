import { Agent } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'

if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured.')

const model = new OpenAIModel({
  api: 'chat',
  modelId: 'openai/gpt-oss-20b',
  apiKey: process.env.GROQ_API_KEY,
  clientConfig: { baseURL: 'https://api.groq.com/openai/v1' },
  params: { reasoning_effort: 'low', parallel_tool_calls: false },
})
const agent = new Agent({ model })

