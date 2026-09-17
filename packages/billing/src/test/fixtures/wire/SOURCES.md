# Canonical OpenRails wire fixtures

Copied verbatim from `testdata/wire/` in github.com/open-rails/openrails and
decoded by `src/core/schemas.test.ts`. Re-copy when the source moves.

| Fixture                                                                                         | Source commit                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `currencies.json`, `error_envelope.json`, `page_empty.json`, `payment.json`                     | `5a476d872` (integration candidate; `payment.json` carries the #983 F23 RFC3339 `created_at`) |
| `billing_status.json`, `subscription.json`, `notification.json`, `hosted_checkout_session.json` | `9a48b6e04` (PR #479, the self subscription/status/notification shapes and typed ids)         |
