import { Agent, tool } from '@strands-agents/sdk'
import { GoogleModel } from '@strands-agents/sdk/models/google'
import { callbackify } from 'util'
import z, { properties } from 'zod'
import { describe } from 'zod/v4/core'

// Reads GEMINI_API_KEY from the environment.
const model = new GoogleModel({ modelId: 'gemini-3.8-flash' })
const agent = new Agent({ model })

let vicort= `Appraising the clinical applicability of a study requires evaluating whether research findings can inform or directly alter patient care for a specific condition. The FrACAS framework, which stands for Framework to Appraise the Clinical Applicability of Studies, and its accompanying VICORT checklist classify studies into three operational domains: Research, Practice-Informing, or Practice-Changing. This classification is achieved by sequentially evaluating six distinct criteria.

The first criterion is Validity. Evaluating validity involves determining whether the study internal methodology is robust and free from critical risk of bias, such as confounding, selection bias, or measurement issues. Internal validity serves as the prerequisite baseline; if a study lacks valid methods, it remains in the Research domain and cannot inform clinical action.

The second criterion is Indication-Informativeness. This criterion assesses whether the study design allows clinicians to determine an actionable clinical indication, which is defined as a clear intervention coupled to a target population. To satisfy this, the study must feature a randomized controlled trial evaluating an intervention, an observational study with a well-defined intervention that modifies or eliminates an exposure, or an observational study reporting absolute outcomes for an already indicated intervention to contrast against natural history.

The third criterion is Clinical Relevance. This requires evaluating whether the primary endpoint measures direct, patient-centered outcomes, such as mortality, symptom reduction, or quality of life, rather than relying solely on surrogate biomarkers or intermediate mechanisms. Meeting Validity, Indication-Informativeness, and Clinical Relevance elevates a study from basic research to the Practice-Informing domain. Practice-informing studies expand the background understanding of a condition or confirm existing interventions without changing current guidelines.

The fourth criterion is Originality, which comprises clinical significance and novelty. Clinical significance means the intervention demonstrates a clinically meaningful effect size rather than relying solely on statistical significance. Novelty requires that the findings alter an existing intervention-population pairing, such as introducing a new effective treatment or expanding an indication to a new subgroup.

The fifth criterion is Risk-Benefit Comprehensiveness. Clinicians must analyze the net summary effect on absolute scale measures to ensure that the total clinical benefits of changing treatment explicitly outweigh any associated risks, complications, or trade-offs when compared to standard care alternatives.

The final criterion is Transposability. This involves determining external applicability by examining whether the intervention can be practically implemented within a specific local clinical setting. Considerations include target population representativeness, resource requirements, cost-effectiveness, institutional feasibility, ethics, and patient values. Fulfilling all six VICORT criteria qualifies the study for the Practice-Changing domain, meaning it can directly alter management decisions, indication criteria, or treatment choices for target patients in local practice.`

const studyApplicable=tool({
    name:'studyApplicable',
    description:'Rate the applicableness of a clinical trial based on the following: ' + vicort,
    inputSchema: z.object({
            summary: z.string().describe("The summary of the trial"),
            title: z.string().describe("The title of the trial"),
            condition: z.string().describe("The condition to evaluate if the study is applicable to against")
    }),
    callback:(input: {summary:any;title:any;condition:any})=>{
 return{
    applicableness:'Applicableness score from 0 to 100 where a trial with 100 is most applicable to the given condition'
 }       
    }
})