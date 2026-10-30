# Calling someone from Contacts

Mochi can search contacts available on the device when you ask it to call someone on your behalf. For example: “Call Sam and tell them I’m running ten minutes late” or “Find Barber in my contacts and book a haircut next week.” This is a delegated AI call, not the device’s ordinary phone dialer.

## Setup and use

1. Install the updated signed app on iPhone and Watch and connect it to the updated private backend.
2. Ask Mochi to call a named contact. Grant Contacts permission when prompted. On Watch, the contact must be available in the Watch’s system contact store; contact synchronization is managed by Apple.
3. Choose the intended person and phone number from the local results. If access is limited, only accessible contacts can be found. Denied access, no matches and unsupported phone-number formats are shown explicitly.
4. Supply any missing instructions and the name Mochi should use when representing you. Appointment requests still need their dates, allowed times and duration.
5. Review the exact recipient, number and instructions, then approve the call. Selecting a contact alone does not dial.

Phone numbers must include an international country code. Mochi does not infer a country code from your location or timezone. Edit an ambiguous local-format number in Contacts before trying again.

The server’s destination allowlist still applies. Choosing a contact does not add that number to `TWILIO_ALLOWED_NUMBERS`. The owner must review and enable a consenting destination separately. No new provider key is needed beyond the existing calling, model and voice configuration.

## What is shared

Contact matching and the candidate list stay on the device. Only the selected display name, number and optional phone label are sent to the private backend, where they can be used for the requested call and processed by its configured model and telephone services. This is not a bulk address-book sync. The chosen recipient and approved instructions are part of the durable call record.

Lookups expire and belong to their originating conversation. Starting another turn, dismissing the lookup or changing the connection must not let a late result select a contact or dial. New requests still require a fresh call review.

The browser emulator does not read Apple Contacts. Use the native app for contact lookup, or provide a number explicitly in the browser. The browser can review shared general-call tasks without showing appointment fields.

## General calls and appointments

General calls have their own approved instructions and outcomes. They do not invent appointment times, query Calendar for availability or offer Calendar saves. Mochi identifies itself as an AI assistant and stays within the approved task. The result includes the recipient's relevant quoted reply, so an answer to a question is available when you return to the app. An ended telephone connection is not proof that the task succeeded.

Booking calls retain their existing allowed-time checks and explicit booking confirmation requirements. A verified appointment still requires separate approval before a Calendar change.

Both kinds retain destination checks, approval expiry, duplicate-decision protection, call-attempt limits, stop controls and uncertain-outcome recovery. An uncertain call must be verified before another attempt; Mochi does not automatically redial.

## Acceptance

Automated tests use synthetic contacts and provider responses. They do not establish physical Contacts permission behavior, Apple contact synchronization, audio routing or live call acceptance. Test on the actual iPhone and Watch with a consenting recipient, including denied/limited permission, multiple matching names and phone numbers, cancellation during lookup, connection changes and network loss after approval.

See [booking calls](booking-calls.md), [native setup](../native/README.md), and [device acceptance](development-acceptance.md). Apple documents local access in [CNContactStore](https://developer.apple.com/documentation/contacts/cncontactstore).
