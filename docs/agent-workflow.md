# AI Agent Workflow

## Clinical Trials

1. Initial trials are picked based on the diagnosis given.
1. AI agents individually rate trials based on how directly they apply to the diagnosis.
1. The eligibility criteria of the most applicable trials are given to a new agent to create questions to ask the patient.
1. After the patient answers, a new agent determines which of the most applicable trials the patient is eligible for, ranks them, and shows them to the user with its reasoning.
   1. *A match given by the agent is not confirmation of eligibility.*

## Drug Research

1. Initial papers are picked based on the diagnosis given.
1. AI agents individually rate papers based on how directly they apply to the diagnosis and the estimated efficacy of any drugs posited within the paper.
1. The best papers in both applicability and efficacy are shown to the user.
