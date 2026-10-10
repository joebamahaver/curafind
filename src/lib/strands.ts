import { Agent } from '@strands-agents/sdk'
import { GoogleModel } from '@strands-agents/sdk/models/google'

// Reads GEMINI_API_KEY from the environment.
const model = new GoogleModel({ modelId: 'gemini-3.8-flash' })
const agent = new Agent({ model })
const result = await agent.invoke('What is an agent harness, in one sentence?')
console.log(result.lastMessage)
