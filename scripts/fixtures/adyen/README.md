# Adyen fixtures

These sample notification payloads are for local replay and unit tests. When `DEMO_MODE=adyen_replay`, `AdyenStrategy.createAuthHold` and `AdyenStrategy.capturePayment` return canned `demo_` references and do not call Adyen or require Adyen credentials.
