# Loose Ends OS AI Advisor — zero-cost setup

The planned advisor uses a Supabase Edge Function, authenticates the signed-in user, verifies workspace membership, and calls OpenRouter's `openrouter/free` model router only. It is read-only and does not send customer phone numbers or email addresses to the model. The browser never receives the provider API key.

## Required secret
Create an OpenRouter API key at https://openrouter.ai/settings/keys and add it in the Supabase Edge Function secrets for project `uehfvpnnoitgybsmdgef` as `OPENROUTER_API_KEY`. Never commit the key or paste it into chat. Without this secret, the advisor must display a setup error rather than fake an answer.

OpenRouter currently advertises 50 requests/day on the free plan. Free models can be rate-limited or unavailable; no paid model ID should be used as a fallback.

## Release gates
1. Add the secret securely.
2. Test in a non-production project first if available.
3. Verify authenticated success, unauthenticated rejection, workspace scoping, rate-limit handling, and CORS rejection.
4. Run TypeScript, production build, and backend security regression checks.
5. Do not deploy production until these checks and signed-in mobile tests pass.
