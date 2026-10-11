# Trial location search

The form asks for a condition, a five-digit U.S. ZIP code, and maximum travel
distance in miles. ZIP code and distance are required when Clinical trials is
selected. A Research-only search needs only the condition.

`RequestForm` passes this JSON to `onSubmit`, and `ResearchRequest` passes the
same object to its `onResults(results, request, signal)` callback:

```json
{
  "condition": "Example condition",
  "zipCode": "64108",
  "travelDistanceMiles": 50,
  "clinicalTrials": true,
  "offLabelDrugsOrSupplements": true
}
```

The clinical trial request sends `diagnosis`, `zipCode`, and
`travelDistanceMiles` to `/api/trials`. The server validates these fields before
searching or evaluating trials. It resolves the ZIP code using
[Zippopotam.us](https://docs.zippopotam.us/docs/v1/) and then calls
ClinicalTrials.gov with its documented
[`filter.geo`](https://clinicaltrials.gov/api/oas/v2) parameter:

```text
filter.geo=distance(39.0837,-94.5868,50mi)
```

This is a geographic radius around the ZIP location, not a road distance or
travel-time estimate. The filter is applied before trials are passed to the
LLM. An unknown ZIP, failed lookup, or invalid distance stops the trial search;
the server does not silently run an unrestricted search. No extra API key is
required.

Example request (start your server yourself):

```sh
curl -i --max-time 120 http://localhost:3000/api/trials \
  -H 'Content-Type: application/json' \
  -d '{"diagnosis":"Example condition","zipCode":"64108","travelDistanceMiles":50}'
```

The resulting `results.clinicalTrials.locationFilter` contains the ZIP,
distance, resolved latitude and longitude, city, and state. The existing
`requestUrl` includes the actual distance filter; the full trial JSON remains
available in `results.clinicalTrials.studies`.

The low-level `searchTrialsByDiagnosis` helper still supports searches without
geography for other callers. The patient form and `/api/trials` require location
information. When requesting another page, reuse the same ZIP and distance
alongside `pageToken`.
