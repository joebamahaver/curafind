import { Agent, tool } from '@strands-agents/sdk'
import { GoogleModel } from '@strands-agents/sdk/models/google'
import { callbackify } from 'util'
import z, { properties } from 'zod'
import { describe } from 'zod/v4/core'
import { studyApplicable } from './evaltools'

// Reads GEMINI_API_KEY from the environment.
const model = new GoogleModel({ modelId: 'gemini-3.8-flash' })

export async function evaluateTrial(
    summary:string,
    title:string,
    condition:string,
){
    const agent = new Agent({ 
        tools:[studyApplicable],
        model })
    const res=await agent.tool.studyApplicable.invoke({
        summary: summary,
        title:title,
        condition:condition
    })

    return res.toJSON()

}