
#eval for studies
1. Add per study evals that evaluate the applicableness just add it on to the existing study json as a number applicableness field
2. take the top 25 applicableness studies and discard the rest
3. then, we concat all the criterion and pass it into an agent that has a tool for building questions to ask the user
4. ask the user the generated questions
5. evaluate the criterion against the users question answers and have the agent pass a bool to see if it should go through to the next round
6. with the studies that go through to the next round, pass everything (all studies), including the studies description to another agent to rank (make sure it factors in whether it is looking for participants currently)
7. display the final studies

#eval for drugs
1. a similar tool to step 1. But we have both applicableness, drug name, efficacy added to the json
2. Take top 25 applicableness
3. display the top 25 applicableness with respect to efficacy