# Tech Stack & Cost Model (v1)

Guiding rule: managed services over self-hosted, pay-per-use over fixed
capacity. At 1-2 clinic scale, engineering time is the scarce resource,
not infra cost.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Messaging | WhatsApp Business Cloud API (Meta), or a BSP like Interakt/Wati if you want a friendlier dashboard | Free/cheap at low volume, no voice complexity |
| Backend | Node.js or Python/FastAPI | Either is fine — pick whichever the team is faster in |
| Database | Postgres via Supabase or Neon (India region if available) | Managed, encrypted at rest, generous free tier |
| Auth (CRM) | Supabase Auth (or equivalent) | Avoid hand-rolling auth for a system holding patient data |
| CRM frontend | Next.js on Vercel | Fast to ship, good free tier |
| Backend hosting | Railway or Render | Simple deploys, no k8s needed at this scale |
| LLM | Claude via API, cheap tier (e.g. Haiku-class) for routine intent parsing; escalate to a stronger tier only for ambiguous phrasing | Keeps cost proportional to actual usage |

## Explicitly not doing yet

- No Kubernetes, no microservices split beyond agent/backend/frontend —
  one backend service is plenty at this scale
- No self-hosted Postgres — managed until there's a concrete reason
- No custom telephony/voice stack — deferred, see roadmap
- No multi-region deployment — single India region

## Cost estimate (1-2 clinics, MVP)

| Item | Est. monthly cost |
|---|---|
| WhatsApp Cloud API | ~free at low conversation volume; a few $ once past free tier |
| Postgres (Supabase/Neon free-to-low tier) | $0-25 |
| Backend hosting (Railway/Render) | $5-20 |
| Frontend hosting (Vercel) | $0 (hobby tier sufficient at this stage) |
| LLM API (pay-per-use) | $10-40 depending on message volume |
| **Total** | **roughly $50-100/month** |

This scales with actual clinic usage, not a fixed reserved-capacity
bill — important pre-revenue.

## Cost efficiency principles

1. Managed services, not self-hosted — buys back engineering time
2. Pay-per-use LLM + serverless hosting — cost tracks real usage
3. WhatsApp before voice — voice can 3-5x per-interaction cost
   (telephony + STT + LLM + TTS chained together)
4. Cheap model for routine classification, expensive model only when
   genuinely ambiguous
5. Narrow tool-calling agent, not freeform chat — fewer tokens per
   interaction, smaller liability surface
