# Booking-first private release

## Usual haircut

Open Tasks → My usual haircut on iPhone, or Booking setup & follow-through in the browser. Save the business, user-verified international phone number, service, booking name, duration, timezone, weekdays and local hours. Overnight windows are rejected explicitly. This structured profile takes precedence over older free-form memory; a current spoken instruction takes precedence over the profile. Removing the profile removes its authority for future requests.

Ask “Book my usual haircut next week.” Jolly combines the requested dates with the saved preferences, checks Calendar and prepares the existing call approval. Saving a profile does not expand the server's destination allowlist or place a call. If no week/date is supplied, Jolly asks rather than inventing a booking date. For an unfamiliar business, use web search to research it and review contact details before saving a new profile; search results alone do not authorize calls.

## Result and recovery

Confirmed bookings expose Calendar review, exact-time reminder creation, rescheduling and cancellation. Reminder creation requires a future time before the appointment; Jolly does not guess a travel interval. A verified reschedule/cancellation completes stale pending reminders tied to the old appointment. It does not invent a replacement reminder.

A busy/no-answer call, pre-dial failure or explicit no-booking outcome can produce a new call proposal with newly supplied future availability. The original source session and previous attempt remain linked. Repeated retry requests reuse the same pending proposal. Each new call requires approval and counts toward the daily attempt limit. Silence, interruption, uncertain confirmation and post-connect failures require verification rather than blind redial. Payment/deposit requests are handed back to the owner.

The browser also supports “remind me to follow up” without scheduling a call. The existing shared Tasks view remains the source of truth for progress. Phone-menu navigation, payment, and automatically trying a sequence of unrelated businesses are not implemented; the current release targets a known consenting business/recipient.

## Private pairing

On a trusted administrator machine, load the private owner environment and run:

```sh
node backend/scripts/pairing.mjs issue My iPhone and Watch
node backend/scripts/pairing.mjs list
node backend/scripts/pairing.mjs revoke DEVICE_UUID
```

Set `BACKEND_URL` to the intended HTTPS deployment and supply `API_TOKEN` privately via the environment. Do not paste an owner token into shell arguments or messages. The generated code expires after five minutes and can be redeemed once. Enter the backend address and code in the iPhone connection screen, then sync the paired Watch. The app stores a revocable 90-day device token in Keychain. The owner administration token is not given to the device by pairing. Paired clients have access to this one owner's assistant; they cannot issue codes or manage other devices.

Tokens are stored hashed on the server, pairing tickets are encrypted and only hashes identify their codes. Failed redemption attempts are rate-limited. Revoke removes future API/realtime access and associated push registrations; already authorized calls continue independently and require their separate stop flow. A device token is a private credential: this is secure pairing, not separate user accounts or permission roles.

## Remaining owner actions

- Save/confirm actual booking preferences and any new allowed destination.
- Sign/install updated clients and enter a newly issued private pairing code.
- Grant Gmail draft access or other desired connector permissions.
- Configure Apple push credentials and approve notification permission if wanted.
- Authorize a consenting live booking acceptance call and later device testing.
- Resolve the existing character/name permission question before public submission.

No live booking, Calendar/Gmail write, device installation or organizer message is part of the implementation checks.
